import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  GenerationJob,
  GenerationJobStage,
  JobStatus,
  Lecturer,
  OperatingMode,
  SceneRecord,
  VideoAspectRatio,
  VideoResolution,
  VoiceProfile,
} from '../../src/types/studio.ts';
import { CLASSROOM_ENVIRONMENTS, recordAuditEvent } from '../db.ts';
import { estimateGenerationCost } from '../providers/capabilityRegistry.ts';
import { logEvent } from './logger.ts';
import { getStorageRoot, renderProjectVideo } from './videoPipeline.ts';

function buildInitialStages(): GenerationJobStage[] {
  return [
    { key: 'preparing', label_en: 'Prepare Workspace & Validate Scenes', label_ar: 'تهيئة المشروع والتحقق من المشاهد', status: 'pending' },
    { key: 'generating_audio', label_en: 'Synthesize Narration Audio', label_ar: 'توليد التعليق الصوتي', status: 'pending' },
    { key: 'synchronizing', label_en: 'Lecturer Video & Lip-Sync Check', label_ar: 'فحص فيديو المحاضر ومزامنة الشفاه', status: 'pending' },
    { key: 'generating_visuals', label_en: 'Render Smartboard & Code Scenes', label_ar: 'تصيير السبورة الذكية والأكواد', status: 'pending' },
    { key: 'rendering', label_en: 'Assemble Playable MP4 & Synced SRT', label_ar: 'تجميع ملف MP4 والترجمة المتزامنة SRT', status: 'pending' },
  ];
}

