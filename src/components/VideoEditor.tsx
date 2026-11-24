import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  FileText,
  Film,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Video,
  Volume2,
  XCircle,
} from 'lucide-react';
import type {
  ClassroomEnvironment,
  CodeValidationResult,
  GenerationJob,
  Lecturer,
  ProjectDetail,
  SceneRecord,
  StudioLocale,
  VideoAspectRatio,
  VoiceProfile,
} from '../types/studio.ts';
import { t } from '../i18n/strings.ts';
import { studioApi, withMediaToken } from '../lib/api.ts';
import { SceneStagePreview } from './SceneStagePreview.tsx';

interface Props {
  locale: StudioLocale;
  projectId: string;
  lecturers: Lecturer[];
  voices: VoiceProfile[];
  environments: ClassroomEnvironment[];
  onBack: () => void;
  onProjectUpdated: () => Promise<void>;
}

export function VideoEditor({
  locale,
  projectId,
  lecturers,
  voices,
  environments,
  onBack,
  onProjectUpdated,
}: Props) {
  const s = t(locale);
  const isAr = locale === 'ar';
  const BackIcon = isAr ? ArrowRight : ArrowLeft;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SceneRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const [previewMode, setPreviewMode] = useState<'stage' | 'video'>('stage');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [codeCheckResult, setCodeCheckResult] = useState<CodeValidationResult | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [activeJob, setActiveJob] = useState<GenerationJob | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function loadProject(preserveSelection = true) {
    try {
      const res = await studioApi.getProject(projectId);
      setProject(res.project);
      const latestRunning = res.project.jobs.find(
        (j) => !['completed', 'failed', 'cancelled'].includes(j.status),
      );
      if (latestRunning) setActiveJob(latestRunning);

      const scenes = res.project.scenes;
      if (scenes.length > 0) {
        const nextId =
          preserveSelection && selectedSceneId && scenes.some((sc) => sc.id === selectedSceneId)
            ? selectedSceneId
            : scenes[0].id;
        setSelectedSceneId(nextId);
        const found = scenes.find((sc) => sc.id === nextId) ?? scenes[0];
        setDraft(found);
        setDirty(false);
      } else {
        setSelectedSceneId(null);
        setDraft(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر تحميل المشروع' : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void loadProject(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Debounced autosave for active scene edits
  useEffect(() => {
    if (!dirty || !draft || !project) return;
    const timer = window.setTimeout(async () => {
      await saveSceneDraft(draft, true);
    }, 1100);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty]);

  // Poll active export render job
  useEffect(() => {
    if (!activeJob) return;
    if (['completed', 'failed', 'cancelled'].includes(activeJob.status)) return;

    const timer = window.setInterval(async () => {
      try {
        const res = await studioApi.getJob(activeJob.id);
        setActiveJob(res.job);
        if (res.job.status === 'completed') {
          await loadProject(true);
          await onProjectUpdated();
          setPreviewMode('video');
        }
      } catch {
        // Ignore transient poll error
      }
    }, 1400);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob]);

  async function saveSceneDraft(targetDraft: SceneRecord, silent = false) {
    if (!project) return;
    setSaving(true);
    try {
      const res = await studioApi.updateScene(project.id, targetDraft.id, {
        title: targetDraft.title,
        scene_type: targetDraft.scene_type,
        dialogue: targetDraft.dialogue,
        visual_instructions: targetDraft.visual_instructions,
        code_snippet: targetDraft.code_snippet,
        code_language: targetDraft.code_language,
        equation_latex: targetDraft.equation_latex,
        bullet_points: targetDraft.bullet_points,
        subtitle_text: targetDraft.subtitle_text,
        duration_sec: targetDraft.duration_sec,
      });
      setProject(res.project);
      setDirty(false);
      setSavedLabel(s.editorAutosaved);
      if (!silent) {
        await onProjectUpdated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر حفظ التغييرات' : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function selectScene(scene: SceneRecord) {
    if (dirty && draft) {
      void saveSceneDraft(draft, true);
    }
    setSelectedSceneId(scene.id);
    setDraft(scene);
    setDirty(false);
    setCodeCheckResult(null);
    setPreviewMode('stage');
  }

  function updateDraftField<K extends keyof SceneRecord>(field: K, value: SceneRecord[K]) {
    if (!draft) return;
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
    setDirty(true);
    setSavedLabel(null);
  }

  async function handleAddScene() {
    if (!project) return;
    setError(null);
    try {
      const res = await studioApi.addScene(project.id, {
        title: isAr ? `مشهد ${project.scenes.length + 1}` : `Scene ${project.scenes.length + 1}`,
        scene_type: 'smartboard',
        dialogue: isAr ? 'اكتب تعليق هذا المشهد هنا.' : 'Write the spoken narration for this scene.',
        subtitle_text: isAr ? 'اكتب تعليق هذا المشهد هنا.' : 'Write the spoken narration for this scene.',
        bullet_points: [isAr ? 'نقطة رئيسية' : 'Key point'],
        duration_sec: 5,
      });
      setProject(res.project);
      const created = res.project.scenes.find((sc) => sc.id === res.scene_id) ?? res.project.scenes.at(-1);
      if (created) {
        setSelectedSceneId(created.id);
        setDraft(created);
        setDirty(false);
      }
      await onProjectUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add scene');
    }
  }

  async function handleDeleteScene(sceneId: string) {
    if (!project || project.scenes.length <= 1) return;
    try {
      const res = await studioApi.deleteScene(project.id, sceneId);
      setProject(res.project);
      const next = res.project.scenes[0] ?? null;
      setSelectedSceneId(next?.id ?? null);
      setDraft(next);
      setDirty(false);
      await onProjectUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete scene');
    }
  }

  async function handleMoveScene(index: number, delta: -1 | 1) {
    if (!project) return;
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= project.scenes.length) return;
    const ordered = [...project.scenes];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(targetIdx, 0, moved);
    const ids = ordered.map((sc) => sc.id);
    try {
      const res = await studioApi.reorderScenes(project.id, ids);
      setProject(res.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder scenes');
    }
  }

  async function handleRegenerateAudio() {
    if (!project || !draft) return;
    setError(null);
    setAudioBusy(true);
    try {
      if (dirty) await saveSceneDraft(draft, true);
      const res = await studioApi.generateSceneAudio(project.id, draft.id);
      setProject(res.project);
      const updatedScene = res.project.scenes.find((sc) => sc.id === draft.id);
      if (updatedScene) setDraft(updatedScene);
      if (res.audio_url) {
        if (!audioRef.current) audioRef.current = new Audio();
        audioRef.current.src = withMediaToken(res.audio_url);
        await audioRef.current.play().catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر توليد الصوت' : 'Audio generation failed');
    } finally {
      setAudioBusy(false);
    }
  }

  async function handleValidateCode() {
    if (!draft || !draft.code_snippet.trim()) return;
    setCodeBusy(true);
    setCodeCheckResult(null);
    try {
      const res = await studioApi.validateCode(draft.code_snippet, draft.code_language || 'cpp');
      setCodeCheckResult(res.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code check failed');
    } finally {
      setCodeBusy(false);
    }
  }

  async function handleExportVideo() {
    if (!project) return;
    setError(null);
    setExportBusy(true);
    try {
      if (dirty && draft) await saveSceneDraft(draft, true);
      const res = await studioApi.startRender(project.id, {
        mode: project.mode,
        aspect_ratio: project.aspect_ratio,
        resolution: project.resolution,
        allow_cloud_tts: project.mode !== 'local',
        allow_paid_video_gen: false,
      });
      setActiveJob(res.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر بدء التصدير' : 'Export failed to start');
    } finally {
      setExportBusy(false);
    }
  }

  async function handleUpdateProjectMeta(patch: Record<string, unknown>) {
    if (!project) return;
    try {
      const res = await studioApi.updateProject(project.id, patch);
      setProject(res.project);
      await onProjectUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    }
  }

  const currentSceneIndex = useMemo(() => {
    if (!project || !draft) return 0;
    const idx = project.scenes.findIndex((sc) => sc.id === draft.id);
    return idx >= 0 ? idx : 0;
  }, [project, draft]);

  if (loading || !project) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-16 flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-[#C49A6C]" />
      </div>
    );
  }

  const lecturer = lecturers.find((l) => l.id === project.lecturer_id) ?? lecturers[0];
  const environment = environments.find((e) => e.id === project.environment_id) ?? environments[0];
  const latestExport = project.exports.find((e) => e.file_exists !== false) ?? null;
  const isExporting =
    activeJob !== null && !['completed', 'failed', 'cancelled'].includes(activeJob.status);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Top Action Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#654354]/60">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#654354] bg-[#27131F] hover:bg-[#341A29] text-xs font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap shrink-0"
          >
            <BackIcon className="w-4 h-4 text-[#C49A6C]" />
            {s.editorBack}
          </button>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-extrabold text-[#F9F1F4] truncate">
              {isAr ? project.title_ar : project.title}
            </h1>
            <p className="text-xs text-[#C8B7C0] tabular-nums">
              {project.scenes.length} {s.scenesUnit} · {Math.round(project.total_duration_sec)}
              {s.secondsUnit} · {project.aspect_ratio}
              {saving ? ` · ${s.editorSaving}` : savedLabel ? ` · ${savedLabel}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {latestExport && (
            <a
              href={withMediaToken(`/api/exports/${latestExport.id}/download`)}
              download
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#654354] bg-[#27131F] hover:bg-[#341A29] text-xs font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-[#C49A6C]" />
              MP4
            </a>
          )}

          {latestExport && (
            <a
              href={withMediaToken(latestExport.srt_url)}
              download
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#654354] bg-[#27131F] hover:bg-[#341A29] text-xs font-semibold text-[#C8B7C0] hover:text-[#F9F1F4] transition-colors whitespace-nowrap"
            >
              <FileText className="w-4 h-4 text-[#C49A6C]" />
              SRT
            </a>
          )}

          <button
            type="button"
            disabled={isExporting || exportBusy}
            onClick={handleExportVideo}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#78263F] hover:bg-[#9E4761] disabled:opacity-60 text-xs sm:text-sm font-bold text-[#F9F1F4] transition-colors whitespace-nowrap"
          >
            {isExporting || exportBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Film className="w-4 h-4 text-[#C49A6C]" />
            )}
            {s.editorExport}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-[#F07883]/50 bg-[#F07883]/10 px-4 py-3 flex items-center gap-2 text-xs text-[#F07883]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Live Export Progress Strip */}
      {activeJob && !['completed'].includes(activeJob.status) && (
        <div className="rounded-2xl border border-[#C49A6C]/50 bg-[#27131F] p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-bold text-[#F9F1F4]">
              {activeJob.status === 'failed'
                ? activeJob.error_message || (isAr ? 'فشل التصدير' : 'Export failed')
                : activeJob.status === 'cancelled'
                  ? isAr
                    ? 'تم إلغاء التصدير'
                    : 'Export cancelled'
                  : s.genInProgress}
            </span>
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-[#C49A6C] tabular-nums">
                {activeJob.progress_pct}%
              </span>
              {isExporting && (
                <button
                  type="button"
                  onClick={() => void studioApi.cancelJob(activeJob.id).then((r) => setActiveJob(r.job))}
                  className="inline-flex items-center gap-1 text-[#F07883] hover:underline"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  {s.genCancelBtn}
                </button>
              )}
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[#180E15] overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                activeJob.status === 'failed' || activeJob.status === 'cancelled'
                  ? 'bg-[#F07883]'
                  : 'bg-[#C49A6C]'
              }`}
              style={{ width: `${Math.max(4, activeJob.progress_pct)}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Editor Workspace: Preview + Essential Script Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left/Main Column: Large Preview Stage & Compact Timeline */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex p-1 rounded-xl border border-[#654354]/60 bg-[#180E15]">
                <button
                  type="button"
                  onClick={() => setPreviewMode('stage')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                    previewMode === 'stage'
                      ? 'bg-[#78263F] text-[#F9F1F4]'
                      : 'text-[#C8B7C0] hover:text-[#F9F1F4]'
                  }`}
                >
                  {s.editorPreviewStage}
                </button>
                <button
                  type="button"
                  disabled={!latestExport}
                  onClick={() => setPreviewMode('video')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap disabled:opacity-40 ${
                    previewMode === 'video'
                      ? 'bg-[#78263F] text-[#F9F1F4]'
                      : 'text-[#C8B7C0] hover:text-[#F9F1F4]'
                  }`}
                >
                  {s.editorPreviewVideo}
                </button>
              </div>

              {draft?.audio_url && (
                <button
                  type="button"
                  onClick={() => {
                    if (!audioRef.current) audioRef.current = new Audio();
                    audioRef.current.src = withMediaToken(draft.audio_url);
                    void audioRef.current.play();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#341A29] text-xs font-semibold text-[#F9F1F4] whitespace-nowrap"
                >
                  <Volume2 className="w-3.5 h-3.5 text-[#C49A6C]" />
                  {s.editorPreviewAudio}
                </button>
              )}
            </div>

            {previewMode === 'video' && latestExport ? (
              <video
                src={withMediaToken(latestExport.video_url)}
                controls
                className="w-full aspect-video rounded-xl bg-black border border-[#654354]/70"
              />
            ) : draft ? (
              <SceneStagePreview
                scene={draft}
                sceneIndex={currentSceneIndex}
                totalScenes={project.scenes.length}
                projectTitle={isAr ? project.title_ar : project.title}
                subject={project.subject}
                language={project.language}
                locale={locale}
                aspectRatio={project.aspect_ratio}
                lecturer={lecturer}
                environment={environment}
              />
            ) : null}
          </div>

          {/* Compact Visual Timeline */}
          <div className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-bold text-[#C8B7C0] uppercase tracking-wide">
                {s.editorTimeline}
              </h2>
              <button
                type="button"
                onClick={handleAddScene}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#341A29] text-xs font-bold text-[#F9F1F4] whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5 text-[#C49A6C]" />
                {s.addSceneQuick}
              </button>
            </div>

            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {project.scenes.map((sc, idx) => {
                const active = sc.id === draft?.id;
                return (
                  <div
                    key={sc.id}
                    onClick={() => selectScene(sc)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') selectScene(sc);
                    }}
                    className={`min-w-[155px] max-w-[190px] rounded-xl border p-3 cursor-pointer transition-colors shrink-0 space-y-2 ${
                      active
                        ? 'border-[#C49A6C] bg-[#3B0D1E]'
                        : 'border-[#654354]/60 bg-[#180E15] hover:border-[#9E4761]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-mono font-bold text-[#C49A6C] tabular-nums">
                        {String(idx + 1).padStart(2, '0')} · {Math.round(sc.duration_sec)}
                        {s.secondsUnit}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleMoveScene(idx, -1);
                          }}
                          className="p-0.5 text-[#C8B7C0] hover:text-[#F9F1F4] disabled:opacity-30"
                          aria-label="Move scene earlier"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === project.scenes.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleMoveScene(idx, 1);
                          }}
                          className="p-0.5 text-[#C8B7C0] hover:text-[#F9F1F4] disabled:opacity-30"
                          aria-label="Move scene later"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        {project.scenes.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteScene(sc.id);
                            }}
                            className="p-0.5 text-[#C8B7C0] hover:text-[#F07883]"
                            aria-label="Delete scene"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs font-bold text-[#F9F1F4] truncate">{sc.title}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Clean Essential Scene Editor */}
        {draft && (
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[#F9F1F4]">{s.editorEditScript}</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={audioBusy}
                    onClick={handleRegenerateAudio}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#341A29] text-xs font-semibold text-[#F9F1F4] whitespace-nowrap"
                  >
                    {audioBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C49A6C]" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-[#C49A6C]" />
                    )}
                    {s.editorRegenerateScene}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveSceneDraft(draft)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#581629] hover:bg-[#78263F] text-xs font-bold text-[#F9F1F4] whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5 text-[#C49A6C]" />
                    {s.editorSaveScene}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-[#C8B7C0] mb-1">
                    {s.editorSceneTitleLabel}
                  </label>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => updateDraftField('title', e.target.value)}
                    className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2 text-sm text-[#F9F1F4] focus:border-[#C49A6C] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#C8B7C0] mb-1">
                    {s.editorDurationLabel}
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={90}
                    step={0.5}
                    value={draft.duration_sec}
                    onChange={(e) => updateDraftField('duration_sec', Number(e.target.value) || 4)}
                    className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3 py-2 text-sm font-mono tabular-nums text-[#F9F1F4] focus:border-[#C49A6C] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#C8B7C0] mb-1">
                  {s.editorDialogueLabel}
                </label>
                <textarea
                  rows={4}
                  value={draft.dialogue}
                  onChange={(e) => {
                    updateDraftField('dialogue', e.target.value);
                    updateDraftField('subtitle_text', e.target.value.slice(0, 260));
                  }}
                  className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2.5 text-sm text-[#F9F1F4] leading-relaxed focus:border-[#C49A6C] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#C8B7C0] mb-1">
                  {s.editorSubtitleLabel}
                </label>
                <textarea
                  rows={2}
                  value={draft.subtitle_text}
                  onChange={(e) => updateDraftField('subtitle_text', e.target.value)}
                  className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2 text-xs text-[#F9F1F4] leading-relaxed focus:border-[#C49A6C] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#C8B7C0] mb-1">
                  {s.editorBulletsLabel}
                </label>
                <textarea
                  rows={3}
                  value={draft.bullet_points.join('\n')}
                  onChange={(e) =>
                    updateDraftField(
                      'bullet_points',
                      e.target.value
                        .split('\n')
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .slice(0, 6),
                    )
                  }
                  className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2 text-xs text-[#F9F1F4] leading-relaxed focus:border-[#C49A6C] focus:outline-none"
                />
              </div>
            </div>

            {/* Expandable Advanced Scene & Style Tools */}
            <div className="rounded-2xl border border-[#654354]/70 bg-[#27131F] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-bold text-[#C8B7C0] hover:text-[#F9F1F4] transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-[#C49A6C]" />
                  {s.editorAdvancedTools}
                </span>
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showAdvanced && (
                <div className="px-5 pb-5 pt-2 border-t border-[#654354]/40 space-y-4">
                  {/* Quick Project Style Selectors */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[#C8B7C0] mb-1">
                        {s.styleAspectTitle}
                      </label>
                      <select
                        value={project.aspect_ratio}
                        onChange={(e) =>
                          void handleUpdateProjectMeta({
                            aspect_ratio: e.target.value as VideoAspectRatio,
                          })
                        }
                        className="w-full rounded-lg border border-[#654354] bg-[#180E15] px-2.5 py-2 text-xs text-[#F9F1F4]"
                      >
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#C8B7C0] mb-1">
                        {s.styleLecturerTitle}
                      </label>
                      <select
                        value={project.lecturer_id}
                        onChange={(e) => void handleUpdateProjectMeta({ lecturer_id: e.target.value })}
                        className="w-full rounded-lg border border-[#654354] bg-[#180E15] px-2.5 py-2 text-xs text-[#F9F1F4]"
                      >
                        {lecturers.map((l) => (
                          <option key={l.id} value={l.id}>
                            {isAr ? l.name_ar : l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#C8B7C0] mb-1">
                        {s.styleVoiceTitle}
                      </label>
                      <select
                        value={project.voice_id}
                        onChange={(e) => void handleUpdateProjectMeta({ voice_id: e.target.value })}
                        className="w-full rounded-lg border border-[#654354] bg-[#180E15] px-2.5 py-2 text-xs text-[#F9F1F4]"
                      >
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {isAr ? v.name_ar : v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#C8B7C0] mb-1">
                        {s.styleClassroomTitle}
                      </label>
                      <select
                        value={project.environment_id}
                        onChange={(e) =>
                          void handleUpdateProjectMeta({ environment_id: e.target.value })
                        }
                        className="w-full rounded-lg border border-[#654354] bg-[#180E15] px-2.5 py-2 text-xs text-[#F9F1F4]"
                      >
                        {environments.map((env) => (
                          <option key={env.id} value={env.id}>
                            {isAr ? env.name_ar : env.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Code Snippet & Honest Compiler Validator */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-[#C8B7C0]">
                        {s.editorCodeLabel}
                      </label>
                      <div className="flex items-center gap-2">
                        <select
                          value={draft.code_language}
                          onChange={(e) => updateDraftField('code_language', e.target.value)}
                          className="rounded-lg border border-[#654354] bg-[#180E15] px-2 py-1 text-[11px] font-mono text-[#F9F1F4]"
                        >
                          <option value="cpp">cpp</option>
                          <option value="python">python</option>
                          <option value="javascript">javascript</option>
                          <option value="typescript">typescript</option>
                        </select>
                        <button
                          type="button"
                          disabled={codeBusy || !draft.code_snippet.trim()}
                          onClick={handleValidateCode}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#581629] hover:bg-[#78263F] disabled:opacity-50 text-[11px] font-bold text-[#F9F1F4]"
                        >
                          {codeBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3 h-3 text-[#C49A6C]" />
                          )}
                          {s.editorValidateCode}
                        </button>
                      </div>
                    </div>

                    <textarea
                      rows={5}
                      dir="ltr"
                      value={draft.code_snippet}
                      onChange={(e) => updateDraftField('code_snippet', e.target.value)}
                      placeholder="int age = 21;"
                      className="w-full rounded-xl border border-[#654354] bg-[#140911] px-3.5 py-2.5 text-xs font-mono text-[#F9F1F4] focus:border-[#C49A6C] focus:outline-none"
                    />

                    {codeCheckResult && (
                      <div
                        className={`rounded-xl border px-3 py-2 text-xs ${
                          codeCheckResult.unavailable
                            ? 'border-[#E7B66A]/50 bg-[#E7B66A]/10 text-[#E7B66A]'
                            : codeCheckResult.valid
                              ? 'border-[#49B894]/50 bg-[#49B894]/10 text-[#49B894]'
                              : 'border-[#F07883]/50 bg-[#F07883]/10 text-[#F07883]'
                        }`}
                      >
                        <p className="font-bold">{codeCheckResult.validator}</p>
                        {codeCheckResult.diagnostics.map((d, idx) => (
                          <p key={idx} className="mt-0.5 font-mono text-[11px]">
                            {d}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Equation */}
                  <div>
                    <label className="block text-xs font-semibold text-[#C8B7C0] mb-1">
                      {s.editorEquationLabel}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={draft.equation_latex}
                      onChange={(e) => updateDraftField('equation_latex', e.target.value)}
                      placeholder="F = m * a"
                      className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2 text-xs font-mono text-[#F9F1F4] focus:border-[#C49A6C] focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