export function hydrateJobRow(row: Record<string, unknown>): GenerationJob {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    job_type: row.job_type as GenerationJob['job_type'],
    mode: row.mode as OperatingMode,
    status: row.status as JobStatus,
    progress_pct: Number(row.progress_pct ?? 0),
    current_stage: String(row.current_stage ?? 'queued'),
    stages: JSON.parse(String(row.stages_json || '[]')) as GenerationJobStage[],
    cost_estimate_usd: Number(row.cost_estimate_usd ?? 0),
    error_message: row.error_message ? String(row.error_message) : null,
    retry_count: Number(row.retry_count ?? 0),
    cancel_requested: Boolean(row.cancel_requested),
    output_video_id: row.output_video_id ? String(row.output_video_id) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export class StudioJobManager {
  private activeProjectJobs = new Set<string>();
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db
      .prepare(
        `UPDATE generation_jobs
         SET status = 'failed', error_message = 'Server restarted before job completed. Safe to retry.', updated_at = datetime('now')
         WHERE status IN ('queued', 'preparing', 'generating_script', 'generating_audio', 'generating_visuals', 'synchronizing', 'rendering')`,
      )
      .run();
  }

  public startRenderJob(
    projectId: string,
    mode: OperatingMode,
    options?: {
      allowCloudTts?: boolean;
      allowPaidVideoGen?: boolean;
      aspectRatio?: VideoAspectRatio;
      resolution?: VideoResolution;
      retryFromJobId?: string;
      userId?: string;
    },
  ): GenerationJob {
    if (this.activeProjectJobs.has(projectId)) {
      throw new Error('A generation job is already active for this project. Wait for completion or cancel it first.');
    }

    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
      | Record<string, unknown>
      | undefined;
    if (!project) {
      throw new Error('Project not found.');
    }

    const sceneRows = this.db
      .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order ASC')
      .all(projectId) as Array<Record<string, unknown>>;
    if (sceneRows.length === 0) {
      throw new Error('Add at least one scene before rendering.');
    }

    const totalDur = sceneRows.reduce((sum, s) => sum + Number(s.duration_sec || 4), 0);
    const cost = estimateGenerationCost(mode, sceneRows.length, totalDur, {
      allowPaidVideoGen: options?.allowPaidVideoGen,
    });
    const jobId = `job-${crypto.randomUUID().slice(0, 12)}`;
    const stages = buildInitialStages();

    let retryCount = 0;
    if (options?.retryFromJobId) {
      const prev = this.db
        .prepare('SELECT retry_count FROM generation_jobs WHERE id = ?')
        .get(options.retryFromJobId) as { retry_count: number } | undefined;
      retryCount = (prev?.retry_count ?? 0) + 1;
    }

    this.db
      .prepare(
        `INSERT INTO generation_jobs
          (id, project_id, job_type, mode, status, progress_pct, current_stage, stages_json, cost_estimate_usd, retry_count, cancel_requested)
         VALUES (?, ?, 'full_render', ?, 'queued', 2, 'preparing', ?, ?, ?, 0)`,
      )
      .run(jobId, projectId, mode, JSON.stringify(stages), cost.estimated_usd, retryCount);

    recordAuditEvent(this.db, {
      userId: options?.userId ?? null,
      projectId,
      action: 'render_job_queued',
      entityType: 'generation_job',
      entityId: jobId,
      details: { mode, scene_count: sceneRows.length, cost_estimate_usd: cost.estimated_usd },
    });

    logEvent('info', 'render_job_queued', { jobId, projectId, mode, sceneCount: sceneRows.length });

    this.activeProjectJobs.add(projectId);
    void this.executeRenderJob(
      jobId,
      projectId,
      mode,
      options?.allowCloudTts ?? true,
      options?.allowPaidVideoGen ?? false,
      options?.aspectRatio,
      options?.resolution,
      options?.userId ?? null,
    );

    const created = this.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as Record<
      string,
      unknown
    >;
    return hydrateJobRow(created);
  }

  public requestCancel(jobId: string): GenerationJob | null {
    const row = this.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;

    this.db
      .prepare(
        `UPDATE generation_jobs SET cancel_requested = 1, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(jobId);

    const updated = this.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as Record<
      string,
      unknown
    >;
    return hydrateJobRow(updated);
  }

  private updateStage(
    jobId: string,
    status: JobStatus,
    progressPct: number,
    activeStageKey: string,
    detail: string,
  ): void {
    const row = this.db.prepare('SELECT stages_json FROM generation_jobs WHERE id = ?').get(jobId) as
      | { stages_json: string }
      | undefined;
    const stages: GenerationJobStage[] = row ? JSON.parse(row.stages_json) : buildInitialStages();

    let passedActive = false;
    for (const s of stages) {
      if (status === 'completed') {
        s.status = 'completed';
      } else if (s.key === activeStageKey) {
        s.status = status === 'failed' || status === 'cancelled' ? 'failed' : 'running';
        s.detail = detail;
        passedActive = true;
      } else if (!passedActive) {
        s.status = 'completed';
      }
    }

    this.db
      .prepare(
        `UPDATE generation_jobs
         SET status = ?, progress_pct = ?, current_stage = ?, stages_json = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(status, progressPct, activeStageKey, JSON.stringify(stages), jobId);
  }

  private isJobCancelled(jobId: string): boolean {
    const row = this.db.prepare('SELECT cancel_requested FROM generation_jobs WHERE id = ?').get(jobId) as
      | { cancel_requested: number }
      | undefined;
    return Boolean(row?.cancel_requested);
  }

  private async executeRenderJob(
    jobId: string,
    projectId: string,
    mode: OperatingMode,
    allowCloudTts: boolean,
    allowPaidVideoGen: boolean,
    aspectRatioOverride: VideoAspectRatio | undefined,
    resolutionOverride: VideoResolution | undefined,
    userId: string | null,
  ): Promise<void> {
    const storageRoot = getStorageRoot();
    const workDir = path.join(storageRoot, 'work', jobId);
    let lastStageKey = 'preparing';
    let lastProgress = 5;

    try {
      this.updateStage(jobId, 'preparing', 10, 'preparing', 'Loading project scenes, lecturer, and voice profile...');
      lastStageKey = 'preparing';
      lastProgress = 10;

      const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<
        string,
        unknown
      >;
      const lecturer = this.db
        .prepare('SELECT * FROM lecturers WHERE id = ?')
        .get(String(project.lecturer_id)) as unknown as Lecturer | undefined;
      if (!lecturer) {
        throw new Error('Selected lecturer profile no longer exists.');
      }
      const voice = this.db
        .prepare('SELECT * FROM voice_profiles WHERE id = ?')
        .get(String(project.voice_id)) as unknown as VoiceProfile | undefined;
      if (!voice) {
        throw new Error('Selected voice profile no longer exists.');
      }
      const environment =
        CLASSROOM_ENVIRONMENTS.find((e) => e.id === String(project.environment_id)) ?? CLASSROOM_ENVIRONMENTS[0];

      const sceneRows = this.db
        .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order ASC')
        .all(projectId) as Array<Record<string, unknown>>;

      const scenes: SceneRecord[] = sceneRows.map((r) => ({
        id: String(r.id),
        project_id: String(r.project_id),
        script_id: r.script_id ? String(r.script_id) : null,
        sort_order: Number(r.sort_order),
        title: String(r.title),
        scene_type: r.scene_type as SceneRecord['scene_type'],
        dialogue: String(r.dialogue ?? ''),
        visual_instructions: String(r.visual_instructions ?? ''),
        code_snippet: String(r.code_snippet ?? ''),
        code_language: String(r.code_language ?? 'cpp'),
        equation_latex: String(r.equation_latex ?? ''),
        bullet_points: JSON.parse(String(r.bullet_points_json || '[]')) as string[],
        subtitle_text: String(r.subtitle_text ?? ''),
        duration_sec: Number(r.duration_sec ?? 4),
        audio_asset_id: r.audio_asset_id ? String(r.audio_asset_id) : null,
        visual_asset_id: r.visual_asset_id ? String(r.visual_asset_id) : null,
        status: (r.status as SceneRecord['status']) ?? 'draft',
        updated_at: String(r.updated_at),
      }));

      // Resolve any pre-generated verified lecturer video assets attached to scenes
      const sceneVisualPaths = new Map<string, string>();
      for (const sc of scenes) {
        if (!sc.visual_asset_id) continue;
        const asset = this.db
          .prepare('SELECT storage_path FROM media_assets WHERE id = ? AND project_id = ?')
          .get(sc.visual_asset_id, projectId) as { storage_path: string } | undefined;
        if (asset?.storage_path && fs.existsSync(asset.storage_path)) {
          sceneVisualPaths.set(sc.id, asset.storage_path);
        }
      }

      const exportId = `exp-${crypto.randomUUID().slice(0, 12)}`;
      const exportsDir = path.join(storageRoot, 'exports');
      const outputMp4Path = path.join(exportsDir, `${exportId}.mp4`);
      const outputSrtPath = path.join(exportsDir, `${exportId}.srt`);

      const resolvedAspectRatio: VideoAspectRatio =
        aspectRatioOverride ?? (project.aspect_ratio === '9:16' ? '9:16' : '16:9');
      const resolvedResolution: VideoResolution =
        resolutionOverride ?? (project.resolution === '1080p' ? '1080p' : '720p');

      const result = await renderProjectVideo({
        projectId,
        projectTitle: project.language === 'ar' ? String(project.title_ar) : String(project.title),
        subject: String(project.subject),
        language: (project.language === 'en' ? 'en' : 'ar') as 'ar' | 'en',
        aspectRatio: resolvedAspectRatio,
        resolution: resolvedResolution,
        lecturer,
        voice,
        environment,
        scenes,
        sceneVisualPaths,
        allowCloudTts,
        attemptExternalLipSync: mode !== 'local',
        allowPaidVideoGen,
        workDir,
        outputMp4Path,
        outputSrtPath,
        isCancelled: () => this.isJobCancelled(jobId),
        onStageProgress: (stage, pct, detail) => {
          const mappedStatus = (
            ['preparing', 'generating_audio', 'synchronizing', 'generating_visuals', 'rendering', 'completed'].includes(
              stage,
            )
              ? stage
              : 'rendering'
          ) as JobStatus;
          lastStageKey = stage;
          lastProgress = pct;
          this.updateStage(jobId, mappedStatus, pct, stage, detail);
        },
      });

      const audioDir = path.join(storageRoot, 'audio', projectId);
      fs.mkdirSync(audioDir, { recursive: true });
      for (const item of result.sceneAudioOutputs) {
        const assetId = `aud-${crypto.randomUUID().slice(0, 10)}`;
        const destWav = path.join(audioDir, `${assetId}.wav`);
        fs.copyFileSync(item.wavPath, destWav);
        const wavStats = fs.statSync(destWav);
        this.db
          .prepare(
            `INSERT INTO media_assets (id, project_id, scene_id, asset_type, mime_type, storage_path, duration_sec, size_bytes, metadata_json)
             VALUES (?, ?, ?, 'audio_wav', 'audio/wav', ?, ?, ?, ?)`,
          )
          .run(
            assetId,
            projectId,
            item.sceneId,
            destWav,
            item.durationSec,
            wavStats.size,
            JSON.stringify({ provider: item.provider }),
          );
        this.db
          .prepare(`UPDATE scenes SET audio_asset_id = ?, duration_sec = ?, status = 'rendered', updated_at = datetime('now') WHERE id = ?`)
          .run(assetId, item.durationSec, item.sceneId);
      }

      this.db
        .prepare(
          `INSERT INTO exported_videos
            (id, project_id, job_id, title, file_path, srt_path, duration_sec, resolution, size_bytes, render_mode, has_real_lipsync, has_real_tts, has_generative_video, academy_published, publish_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'not_published')`,
        )
        .run(
          exportId,
          projectId,
          jobId,
          project.language === 'ar' ? String(project.title_ar) : String(project.title),
          result.mp4Path,
          result.srtPath,
          result.durationSec,
          result.resolution,
          result.sizeBytes,
          result.renderMode,
          result.hasRealLipSync ? 1 : 0,
          result.hasRealTts ? 1 : 0,
          result.hasGenerativeVideo ? 1 : 0,
        );

      this.db
        .prepare(
          `UPDATE generation_jobs
           SET status = 'completed', progress_pct = 100, current_stage = 'completed', output_video_id = ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(exportId, jobId);

      this.db
        .prepare(`UPDATE projects SET status = 'exported', updated_at = datetime('now') WHERE id = ?`)
        .run(projectId);

      recordAuditEvent(this.db, {
        userId,
        projectId,
        action: 'video_exported',
        entityType: 'exported_video',
        entityId: exportId,
        details: {
          duration_sec: result.durationSec,
          size_bytes: result.sizeBytes,
          render_mode: result.renderMode,
          has_real_tts: result.hasRealTts,
          has_real_lipsync: result.hasRealLipSync,
          has_generative_video: result.hasGenerativeVideo,
        },
      });

      logEvent('info', 'render_job_completed', {
        jobId,
        projectId,
        exportId,
        durationSec: result.durationSec,
        renderMode: result.renderMode,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown video rendering error';
      const cancelled = this.isJobCancelled(jobId) || msg.toLowerCase().includes('cancelled');
      const terminalStatus: JobStatus = cancelled ? 'cancelled' : 'failed';
      this.updateStage(jobId, terminalStatus, lastProgress, lastStageKey, msg);
      this.db
        .prepare(
          `UPDATE generation_jobs
           SET status = ?, error_message = ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(terminalStatus, msg, jobId);

      logEvent(cancelled ? 'warn' : 'error', 'render_job_terminated', {
        jobId,
        projectId,
        status: terminalStatus,
        stage: lastStageKey,
        error: msg,
      });
    } finally {
      this.activeProjectJobs.delete(projectId);
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}
