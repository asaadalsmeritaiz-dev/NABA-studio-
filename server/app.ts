import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  CLASSROOM_ENVIRONMENTS,
  initDatabase,
  recordAuditEvent,
  type StudioDatabase,
} from './db.ts';
import {
  detectProviderCapabilities,
  estimateGenerationCost,
} from './providers/capabilityRegistry.ts';
import {
  generateEducationalScript,
  hasGeminiApiKey,
} from './providers/geminiProvider.ts';
import { generateLecturerSceneVideo } from './providers/lecturerEngine.ts';
import {
  authenticateUserCredentials,
  canAccessResource,
  claimDefaultWorkspace,
  createRequireAuth,
  createRequireMediaAuth,
  DEFAULT_INSTRUCTOR_EMAIL,
  DEFAULT_INSTRUCTOR_ID,
  extractBearerToken,
  getConfiguredAdminPasscode,
  issueSessionForUser,
  isWorkspaceClaimRequired,
  lookupUserBySessionToken,
  registerInstructorUser,
  revokeSessionToken,
  type AuthenticatedUser,
  type AuthedRequest,
} from './services/auth.ts';
import { validateCodeExample } from './services/codeValidator.ts';
import { MAX_DOCUMENT_BYTES, parseEducationalDocument } from './services/documentParser.ts';
import { hydrateJobRow, StudioJobManager } from './services/jobManager.ts';
import { logEvent } from './services/logger.ts';
import {
  isPathConfined,
  isValidImageBuffer,
  validateExternalEndpointUrl,
} from './services/security.ts';
import {
  getStorageRoot,
  renderSceneAudio,
  resolveSafeAssetPath,
} from './services/videoPipeline.ts';
import type {
  ExportedVideo,
  Lecturer,
  MediaAssetRecord,
  OperatingMode,
  ProjectDetail,
  ProjectSummary,
  PublishStatus,
  SceneRecord,
  ScriptRecord,
  VoiceProfile,
} from '../src/types/studio.ts';

const ClaimWorkspaceSchema = z.object({
  claim_code: z.string().min(16).max(256),
  password: z.string().min(8).max(128),
  name: z.string().min(2).max(80).optional(),
});

const RegisterSchema = z.object({
  email: z.string().email().max(160),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(128),
  locale: z.enum(['ar', 'en']).default('ar'),
});

const LoginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(4).max(128),
});

const CreateProjectSchema = z.object({
  title: z.string().min(2).max(160),
  title_ar: z.string().min(2).max(160).optional(),
  subject: z.string().min(2).max(100),
  education_level: z.enum(['k12', 'high_school', 'undergraduate', 'graduate', 'professional']).default('undergraduate'),
  language: z.enum(['ar', 'en']).default('ar'),
  mode: z.enum(['local', 'cloud', 'hybrid']).default('local'),
  aspect_ratio: z.enum(['16:9', '9:16']).default('16:9'),
  resolution: z.enum(['720p', '1080p']).default('720p'),
  lecturer_id: z.string().min(1).default('lec-tariq'),
  voice_id: z.string().min(1).default('voice-ar-tariq'),
  environment_id: z.string().min(1).default('env-lecture-hall'),
  academy_course_id: z.string().max(80).nullable().optional(),
  academy_lesson_id: z.string().max(80).nullable().optional(),
});

const UpdateProjectSchema = z.object({
  title: z.string().min(2).max(160).optional(),
  title_ar: z.string().min(2).max(160).optional(),
  subject: z.string().min(2).max(100).optional(),
  education_level: z.enum(['k12', 'high_school', 'undergraduate', 'graduate', 'professional']).optional(),
  language: z.enum(['ar', 'en']).optional(),
  mode: z.enum(['local', 'cloud', 'hybrid']).optional(),
  aspect_ratio: z.enum(['16:9', '9:16']).optional(),
  resolution: z.enum(['720p', '1080p']).optional(),
  lecturer_id: z.string().min(1).optional(),
  voice_id: z.string().min(1).optional(),
  environment_id: z.string().min(1).optional(),
  academy_course_id: z.string().max(80).nullable().optional(),
  academy_lesson_id: z.string().max(80).nullable().optional(),
});

const GenerateScriptSchema = z.object({
  topic: z.string().min(3).max(400),
  target_duration_sec: z.number().min(8).max(180).default(20),
  material_id: z.string().optional(),
});

const ManualScriptSchema = z.object({
  raw_script: z.string().min(12).max(15000),
  target_duration_sec: z.number().min(8).max(300).optional(),
});

const SceneInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(180),
  scene_type: z.enum(['intro', 'smartboard', 'code', 'equation', 'diagram', 'summary']).default('smartboard'),
  dialogue: z.string().max(3000).default(''),
  visual_instructions: z.string().max(1500).default(''),
  code_snippet: z.string().max(4000).default(''),
  code_language: z.string().max(30).default('cpp'),
  equation_latex: z.string().max(500).default(''),
  bullet_points: z.array(z.string().max(260)).max(6).default([]),
  subtitle_text: z.string().max(1000).default(''),
  duration_sec: z.number().min(2).max(90).default(5),
});

const RenderRequestSchema = z.object({
  mode: z.enum(['local', 'cloud', 'hybrid']).optional(),
  aspect_ratio: z.enum(['16:9', '9:16']).optional(),
  resolution: z.enum(['720p', '1080p']).optional(),
  allow_cloud_tts: z.boolean().default(true),
  allow_paid_video_gen: z.boolean().default(false),
  retry_from_job_id: z.string().optional(),
});

const LecturerVideoRequestSchema = z.object({
  allow_paid_video_gen: z.boolean().default(false),
});

const LecturerConsentReviewSchema = z.object({
  authorization_reference: z.string().trim().min(6).max(240),
});

const CodeCheckSchema = z.object({
  code: z.string().min(1).max(8000),
  language: z.string().min(1).max(30).default('cpp'),
});

const VoicePreviewSchema = z.object({
  voice_id: z.string().min(1),
  text: z.string().min(2).max(400),
  speaking_rate: z.number().min(0.75).max(1.4).default(1.0),
});

const PublishSchema = z.object({
  course_id: z.string().min(2).max(80).default('NABA-CS101'),
  lesson_id: z.string().min(2).max(80).default('LESSON-01'),
  student_access: z.enum(['enrolled_students', 'public_preview', 'instructors_only']).default('enrolled_students'),
});

function createRateLimiter(maxPerMinute: number) {
  const buckets = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'local';
    const now = Date.now();
    const recent = (buckets.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= maxPerMinute) {
      res.status(429).json({ error: 'Rate limit exceeded. Please wait briefly before retrying.' });
      return;
    }
    recent.push(now);
    buckets.set(key, recent);
    next();
  };
}

function normalizePublishStatus(row: Record<string, unknown>): PublishStatus {
  const raw = String(row.publish_status ?? '');
  if (raw === 'prepared_local' || raw === 'remote_published' || raw === 'remote_failed' || raw === 'not_published') {
    return raw;
  }
  return Boolean(row.academy_published) ? 'remote_published' : 'not_published';
}

export interface StudioAppContext {
  app: Express;
  studioDb: StudioDatabase;
  jobManager: StudioJobManager;
}

export function createStudioApp(customDbPath?: string): StudioAppContext {
  const studioDb = initDatabase(customDbPath);
  const { db } = studioDb;
  const jobManager = new StudioJobManager(db);
  const app = express();

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        "connect-src 'self' ws: wss:",
        "worker-src 'self' blob:",
      ].join('; '),
    );
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  const requireAuth = createRequireAuth(db);
  const requireMediaAuth = createRequireMediaAuth(db);

  const uploadDoc = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_DOCUMENT_BYTES },
  });

  const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  const authRateLimit = createRateLimiter(40);
  const aiRateLimit = createRateLimiter(30);
  const uploadRateLimit = createRateLimiter(20);
  const publishRateLimit = createRateLimiter(20);

  function verifyProjectOwnership(
    projectId: string,
    user: AuthenticatedUser,
  ): { ok: true; row: Record<string, unknown> } | { ok: false; status: number; error: string } {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      return { ok: false, status: 404, error: 'Project not found' };
    }
    const ownerId = row.user_id ? String(row.user_id) : null;
    if (!canAccessResource(ownerId, user)) {
      return { ok: false, status: 403, error: 'Forbidden: you do not have access to this project.' };
    }
    return { ok: true, row };
  }

  function hydrateExportRow(e: Record<string, unknown>): ExportedVideo & { subject?: string; download_url?: string } {
    const filePath = String(e.file_path ?? '');
    const storageRoot = getStorageRoot();
    const resolved = filePath ? path.resolve(filePath) : '';
    const fileExists = Boolean(resolved && isPathConfined(resolved, storageRoot) && fs.existsSync(resolved));
    return {
      id: String(e.id),
      project_id: String(e.project_id),
      job_id: e.job_id ? String(e.job_id) : null,
      title: String(e.title),
      ...(e.subject ? { subject: String(e.subject) } : {}),
      file_path: filePath,
      video_url: `/api/exports/${String(e.id)}/stream`,
      download_url: `/api/exports/${String(e.id)}/download`,
      srt_url: `/api/exports/${String(e.id)}/srt`,
      duration_sec: Number(e.duration_sec || 0),
      resolution: String(e.resolution || '1280x720'),
      size_bytes: Number(e.size_bytes || 0),
      render_mode: String(e.render_mode),
      has_real_lipsync: Boolean(e.has_real_lipsync),
      has_real_tts: Boolean(e.has_real_tts),
      has_generative_video: Boolean(e.has_generative_video),
      academy_published: Boolean(e.academy_published),
      publish_status: normalizePublishStatus(e),
      academy_payload: e.academy_payload_json ? JSON.parse(String(e.academy_payload_json)) : null,
      file_exists: fileExists,
      created_at: String(e.created_at),
    };
  }

  function getProjectDetail(projectId: string): ProjectDetail | null {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;

    const materials = db
      .prepare(
        `SELECT id, project_id, filename, mime_type, size_bytes, extracted_text, source_checksum, created_at
         FROM educational_materials WHERE project_id = ? ORDER BY created_at DESC`,
      )
      .all(projectId) as unknown as ProjectDetail['materials'];

    const scriptRow = db
      .prepare('SELECT * FROM scripts WHERE project_id = ? ORDER BY version DESC LIMIT 1')
      .get(projectId) as Record<string, unknown> | undefined;

    const script: ScriptRecord | null = scriptRow
      ? {
          id: String(scriptRow.id),
          project_id: String(scriptRow.project_id),
          version: Number(scriptRow.version),
          learning_objectives: JSON.parse(String(scriptRow.learning_objectives_json || '[]')),
          key_concepts: JSON.parse(String(scriptRow.key_concepts_json || '[]')),
          summary: String(scriptRow.summary || ''),
          source_attribution: JSON.parse(
            String(
              scriptRow.source_attribution_json ||
                '{"source_grounded_points":[],"ai_elaboration_points":[],"citation_note":""}',
            ),
          ),
          approved: Boolean(scriptRow.approved),
          approved_by: scriptRow.approved_by ? String(scriptRow.approved_by) : null,
          approved_at: scriptRow.approved_at ? String(scriptRow.approved_at) : null,
          created_at: String(scriptRow.created_at),
        }
      : null;

    const sceneRows = db
      .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order ASC')
      .all(projectId) as Array<Record<string, unknown>>;

    const scenes: SceneRecord[] = sceneRows.map((s) => ({
      id: String(s.id),
      project_id: String(s.project_id),
      script_id: s.script_id ? String(s.script_id) : null,
      sort_order: Number(s.sort_order),
      title: String(s.title),
      scene_type: s.scene_type as SceneRecord['scene_type'],
      dialogue: String(s.dialogue ?? ''),
      visual_instructions: String(s.visual_instructions ?? ''),
      code_snippet: String(s.code_snippet ?? ''),
      code_language: String(s.code_language ?? 'cpp'),
      equation_latex: String(s.equation_latex ?? ''),
      bullet_points: JSON.parse(String(s.bullet_points_json || '[]')),
      subtitle_text: String(s.subtitle_text ?? ''),
      duration_sec: Number(s.duration_sec ?? 4),
      audio_asset_id: s.audio_asset_id ? String(s.audio_asset_id) : null,
      audio_url: s.audio_asset_id ? `/api/media/audio/${String(s.audio_asset_id)}` : null,
      visual_asset_id: s.visual_asset_id ? String(s.visual_asset_id) : null,
      visual_url: s.visual_asset_id ? `/api/media/video/${String(s.visual_asset_id)}` : null,
      status: (s.status as SceneRecord['status']) ?? 'draft',
      updated_at: String(s.updated_at),
    }));

    const assetRows = db
      .prepare('SELECT * FROM media_assets WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as Array<Record<string, unknown>>;

    const mediaAssets: MediaAssetRecord[] = assetRows.map((a) => {
      const assetType = String(a.asset_type);
      const id = String(a.id);
      const isVideo = assetType === 'lecturer_video' || String(a.mime_type || '').startsWith('video/');
      return {
        id,
        project_id: String(a.project_id),
        scene_id: a.scene_id ? String(a.scene_id) : null,
        asset_type: assetType,
        mime_type: String(a.mime_type),
        url: isVideo ? `/api/media/video/${id}` : `/api/media/audio/${id}`,
        duration_sec: Number(a.duration_sec || 0),
        size_bytes: Number(a.size_bytes || 0),
        metadata: JSON.parse(String(a.metadata_json || '{}')),
        created_at: String(a.created_at),
      };
    });

    const jobRows = db
      .prepare('SELECT * FROM generation_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 12')
      .all(projectId) as Array<Record<string, unknown>>;
    const jobs = jobRows.map(hydrateJobRow);

    const exportRows = db
      .prepare('SELECT * FROM exported_videos WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as Array<Record<string, unknown>>;
    const exportsList: ExportedVideo[] = exportRows.map((e) => hydrateExportRow(e));

    const totalDuration = scenes.reduce((acc, s) => acc + s.duration_sec, 0);

    return {
      id: String(row.id),
      title: String(row.title),
      title_ar: String(row.title_ar),
      subject: String(row.subject),
      education_level: String(row.education_level),
      language: (row.language === 'en' ? 'en' : 'ar') as 'ar' | 'en',
      mode: row.mode as OperatingMode,
      aspect_ratio: (row.aspect_ratio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16',
      resolution: (row.resolution === '1080p' ? '1080p' : '720p') as '720p' | '1080p',
      lecturer_id: String(row.lecturer_id),
      voice_id: String(row.voice_id),
      environment_id: String(row.environment_id),
      status: String(row.status),
      academy_course_id: row.academy_course_id ? String(row.academy_course_id) : null,
      academy_lesson_id: row.academy_lesson_id ? String(row.academy_lesson_id) : null,
      scene_count: scenes.length,
      total_duration_sec: Number(totalDuration.toFixed(1)),
      export_count: exportsList.length,
      latest_video_url: exportsList[0]?.video_url ?? null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      materials,
      media_assets: mediaAssets,
      script,
      scenes,
      jobs,
      exports: exportsList,
    };
  }

  // ---------------------------------------------------------------------------
  // Public Health & Authentication Endpoints
  // ---------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'naba-ai-video-studio',
      gemini_configured: hasGeminiApiKey(),
    });
  });

  app.get('/api/auth/status', (req, res) => {
    const bearer = extractBearerToken(req);
    const user = bearer ? lookupUserBySessionToken(db, bearer) : null;
    res.json({
      authenticated: Boolean(user),
      claim_required: isWorkspaceClaimRequired(db),
      passcode_configured: Boolean(getConfiguredAdminPasscode()),
      default_email: DEFAULT_INSTRUCTOR_EMAIL,
      user,
    });
  });

  app.post('/api/auth/claim', authRateLimit, (req, res) => {
    const parsed = ClaimWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Please provide an instructor password of at least 8 characters.',
        issues: parsed.error.issues,
      });
      return;
    }

    const result = claimDefaultWorkspace(
      db,
      parsed.data.password,
      parsed.data.claim_code,
      parsed.data.name,
    );
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const session = issueSessionForUser(db, result.user.id);
    recordAuditEvent(db, {
      userId: result.user.id,
      action: 'workspace_claimed',
      entityType: 'user',
      entityId: result.user.id,
      details: { email: result.user.email },
    });
    logEvent('info', 'workspace_claimed', { userId: result.user.id });

    res.status(201).json({
      token: session.token,
      media_token: session.mediaToken,
      expires_at: session.expiresAt,
      user: result.user,
    });
  });

  app.post('/api/auth/register', authRateLimit, (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Please provide a valid email, name, and password (at least 8 characters).',
        issues: parsed.error.issues,
      });
      return;
    }

    const result = registerInstructorUser(db, parsed.data);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const session = issueSessionForUser(db, result.user.id);
    recordAuditEvent(db, {
      userId: result.user.id,
      action: 'user_registered',
      entityType: 'user',
      entityId: result.user.id,
      details: { email: result.user.email },
    });

    res.status(201).json({
      token: session.token,
      media_token: session.mediaToken,
      expires_at: session.expiresAt,
      user: result.user,
    });
  });

  app.post('/api/auth/login', authRateLimit, (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email and password are required.' });
      return;
    }

    const user = authenticateUserCredentials(db, parsed.data.email, parsed.data.password);
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const session = issueSessionForUser(db, user.id);
    recordAuditEvent(db, {
      userId: user.id,
      action: 'user_login',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email },
    });

    res.json({
      token: session.token,
      media_token: session.mediaToken,
      expires_at: session.expiresAt,
      user,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = extractBearerToken(req);
    if (token) {
      revokeSessionToken(db, token);
    }
    res.json({ logged_out: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  // ---------------------------------------------------------------------------
  // Capabilities & Studio Catalog (Protected)
  // ---------------------------------------------------------------------------
  app.get('/api/capabilities', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const capabilities = detectProviderCapabilities();
    const lecturers = (
      user.role === 'admin'
        ? db.prepare('SELECT * FROM lecturers ORDER BY is_custom ASC, created_at ASC').all()
        : db
            .prepare(
              `SELECT * FROM lecturers
               WHERE is_custom = 0 OR owner_user_id = ? OR (? = ? AND owner_user_id IS NULL)
               ORDER BY is_custom ASC, created_at ASC`,
            )
            .all(user.id, user.id, DEFAULT_INSTRUCTOR_ID)
    ) as unknown as Lecturer[];
    const voices = db
      .prepare('SELECT * FROM voice_profiles ORDER BY language ASC, name ASC')
      .all() as unknown as VoiceProfile[];
    res.json({
      capabilities,
      lecturers,
      voices,
      environments: CLASSROOM_ENVIRONMENTS,
    });
  });

  // ---------------------------------------------------------------------------
  // Projects CRUD (Protected + Resource Ownership Enforced)
  // ---------------------------------------------------------------------------
  app.get('/api/projects', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const queryBase = `
      SELECT p.*,
        (SELECT COUNT(*) FROM scenes s WHERE s.project_id = p.id) AS scene_count,
        (SELECT COALESCE(SUM(s.duration_sec), 0) FROM scenes s WHERE s.project_id = p.id) AS total_duration_sec,
        (SELECT COUNT(*) FROM exported_videos e WHERE e.project_id = p.id) AS export_count,
        (SELECT e.id FROM exported_videos e WHERE e.project_id = p.id ORDER BY e.created_at DESC LIMIT 1) AS latest_export_id
      FROM projects p
    `;

    const rows = (
      user.role === 'admin'
        ? db.prepare(`${queryBase} ORDER BY p.updated_at DESC`).all()
        : user.id === DEFAULT_INSTRUCTOR_ID
          ? db
              .prepare(`${queryBase} WHERE p.user_id = ? OR p.user_id IS NULL ORDER BY p.updated_at DESC`)
              .all(user.id)
          : db.prepare(`${queryBase} WHERE p.user_id = ? ORDER BY p.updated_at DESC`).all(user.id)
    ) as Array<Record<string, unknown>>;

    const projects: ProjectSummary[] = rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      title_ar: String(r.title_ar),
      subject: String(r.subject),
      education_level: String(r.education_level),
      language: (r.language === 'en' ? 'en' : 'ar') as 'ar' | 'en',
      mode: r.mode as OperatingMode,
      aspect_ratio: (r.aspect_ratio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16',
      resolution: (r.resolution === '1080p' ? '1080p' : '720p') as '720p' | '1080p',
      lecturer_id: String(r.lecturer_id),
      voice_id: String(r.voice_id),
      environment_id: String(r.environment_id),
      status: String(r.status),
      academy_course_id: r.academy_course_id ? String(r.academy_course_id) : null,
      academy_lesson_id: r.academy_lesson_id ? String(r.academy_lesson_id) : null,
      scene_count: Number(r.scene_count || 0),
      total_duration_sec: Number(Number(r.total_duration_sec || 0).toFixed(1)),
      export_count: Number(r.export_count || 0),
      latest_video_url: r.latest_export_id ? `/api/exports/${String(r.latest_export_id)}/stream` : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));

    res.json({ projects });
  });

  app.post('/api/projects', requireAuth, (req: AuthedRequest, res) => {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid project payload', issues: parsed.error.issues });
      return;
    }

    const user = req.user!;
    const d = parsed.data;
    const id = `proj-${crypto.randomUUID().slice(0, 10)}`;

    db.prepare(
      `INSERT INTO projects
        (id, user_id, title, title_ar, subject, education_level, language, mode, aspect_ratio, resolution, lecturer_id, voice_id, environment_id, status, academy_course_id, academy_lesson_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    ).run(
      id,
      user.id,
      d.title,
      d.title_ar || d.title,
      d.subject,
      d.education_level,
      d.language,
      d.mode,
      d.aspect_ratio,
      d.resolution,
      d.lecturer_id,
      d.voice_id,
      d.environment_id,
      d.academy_course_id ?? null,
      d.academy_lesson_id ?? null,
    );

    const isAr = d.language === 'ar';
    db.prepare(
      `INSERT INTO scenes
        (id, project_id, sort_order, title, scene_type, dialogue, visual_instructions, code_snippet, code_language, bullet_points_json, subtitle_text, duration_sec)
       VALUES (?, ?, 1, ?, 'intro', ?, ?, '', 'cpp', ?, ?, 5.0)`,
    ).run(
      `scn-${crypto.randomUUID().slice(0, 10)}`,
      id,
      isAr ? d.title_ar || d.title : d.title,
      isAr
        ? `مرحبًا بكم في أكاديمية نبأ. في هذا الدرس سنتناول موضوع ${d.title_ar || d.title}.`
        : `Welcome to Naba Academy. In this lesson, we explore ${d.title}.`,
      isAr ? 'مقدمة الدرس على السبورة الذكية مع أهداف التعلم.' : 'Lesson title on smartboard with core objectives.',
      JSON.stringify(isAr ? ['نظرة عامة على الدرس', 'المفاهيم الأساسية'] : ['Lesson Overview', 'Key Concepts']),
      isAr
        ? `مرحبًا بكم في أكاديمية نبأ. في هذا الدرس سنتناول موضوع ${d.title_ar || d.title}.`
        : `Welcome to Naba Academy. In this lesson, we explore ${d.title}.`,
    );

    recordAuditEvent(db, {
      userId: user.id,
      projectId: id,
      action: 'project_created',
      entityType: 'project',
      entityId: id,
      details: { subject: d.subject, language: d.language, mode: d.mode },
    });

    res.status(201).json({ project: getProjectDetail(id) });
  });

  app.get('/api/projects/:id', requireAuth, (req: AuthedRequest, res) => {
    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }
    res.json({ project: getProjectDetail(req.params.id) });
  });

  app.patch('/api/projects/:id', requireAuth, (req: AuthedRequest, res) => {
    const parsed = UpdateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid update payload', issues: parsed.error.issues });
      return;
    }
    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    const data = parsed.data;
    const allowedKeys = [
      'title',
      'title_ar',
      'subject',
      'education_level',
      'language',
      'mode',
      'aspect_ratio',
      'resolution',
      'lecturer_id',
      'voice_id',
      'environment_id',
      'academy_course_id',
      'academy_lesson_id',
    ] as const;

    for (const key of allowedKeys) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(data[key]);
      }
    }

    if (fields.length > 0) {
      fields.push(`updated_at = datetime('now')`);
      values.push(req.params.id);
      db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...(values as never[]));
    }

    res.json({ project: getProjectDetail(req.params.id) });
  });

  app.delete('/api/projects/:id', requireAuth, (req: AuthedRequest, res) => {
    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    recordAuditEvent(db, {
      userId: req.user!.id,
      action: 'project_deleted',
      entityType: 'project',
      entityId: req.params.id,
      details: {},
    });
    res.json({ deleted: true, id: req.params.id });
  });

  // ---------------------------------------------------------------------------
  // Educational Material Uploads & Deletion (PDF, DOCX, PPTX, TXT)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/projects/:id/materials',
    requireAuth,
    uploadRateLimit,
    uploadDoc.single('file'),
    async (req: AuthedRequest, res) => {
      try {
        const ownership = verifyProjectOwnership(req.params.id, req.user!);
        if (!ownership.ok) {
          res.status(ownership.status).json({ error: ownership.error });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'No educational document uploaded.' });
          return;
        }

        const parsedDoc = await parseEducationalDocument(req.file.originalname, req.file.buffer);
        const materialId = `mat-${crypto.randomUUID().slice(0, 10)}`;
        const safeExt = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
        const storageRoot = getStorageRoot();
        const materialsDir = path.join(storageRoot, 'materials', path.basename(req.params.id));
        fs.mkdirSync(materialsDir, { recursive: true });
        const destPath = path.join(materialsDir, `${materialId}${safeExt}`);
        if (!isPathConfined(destPath, storageRoot)) {
          res.status(400).json({ error: 'Invalid upload storage path.' });
          return;
        }
        fs.writeFileSync(destPath, req.file.buffer);

        db.prepare(
          `INSERT INTO educational_materials
            (id, project_id, filename, mime_type, size_bytes, storage_path, extracted_text, source_checksum)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          materialId,
          req.params.id,
          path.basename(req.file.originalname),
          parsedDoc.detectedType,
          req.file.size,
          destPath,
          parsedDoc.extractedText,
          parsedDoc.checksum,
        );

        recordAuditEvent(db, {
          userId: req.user!.id,
          projectId: req.params.id,
          action: 'material_uploaded',
          entityType: 'educational_material',
          entityId: materialId,
          details: { filename: path.basename(req.file.originalname), size_bytes: req.file.size },
        });

        res.status(201).json({
          material: {
            id: materialId,
            project_id: req.params.id,
            filename: path.basename(req.file.originalname),
            mime_type: parsedDoc.detectedType,
            size_bytes: req.file.size,
            extracted_text: parsedDoc.extractedText,
            source_checksum: parsedDoc.checksum,
          },
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse document.' });
      }
    },
  );

  app.delete('/api/projects/:id/materials/:materialId', requireAuth, (req: AuthedRequest, res) => {
    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const mat = db
      .prepare('SELECT id, storage_path FROM educational_materials WHERE id = ? AND project_id = ?')
      .get(req.params.materialId, req.params.id) as { id: string; storage_path: string } | undefined;
    if (!mat) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }

    const storageRoot = getStorageRoot();
    if (mat.storage_path && isPathConfined(mat.storage_path, storageRoot) && fs.existsSync(mat.storage_path)) {
      fs.rmSync(mat.storage_path, { force: true });
    }
    db.prepare('DELETE FROM educational_materials WHERE id = ? AND project_id = ?').run(
      req.params.materialId,
      req.params.id,
    );

    recordAuditEvent(db, {
      userId: req.user!.id,
      projectId: req.params.id,
      action: 'material_deleted',
      entityType: 'educational_material',
      entityId: req.params.materialId,
      details: {},
    });

    res.json({ deleted: true, project: getProjectDetail(req.params.id) });
  });

  app.delete('/api/projects/:id/assets/:assetId', requireAuth, (req: AuthedRequest, res) => {
    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const asset = db
      .prepare('SELECT id, storage_path FROM media_assets WHERE id = ? AND project_id = ?')
      .get(req.params.assetId, req.params.id) as { id: string; storage_path: string } | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Media asset not found' });
      return;
    }

    db.prepare('UPDATE scenes SET audio_asset_id = NULL WHERE project_id = ? AND audio_asset_id = ?').run(
      req.params.id,
      req.params.assetId,
    );
    db.prepare('UPDATE scenes SET visual_asset_id = NULL WHERE project_id = ? AND visual_asset_id = ?').run(
      req.params.id,
      req.params.assetId,
    );

    const storageRoot = getStorageRoot();
    if (asset.storage_path && isPathConfined(asset.storage_path, storageRoot) && fs.existsSync(asset.storage_path)) {
      fs.rmSync(asset.storage_path, { force: true });
    }
    db.prepare('DELETE FROM media_assets WHERE id = ? AND project_id = ?').run(
      req.params.assetId,
      req.params.id,
    );

    recordAuditEvent(db, {
      userId: req.user!.id,
      projectId: req.params.id,
      action: 'media_asset_deleted',
      entityType: 'media_asset',
      entityId: req.params.assetId,
      details: {},
    });

    res.json({ deleted: true, project: getProjectDetail(req.params.id) });
  });

  // ---------------------------------------------------------------------------
  // AI Script Generation & Instructor Approval
  // ---------------------------------------------------------------------------
  app.post('/api/projects/:id/script/generate', requireAuth, aiRateLimit, async (req: AuthedRequest, res) => {
    const parsed = GenerateScriptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid script generation request', issues: parsed.error.issues });
      return;
    }

    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }
    const project = ownership.row;

    let sourceMaterialText: string | undefined;
    let sourceFilename: string | undefined;
    if (parsed.data.material_id) {
      const mat = db
        .prepare('SELECT filename, extracted_text FROM educational_materials WHERE id = ? AND project_id = ?')
        .get(parsed.data.material_id, req.params.id) as { filename: string; extracted_text: string } | undefined;
      if (mat) {
        sourceMaterialText = mat.extracted_text;
        sourceFilename = mat.filename;
      }
    } else {
      const latestMat = db
        .prepare('SELECT filename, extracted_text FROM educational_materials WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(req.params.id) as { filename: string; extracted_text: string } | undefined;
      if (latestMat) {
        sourceMaterialText = latestMat.extracted_text;
        sourceFilename = latestMat.filename;
      }
    }

    try {
      const generated = await generateEducationalScript({
        topic: parsed.data.topic,
        subject: String(project.subject),
        educationLevel: String(project.education_level),
        language: (project.language === 'en' ? 'en' : 'ar') as 'ar' | 'en',
        targetDurationSec: parsed.data.target_duration_sec,
        sourceMaterialText,
        sourceFilename,
      });

      const versionRow = db
        .prepare('SELECT COALESCE(MAX(version), 0) AS max_ver FROM scripts WHERE project_id = ?')
        .get(req.params.id) as { max_ver: number };
      const nextVersion = Number(versionRow?.max_ver ?? 0) + 1;
      const scriptId = `scr-${crypto.randomUUID().slice(0, 10)}`;

      db.prepare(
        `INSERT INTO scripts
          (id, project_id, version, learning_objectives_json, key_concepts_json, summary, source_attribution_json, approved)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(
        scriptId,
        req.params.id,
        nextVersion,
        JSON.stringify(generated.learning_objectives),
        JSON.stringify(generated.key_concepts),
        generated.summary,
        JSON.stringify(generated.source_attribution),
      );

      db.prepare('DELETE FROM scenes WHERE project_id = ?').run(req.params.id);
      const insertScene = db.prepare(`
        INSERT INTO scenes
          (id, project_id, script_id, sort_order, title, scene_type, dialogue, visual_instructions, code_snippet, code_language, equation_latex, bullet_points_json, subtitle_text, duration_sec, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `);

      generated.scenes.forEach((sc, idx) => {
        insertScene.run(
          `scn-${crypto.randomUUID().slice(0, 10)}`,
          req.params.id,
          scriptId,
          idx + 1,
          sc.title,
          sc.scene_type,
          sc.dialogue,
          sc.visual_instructions,
          sc.code_snippet,
          sc.code_language,
          sc.equation_latex,
          JSON.stringify(sc.bullet_points),
          sc.subtitle_text,
          sc.duration_sec,
        );
      });

      db.prepare(`UPDATE projects SET status = 'script_draft', updated_at = datetime('now') WHERE id = ?`).run(
        req.params.id,
      );

      recordAuditEvent(db, {
        userId: req.user!.id,
        projectId: req.params.id,
        action: 'script_generated',
        entityType: 'script',
        entityId: scriptId,
        details: { provider: generated.provider, scene_count: generated.scenes.length },
      });

      res.json({
        provider: generated.provider,
        project: getProjectDetail(req.params.id),
      });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'Script generation failed.',
      });
    }
  });

  app.post('/api/projects/:id/script/manual', requireAuth, (req: AuthedRequest, res) => {
    const parsed = ManualScriptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please paste at least one paragraph of script text.' });
      return;
    }

    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const project = ownership.row;
    const isAr = project.language !== 'en';
    const raw = parsed.data.raw_script.trim();

    // Split pasted script cleanly into logical scenes (by --- separators or blank lines)
    const rawBlocks = raw
      .split(/\n\s*---+\s*\n|\n{2,}/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    const blocks = rawBlocks.length > 0 ? rawBlocks.slice(0, 12) : [raw];

    const versionRow = db
      .prepare('SELECT COALESCE(MAX(version), 0) AS max_ver FROM scripts WHERE project_id = ?')
      .get(req.params.id) as { max_ver: number };
    const nextVersion = Number(versionRow?.max_ver ?? 0) + 1;
    const scriptId = `scr-${crypto.randomUUID().slice(0, 10)}`;

    const summary = blocks[0].replace(/```[\s\S]*?```/g, '').trim().slice(0, 180);
    db.prepare(
      `INSERT INTO scripts
        (id, project_id, version, learning_objectives_json, key_concepts_json, summary, source_attribution_json, approved, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))`,
    ).run(
      scriptId,
      req.params.id,
      nextVersion,
      JSON.stringify([isAr ? 'شرح محتوى الدرس المرفق من المعلّم' : 'Instructor-authored lesson walkthrough']),
      JSON.stringify([String(project.subject)]),
      summary,
      JSON.stringify({
        source_grounded_points: [isAr ? 'النص مُدخل مباشرة بواسطة المعلّم' : 'Directly authored by instructor'],
        ai_elaboration_points: [],
        citation_note: isAr ? 'نص يدوي معتمد' : 'Instructor manual script',
      }),
      req.user!.name,
    );

    db.prepare('DELETE FROM scenes WHERE project_id = ?').run(req.params.id);
    const insertScene = db.prepare(`
      INSERT INTO scenes
        (id, project_id, script_id, sort_order, title, scene_type, dialogue, visual_instructions, code_snippet, code_language, equation_latex, bullet_points_json, subtitle_text, duration_sec, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'draft')
    `);

    blocks.forEach((block, idx) => {
      const codeMatch = block.match(/```(\w+)?\n([\s\S]*?)```/);
      const codeSnippet = codeMatch ? codeMatch[2].trim() : '';
      const codeLang = codeMatch && codeMatch[1] ? codeMatch[1].toLowerCase() : 'cpp';
      const dialogueText = block.replace(/```[\s\S]*?```/g, '').trim() || (isAr ? 'مثال عملي على الكود' : 'Practical code example');
      const firstLine = dialogueText.split(/\r?\n/)[0].replace(/^#+\s*/, '').trim();
      const title =
        firstLine.length > 0 && firstLine.length <= 72
          ? firstLine
          : isAr
            ? idx === 0
              ? String(project.title_ar || project.title)
              : `المشهد ${idx + 1}`
            : idx === 0
              ? String(project.title)
              : `Scene ${idx + 1}`;
      const sceneType = codeSnippet
        ? 'code'
        : idx === 0
          ? 'intro'
          : idx === blocks.length - 1 && blocks.length > 2
            ? 'summary'
            : 'smartboard';

      const words = dialogueText.split(/\s+/).filter(Boolean).length;
      const estimatedDur = Math.max(4, Math.min(25, Math.round(words / 2.4)));
      const bulletPoints = dialogueText
        .split(/[.!؟\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 6)
        .slice(0, 3);

      insertScene.run(
        `scn-${crypto.randomUUID().slice(0, 10)}`,
        req.params.id,
        scriptId,
        idx + 1,
        title,
        sceneType,
        dialogueText,
        isAr ? 'عرض النقاط الرئيسية على السبورة الذكية' : 'Display key points on smartboard',
        codeSnippet,
        codeLang,
        JSON.stringify(bulletPoints.length > 0 ? bulletPoints : [title]),
        dialogueText.slice(0, 260),
        estimatedDur,
      );
    });

    db.prepare(`UPDATE projects SET status = 'script_approved', updated_at = datetime('now') WHERE id = ?`).run(
      req.params.id,
    );

    recordAuditEvent(db, {
      userId: req.user!.id,
      projectId: req.params.id,
      action: 'manual_script_saved',
      entityType: 'script',
      entityId: scriptId,
      details: { scene_count: blocks.length },
    });

    res.json({ project: getProjectDetail(req.params.id) });
  });

  app.post('/api/projects/:id/script/approve', requireAuth, (req: AuthedRequest, res) => {
    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const reviewer =
      typeof req.body?.approved_by === 'string' && req.body.approved_by.trim()
        ? req.body.approved_by.trim().slice(0, 100)
        : req.user!.name;

    const latestScript = db
      .prepare('SELECT id FROM scripts WHERE project_id = ? ORDER BY version DESC LIMIT 1')
      .get(req.params.id) as { id: string } | undefined;

    if (!latestScript) {
      const scriptId = `scr-${crypto.randomUUID().slice(0, 10)}`;
      db.prepare(
        `INSERT INTO scripts (id, project_id, version, summary, approved, approved_by, approved_at)
         VALUES (?, ?, 1, 'Instructor authored script', 1, ?, datetime('now'))`,
      ).run(scriptId, req.params.id, reviewer);
    } else {
      db.prepare(
        `UPDATE scripts SET approved = 1, approved_by = ?, approved_at = datetime('now') WHERE id = ?`,
      ).run(reviewer, latestScript.id);
    }

    db.prepare(`UPDATE projects SET status = 'script_approved', updated_at = datetime('now') WHERE id = ?`).run(
      req.params.id,
    );

    recordAuditEvent(db, {
      userId: req.user!.id,
      projectId: req.params.id,
      action: 'script_approved',
      entityType: 'script',
      entityId: latestScript?.id ?? req.params.id,
      details: { approved_by: reviewer },
    });

    res.json({ project: getProjectDetail(req.params.id) });
  });

  // ---------------------------------------------------------------------------
  // Scenes CRUD, Reordering, Audio & AI Lecturer Video Generation
  // ---------------------------------------------------------------------------
  app.post('/api/projects/:id/scenes', requireAuth, (req: AuthedRequest, res) => {
    const parsed = SceneInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid scene payload', issues: parsed.error.issues });
      return;
    }

    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const maxOrder = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM scenes WHERE project_id = ?')
      .get(req.params.id) as { m: number };
    const sceneId = `scn-${crypto.randomUUID().slice(0, 10)}`;
    const s = parsed.data;

    db.prepare(
      `INSERT INTO scenes
        (id, project_id, sort_order, title, scene_type, dialogue, visual_instructions, code_snippet, code_language, equation_latex, bullet_points_json, subtitle_text, duration_sec, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    ).run(
      sceneId,
      req.params.id,
      Number(maxOrder.m) + 1,
      s.title,
      s.scene_type,
      s.dialogue,
      s.visual_instructions,
      s.code_snippet,
      s.code_language,
      s.equation_latex,
      JSON.stringify(s.bullet_points),
      s.subtitle_text || s.dialogue,
      s.duration_sec,
    );

    db.prepare(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
    res.status(201).json({ scene_id: sceneId, project: getProjectDetail(req.params.id) });
  });

  app.put('/api/projects/:id/scenes/:sceneId', requireAuth, (req: AuthedRequest, res) => {
    const parsed = SceneInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid scene update', issues: parsed.error.issues });
      return;
    }

    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const existing = db
      .prepare('SELECT * FROM scenes WHERE id = ? AND project_id = ?')
      .get(req.params.sceneId, req.params.id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Scene not found' });
      return;
    }

    const s = parsed.data;
    db.prepare(
      `UPDATE scenes
       SET title = ?, scene_type = ?, dialogue = ?, visual_instructions = ?, code_snippet = ?, code_language = ?,
           equation_latex = ?, bullet_points_json = ?, subtitle_text = ?, duration_sec = ?, updated_at = datetime('now')
       WHERE id = ? AND project_id = ?`,
    ).run(
      s.title ?? String(existing.title),
      s.scene_type ?? String(existing.scene_type),
      s.dialogue ?? String(existing.dialogue ?? ''),
      s.visual_instructions ?? String(existing.visual_instructions ?? ''),
      s.code_snippet ?? String(existing.code_snippet ?? ''),
      s.code_language ?? String(existing.code_language ?? 'cpp'),
      s.equation_latex ?? String(existing.equation_latex ?? ''),
      s.bullet_points ? JSON.stringify(s.bullet_points) : String(existing.bullet_points_json ?? '[]'),
      s.subtitle_text ?? String(existing.subtitle_text ?? ''),
      s.duration_sec ?? Number(existing.duration_sec ?? 4),
      req.params.sceneId,
      req.params.id,
    );

    db.prepare(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
    res.json({ project: getProjectDetail(req.params.id) });
  });

  app.delete('/api/projects/:id/scenes/:sceneId', requireAuth, (req: AuthedRequest, res) => {
    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    db.prepare('DELETE FROM scenes WHERE id = ? AND project_id = ?').run(req.params.sceneId, req.params.id);
    const remaining = db
      .prepare('SELECT id FROM scenes WHERE project_id = ? ORDER BY sort_order ASC')
      .all(req.params.id) as Array<{ id: string }>;
    remaining.forEach((r, idx) => {
      db.prepare('UPDATE scenes SET sort_order = ? WHERE id = ?').run(idx + 1, r.id);
    });
    res.json({ project: getProjectDetail(req.params.id) });
  });

  app.post('/api/projects/:id/scenes/reorder', requireAuth, (req: AuthedRequest, res) => {
    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const schema = z.object({ scene_ids: z.array(z.string().min(1)).min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'scene_ids array required' });
      return;
    }

    parsed.data.scene_ids.forEach((sceneId, idx) => {
      db.prepare('UPDATE scenes SET sort_order = ? WHERE id = ? AND project_id = ?').run(
        idx + 1,
        sceneId,
        req.params.id,
      );
    });
    db.prepare(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
    res.json({ project: getProjectDetail(req.params.id) });
  });

  app.post('/api/projects/:id/scenes/:sceneId/audio', requireAuth, aiRateLimit, async (req: AuthedRequest, res) => {
    try {
      const ownership = verifyProjectOwnership(req.params.id, req.user!);
      if (!ownership.ok) {
        res.status(ownership.status).json({ error: ownership.error });
        return;
      }
      const project = ownership.row;
      const sceneRow = db
        .prepare('SELECT * FROM scenes WHERE id = ? AND project_id = ?')
        .get(req.params.sceneId, req.params.id) as Record<string, unknown> | undefined;

      if (!sceneRow) {
        res.status(404).json({ error: 'Scene not found' });
        return;
      }

      const voice = db
        .prepare('SELECT * FROM voice_profiles WHERE id = ?')
        .get(String(project.voice_id)) as unknown as VoiceProfile;

      const assetId = `aud-${crypto.randomUUID().slice(0, 10)}`;
      const audioDir = path.join(getStorageRoot(), 'audio', path.basename(req.params.id));
      fs.mkdirSync(audioDir, { recursive: true });
      const wavPath = path.join(audioDir, `${assetId}.wav`);

      const scene: SceneRecord = {
        id: String(sceneRow.id),
        project_id: String(sceneRow.project_id),
        script_id: sceneRow.script_id ? String(sceneRow.script_id) : null,
        sort_order: Number(sceneRow.sort_order),
        title: String(sceneRow.title),
        scene_type: sceneRow.scene_type as SceneRecord['scene_type'],
        dialogue: String(sceneRow.dialogue ?? ''),
        visual_instructions: String(sceneRow.visual_instructions ?? ''),
        code_snippet: String(sceneRow.code_snippet ?? ''),
        code_language: String(sceneRow.code_language ?? 'cpp'),
        equation_latex: String(sceneRow.equation_latex ?? ''),
        bullet_points: JSON.parse(String(sceneRow.bullet_points_json || '[]')),
        subtitle_text: String(sceneRow.subtitle_text ?? ''),
        duration_sec: Number(sceneRow.duration_sec ?? 4),
        audio_asset_id: sceneRow.audio_asset_id ? String(sceneRow.audio_asset_id) : null,
        visual_asset_id: sceneRow.visual_asset_id ? String(sceneRow.visual_asset_id) : null,
        status: (sceneRow.status as SceneRecord['status']) ?? 'draft',
        updated_at: String(sceneRow.updated_at),
      };

      const tts = await renderSceneAudio({
        scene,
        language: (project.language === 'en' ? 'en' : 'ar') as 'ar' | 'en',
        voice,
        outputWavPath: wavPath,
        allowCloudTts: true,
      });

      const stats = fs.statSync(wavPath);
      db.prepare(
        `INSERT INTO media_assets (id, project_id, scene_id, asset_type, mime_type, storage_path, duration_sec, size_bytes, metadata_json)
         VALUES (?, ?, ?, 'audio_wav', 'audio/wav', ?, ?, ?, ?)`,
      ).run(
        assetId,
        req.params.id,
        scene.id,
        wavPath,
        tts.durationSec,
        stats.size,
        JSON.stringify({ provider: tts.provider, isRealHumanSpeech: tts.isRealHumanSpeech }),
      );

      // Sync scene duration precisely to generated speech length when real speech is produced
      const syncedDuration = tts.isRealHumanSpeech
        ? Math.max(2.5, Number((tts.durationSec + 0.35).toFixed(1)))
        : Math.max(scene.duration_sec, Number(tts.durationSec.toFixed(1)));

      db.prepare(
        `UPDATE scenes SET audio_asset_id = ?, duration_sec = ?, status = 'audio_ready', updated_at = datetime('now') WHERE id = ?`,
      ).run(assetId, syncedDuration, scene.id);

      res.json({
        audio_url: `/api/media/audio/${assetId}`,
        provider: tts.provider,
        is_real_speech: tts.isRealHumanSpeech,
        duration_sec: tts.durationSec,
        note: tts.note,
        project: getProjectDetail(req.params.id),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Audio generation failed' });
    }
  });

  // Per-scene AI Lecturer Video synthesis (strictly provider-verified, never fabricated)
  app.post(
    '/api/projects/:id/scenes/:sceneId/lecturer-video',
    requireAuth,
    aiRateLimit,
    async (req: AuthedRequest, res) => {
      const parsed = LecturerVideoRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid lecturer video request parameters' });
        return;
      }

      const ownership = verifyProjectOwnership(req.params.id, req.user!);
      if (!ownership.ok) {
        res.status(ownership.status).json({ error: ownership.error });
        return;
      }
      const project = ownership.row;

      const sceneRow = db
        .prepare('SELECT * FROM scenes WHERE id = ? AND project_id = ?')
        .get(req.params.sceneId, req.params.id) as Record<string, unknown> | undefined;
      if (!sceneRow) {
        res.status(404).json({ error: 'Scene not found' });
        return;
      }

      const lecturer = db
        .prepare('SELECT * FROM lecturers WHERE id = ?')
        .get(String(project.lecturer_id)) as unknown as Lecturer | undefined;
      if (!lecturer) {
        res.status(404).json({ error: 'Lecturer profile not found' });
        return;
      }

      const lecturerImagePath = resolveSafeAssetPath(lecturer.image_url);
      if (!lecturerImagePath) {
        res.status(400).json({ error: 'Lecturer reference image is missing or invalid.' });
        return;
      }

      const environment =
        CLASSROOM_ENVIRONMENTS.find((e) => e.id === String(project.environment_id)) ?? CLASSROOM_ENVIRONMENTS[0];

      const scene: SceneRecord = {
        id: String(sceneRow.id),
        project_id: String(sceneRow.project_id),
        script_id: sceneRow.script_id ? String(sceneRow.script_id) : null,
        sort_order: Number(sceneRow.sort_order),
        title: String(sceneRow.title),
        scene_type: sceneRow.scene_type as SceneRecord['scene_type'],
        dialogue: String(sceneRow.dialogue ?? ''),
        visual_instructions: String(sceneRow.visual_instructions ?? ''),
        code_snippet: String(sceneRow.code_snippet ?? ''),
        code_language: String(sceneRow.code_language ?? 'cpp'),
        equation_latex: String(sceneRow.equation_latex ?? ''),
        bullet_points: JSON.parse(String(sceneRow.bullet_points_json || '[]')),
        subtitle_text: String(sceneRow.subtitle_text ?? ''),
        duration_sec: Number(sceneRow.duration_sec ?? 5),
        audio_asset_id: sceneRow.audio_asset_id ? String(sceneRow.audio_asset_id) : null,
        visual_asset_id: sceneRow.visual_asset_id ? String(sceneRow.visual_asset_id) : null,
        status: (sceneRow.status as SceneRecord['status']) ?? 'draft',
        updated_at: String(sceneRow.updated_at),
      };

      const assetId = `vid-${crypto.randomUUID().slice(0, 10)}`;
      const videoDir = path.join(getStorageRoot(), 'lecturer_clips', path.basename(req.params.id));
      fs.mkdirSync(videoDir, { recursive: true });
      const outputVideoPath = path.join(videoDir, `${assetId}.mp4`);

      const result = await generateLecturerSceneVideo({
        lecturer,
        lecturerImagePath,
        environment,
        scene,
        language: (project.language === 'en' ? 'en' : 'ar') as 'ar' | 'en',
        targetDurationSec: scene.duration_sec,
        outputVideoPath,
        allowPaidVideoGen: parsed.data.allow_paid_video_gen,
      });

      if (result.status === 'generated' && result.videoPath && fs.existsSync(result.videoPath)) {
        const stats = fs.statSync(result.videoPath);
        db.prepare(
          `INSERT INTO media_assets (id, project_id, scene_id, asset_type, mime_type, storage_path, duration_sec, size_bytes, metadata_json)
           VALUES (?, ?, ?, 'lecturer_video', 'video/mp4', ?, ?, ?, ?)`,
        ).run(
          assetId,
          req.params.id,
          scene.id,
          result.videoPath,
          result.durationSec ?? scene.duration_sec,
          stats.size,
          JSON.stringify({ provider: result.provider, reason: result.reason }),
        );

        db.prepare(
          `UPDATE scenes SET visual_asset_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`,
        ).run(assetId, scene.id, req.params.id);

        recordAuditEvent(db, {
          userId: req.user!.id,
          projectId: req.params.id,
          action: 'lecturer_video_generated',
          entityType: 'media_asset',
          entityId: assetId,
          details: { provider: result.provider, scene_id: scene.id, duration_sec: result.durationSec },
        });

        res.status(201).json({
          status: 'generated',
          provider: result.provider,
          visual_url: `/api/media/video/${assetId}`,
          duration_sec: result.durationSec,
          reason: result.reason,
          project: getProjectDetail(req.params.id),
        });
        return;
      }

      const httpCode =
        result.status === 'not_configured' ? 503 : result.provider === 'consent-gate' ? 400 : 502;
      res.status(httpCode).json({
        status: result.status,
        provider: result.provider,
        error: result.reason,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // Voice Preview & Custom Lecturers (with Auth + Consent Enforcement)
  // ---------------------------------------------------------------------------
  app.post('/api/voices/preview', requireAuth, aiRateLimit, async (req, res) => {
    const parsed = VoicePreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid voice preview request' });
      return;
    }

    const voice = db
      .prepare('SELECT * FROM voice_profiles WHERE id = ?')
      .get(parsed.data.voice_id) as unknown as VoiceProfile | undefined;
    if (!voice) {
      res.status(404).json({ error: 'Voice profile not found' });
      return;
    }

    try {
      const previewId = `prev-${crypto.randomUUID().slice(0, 10)}`;
      const previewDir = path.join(getStorageRoot(), 'previews');
      fs.mkdirSync(previewDir, { recursive: true });
      const wavPath = path.join(previewDir, `${previewId}.wav`);

      const tts = await renderSceneAudio({
        scene: {
          id: previewId,
          project_id: 'preview',
          script_id: null,
          sort_order: 1,
          title: 'Preview',
          scene_type: 'intro',
          dialogue: parsed.data.text,
          visual_instructions: '',
          code_snippet: '',
          code_language: 'text',
          equation_latex: '',
          bullet_points: [],
          subtitle_text: parsed.data.text,
          duration_sec: 4,
          audio_asset_id: null,
          visual_asset_id: null,
          status: 'draft',
          updated_at: new Date().toISOString(),
        },
        language: voice.language,
        voice: { ...voice, speaking_rate: parsed.data.speaking_rate },
        outputWavPath: wavPath,
        allowCloudTts: true,
      });

      const wavBytes = fs.readFileSync(wavPath);
      fs.rmSync(wavPath, { force: true });

      res.json({
        audio_base64: wavBytes.toString('base64'),
        mime_type: 'audio/wav',
        provider: tts.provider,
        is_real_speech: tts.isRealHumanSpeech,
        duration_sec: tts.durationSec,
        note: tts.note,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Voice preview failed' });
    }
  });

  app.post('/api/lecturers', requireAuth, uploadRateLimit, uploadImage.single('image'), (req: AuthedRequest, res) => {
    const uploaderAttested = req.body?.consent_verified === 'true' || req.body?.consent_verified === true;
    const consentNote = String(req.body?.consent_note || '').trim();
    const name = String(req.body?.name || '').trim();
    const nameAr = String(req.body?.name_ar || name).trim();
    const specialty = String(req.body?.specialty || 'Academic Lecturer').trim();
    const specialtyAr = String(req.body?.specialty_ar || specialty).trim();

    if (!uploaderAttested || consentNote.length < 6) {
      res.status(400).json({
        error:
          'Uploader attestation and an authorization reference are required before submitting a custom lecturer for review.',
      });
      return;
    }

    if (!name || !req.file) {
      res.status(400).json({ error: 'Lecturer name and reference image (JPG/PNG/WEBP) are required.' });
      return;
    }

    const ext = isValidImageBuffer(req.file.buffer);
    if (!ext) {
      res.status(400).json({ error: 'Invalid image signature. Only genuine JPG, PNG, or WEBP files are accepted.' });
      return;
    }

    const lecturerId = `lec-custom-${crypto.randomUUID().slice(0, 8)}`;
    const uploadDir = path.join(getStorageRoot(), 'lecturers');
    fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `${lecturerId}${ext}`;
    const destPath = path.join(uploadDir, filename);
    if (!isPathConfined(destPath, uploadDir)) {
      res.status(400).json({ error: 'Invalid destination path.' });
      return;
    }
    fs.writeFileSync(destPath, req.file.buffer);

    const imageUrl = `/storage/lecturers/${filename}`;
    db.prepare(
      `INSERT INTO lecturers
        (id, name, name_ar, specialty, specialty_ar, bio, bio_ar, image_url, is_custom, consent_verified, consent_note, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    ).run(
      lecturerId,
      name,
      nameAr,
      specialty,
      specialtyAr,
      String(req.body?.bio || 'Authorized custom instructor portrait.'),
      String(req.body?.bio_ar || 'صورة محاضر مخصصة وموثّقة بالموافقة.'),
      imageUrl,
      consentNote,
      req.user!.id,
    );

    recordAuditEvent(db, {
      userId: req.user!.id,
      action: 'custom_lecturer_uploaded',
      entityType: 'lecturer',
      entityId: lecturerId,
      details: { consent_verified: false, uploader_attested: true },
    });

    const created = db.prepare('SELECT * FROM lecturers WHERE id = ?').get(lecturerId);
    res.status(201).json({
      lecturer: created,
      review_status: 'pending',
      message: 'Submitted for administrator consent review. Likeness generation remains disabled until approval.',
    });
  });

  app.post(
    '/api/lecturers/:id/consent-review',
    requireAuth,
    (req: AuthedRequest, res) => {
      if (req.user!.role !== 'admin') {
        res.status(403).json({ error: 'Administrator approval is required to verify likeness consent.' });
        return;
      }

      const parsed = LecturerConsentReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Provide a reviewable authorization reference.' });
        return;
      }

      const lecturer = db
        .prepare('SELECT id, is_custom FROM lecturers WHERE id = ?')
        .get(req.params.id) as { id: string; is_custom: number } | undefined;
      if (!lecturer) {
        res.status(404).json({ error: 'Lecturer not found.' });
        return;
      }
      if (!lecturer.is_custom) {
        res.status(400).json({ error: 'Built-in synthetic lecturers do not require consent review.' });
        return;
      }

      db.prepare(
        `UPDATE lecturers
         SET consent_verified = 1, consent_note = ?, consent_approved_by = ?, consent_approved_at = datetime('now')
         WHERE id = ?`,
      ).run(parsed.data.authorization_reference, req.user!.id, lecturer.id);

      recordAuditEvent(db, {
        userId: req.user!.id,
        action: 'custom_lecturer_consent_approved',
        entityType: 'lecturer',
        entityId: lecturer.id,
        details: { authorization_reference: parsed.data.authorization_reference },
      });

      const reviewed = db.prepare('SELECT * FROM lecturers WHERE id = ?').get(lecturer.id);
      res.json({ lecturer: reviewed, review_status: 'approved' });
    },
  );

  app.get('/storage/lecturers/:filename', requireMediaAuth, (req: AuthedRequest, res) => {
    const baseDir = path.resolve(getStorageRoot(), 'lecturers');
    const safeName = path.basename(req.params.filename);
    const resolved = path.resolve(baseDir, safeName);
    if (!isPathConfined(resolved, baseDir) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const lecturerRow = db
      .prepare('SELECT is_custom, owner_user_id FROM lecturers WHERE image_url = ?')
      .get(`/storage/lecturers/${safeName}`) as { is_custom: number; owner_user_id: string | null } | undefined;

    if (lecturerRow && lecturerRow.is_custom && !canAccessResource(lecturerRow.owner_user_id, req.user!)) {
      res.status(403).json({ error: 'Forbidden: custom lecturer image belongs to another account.' });
      return;
    }

    res.sendFile(resolved);
  });

  // ---------------------------------------------------------------------------
  // Code Validation Endpoint (Honest Compiler/Interpreter Execution)
  // ---------------------------------------------------------------------------
  app.post('/api/tools/validate-code', requireAuth, async (req, res) => {
    const parsed = CodeCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid code check payload' });
      return;
    }
    const result = await validateCodeExample(parsed.data.code, parsed.data.language);
    res.json({ result });
  });

  // ---------------------------------------------------------------------------
  // Cost Estimation & Async Video Render Jobs (Protected + Ownership Verified)
  // ---------------------------------------------------------------------------
  app.get('/api/projects/:id/cost-estimate', requireAuth, (req: AuthedRequest, res) => {
    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const project = getProjectDetail(req.params.id)!;
    const requestedMode = (req.query.mode as OperatingMode) || project.mode;
    const mode: OperatingMode = ['local', 'cloud', 'hybrid'].includes(requestedMode)
      ? requestedMode
      : 'local';
    const allowPaidVideoGen = req.query.allow_paid_video_gen === 'true';
    const estimate = estimateGenerationCost(mode, project.scene_count, project.total_duration_sec, {
      allowPaidVideoGen,
    });
    res.json({ estimate });
  });

  app.post('/api/projects/:id/render', requireAuth, (req: AuthedRequest, res) => {
    const parsed = RenderRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid render parameters' });
      return;
    }

    const ownership = verifyProjectOwnership(req.params.id, req.user!);
    if (!ownership.ok) {
      res.status(ownership.status).json({ error: ownership.error });
      return;
    }

    const projectMode = String(ownership.row.mode) as OperatingMode;

    try {
      const job = jobManager.startRenderJob(req.params.id, parsed.data.mode ?? projectMode, {
        allowCloudTts: parsed.data.allow_cloud_tts,
        allowPaidVideoGen: parsed.data.allow_paid_video_gen,
        aspectRatio: parsed.data.aspect_ratio,
        resolution: parsed.data.resolution,
        retryFromJobId: parsed.data.retry_from_job_id,
        userId: req.user!.id,
      });
      res.status(202).json({ job });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : 'Unable to start render job' });
    }
  });

  app.get('/api/jobs/:jobId', requireAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(
        `SELECT j.*, p.user_id AS project_owner_id
         FROM generation_jobs j
         JOIN projects p ON p.id = j.project_id
         WHERE j.id = ?`,
      )
      .get(req.params.jobId) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (!canAccessResource(row.project_owner_id ? String(row.project_owner_id) : null, req.user!)) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this render job.' });
      return;
    }
    res.json({ job: hydrateJobRow(row) });
  });

  app.post('/api/jobs/:jobId/cancel', requireAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(
        `SELECT j.id, p.user_id AS project_owner_id
         FROM generation_jobs j
         JOIN projects p ON p.id = j.project_id
         WHERE j.id = ?`,
      )
      .get(req.params.jobId) as { id: string; project_owner_id: string | null } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (!canAccessResource(row.project_owner_id, req.user!)) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this render job.' });
      return;
    }

    const updated = jobManager.requestCancel(req.params.jobId);
    if (!updated) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({ job: updated });
  });

  // ---------------------------------------------------------------------------
  // Media Streaming & Downloads (Authenticated + Ownership + Path Confinement)
  // ---------------------------------------------------------------------------
  function streamVideoFile(req: Request, res: Response, resolvedPath: string, mimeType = 'video/mp4') {
    const stat = fs.statSync(resolvedPath);
    const range = req.headers.range;
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = Number.parseInt(startStr, 10);
      const end = endStr ? Number.parseInt(endStr, 10) : stat.size - 1;
      if (Number.isNaN(start) || start < 0 || start >= stat.size || end >= stat.size || start > end) {
        res.status(416).end();
        return;
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mimeType,
      });
      fs.createReadStream(resolvedPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(resolvedPath).pipe(res);
    }
  }

  app.get('/api/media/audio/:assetId', requireMediaAuth, (req: AuthedRequest, res) => {
    const asset = db
      .prepare(
        `SELECT a.storage_path, a.mime_type, p.user_id AS project_owner_id
         FROM media_assets a
         JOIN projects p ON p.id = a.project_id
         WHERE a.id = ?`,
      )
      .get(req.params.assetId) as
      | { storage_path: string; mime_type: string; project_owner_id: string | null }
      | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Audio asset not found' });
      return;
    }
    if (!canAccessResource(asset.project_owner_id, req.user!)) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this media asset.' });
      return;
    }
    const storageRoot = getStorageRoot();
    const resolved = path.resolve(asset.storage_path);
    if (!isPathConfined(resolved, storageRoot) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Audio file missing' });
      return;
    }
    res.setHeader('Content-Type', asset.mime_type || 'audio/wav');
    res.sendFile(resolved);
  });

  app.get('/api/media/video/:assetId', requireMediaAuth, (req: AuthedRequest, res) => {
    const asset = db
      .prepare(
        `SELECT a.storage_path, a.mime_type, p.user_id AS project_owner_id
         FROM media_assets a
         JOIN projects p ON p.id = a.project_id
         WHERE a.id = ?`,
      )
      .get(req.params.assetId) as
      | { storage_path: string; mime_type: string; project_owner_id: string | null }
      | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Video asset not found' });
      return;
    }
    if (!canAccessResource(asset.project_owner_id, req.user!)) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this media asset.' });
      return;
    }
    const storageRoot = getStorageRoot();
    const resolved = path.resolve(asset.storage_path);
    if (!isPathConfined(resolved, storageRoot) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Video asset file missing' });
      return;
    }
    streamVideoFile(req, res, resolved, asset.mime_type || 'video/mp4');
  });

  app.get('/api/exports', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const baseQuery = `
      SELECT e.*, p.title AS project_title, p.title_ar AS project_title_ar, p.subject
      FROM exported_videos e
      JOIN projects p ON p.id = e.project_id
    `;
    const rows = (
      user.role === 'admin'
        ? db.prepare(`${baseQuery} ORDER BY e.created_at DESC`).all()
        : user.id === DEFAULT_INSTRUCTOR_ID
          ? db
              .prepare(`${baseQuery} WHERE p.user_id = ? OR p.user_id IS NULL ORDER BY e.created_at DESC`)
              .all(user.id)
          : db.prepare(`${baseQuery} WHERE p.user_id = ? ORDER BY e.created_at DESC`).all(user.id)
    ) as Array<Record<string, unknown>>;

    res.json({ exports: rows.map((e) => hydrateExportRow(e)) });
  });

  app.get('/api/exports/:exportId/stream', requireMediaAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(
        `SELECT e.file_path, p.user_id AS project_owner_id
         FROM exported_videos e
         JOIN projects p ON p.id = e.project_id
         WHERE e.id = ?`,
      )
      .get(req.params.exportId) as { file_path: string; project_owner_id: string | null } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Export not found' });
      return;
    }
    if (!canAccessResource(row.project_owner_id, req.user!)) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this export.' });
      return;
    }
    const storageRoot = getStorageRoot();
    const resolved = path.resolve(row.file_path);
    if (!isPathConfined(resolved, storageRoot) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Export file not found on disk' });
      return;
    }
    streamVideoFile(req, res, resolved, 'video/mp4');
  });

  app.get('/api/exports/:exportId/download', requireMediaAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(
        `SELECT e.file_path, e.title, p.user_id AS project_owner_id
         FROM exported_videos e
         JOIN projects p ON p.id = e.project_id
         WHERE e.id = ?`,
      )
      .get(req.params.exportId) as { file_path: string; title: string; project_owner_id: string | null } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Export not found' });
      return;
    }
    if (!canAccessResource(row.project_owner_id, req.user!)) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this export.' });
      return;
    }
    const storageRoot = getStorageRoot();
    const resolved = path.resolve(row.file_path);
    if (!isPathConfined(resolved, storageRoot) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Video file not found' });
      return;
    }
    const safeFilename = `${path.basename(req.params.exportId)}.mp4`;
    res.download(resolved, safeFilename);
  });

  app.get('/api/exports/:exportId/srt', requireMediaAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(
        `SELECT e.srt_path, p.user_id AS project_owner_id
         FROM exported_videos e
         JOIN projects p ON p.id = e.project_id
         WHERE e.id = ?`,
      )
      .get(req.params.exportId) as { srt_path: string; project_owner_id: string | null } | undefined;
    if (!row || !row.srt_path) {
      res.status(404).json({ error: 'Subtitle track not found' });
      return;
    }
    if (!canAccessResource(row.project_owner_id, req.user!)) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this subtitle track.' });
      return;
    }
    const storageRoot = getStorageRoot();
    const resolved = path.resolve(row.srt_path);
    if (!isPathConfined(resolved, storageRoot) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'SRT file not found on disk' });
      return;
    }
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.download(resolved, `${path.basename(req.params.exportId)}.srt`);
  });

  app.delete('/api/exports/:exportId', requireAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(
        `SELECT e.id, e.project_id, e.file_path, e.srt_path, p.user_id AS project_owner_id
         FROM exported_videos e
         JOIN projects p ON p.id = e.project_id
         WHERE e.id = ?`,
      )
      .get(req.params.exportId) as
      | { id: string; project_id: string; file_path: string; srt_path: string | null; project_owner_id: string | null }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Export not found' });
      return;
    }
    if (!canAccessResource(row.project_owner_id, req.user!)) {
      res.status(403).json({ error: 'Forbidden: you do not have access to delete this export.' });
      return;
    }

    const storageRoot = getStorageRoot();
    if (row.file_path && isPathConfined(row.file_path, storageRoot) && fs.existsSync(row.file_path)) {
      fs.rmSync(row.file_path, { force: true });
    }
    if (row.srt_path && isPathConfined(row.srt_path, storageRoot) && fs.existsSync(row.srt_path)) {
      fs.rmSync(row.srt_path, { force: true });
    }
    db.prepare('DELETE FROM exported_videos WHERE id = ?').run(row.id);

    recordAuditEvent(db, {
      userId: req.user!.id,
      projectId: row.project_id,
      action: 'export_deleted',
      entityType: 'exported_video',
      entityId: row.id,
      details: {},
    });

    res.json({ deleted: true, id: row.id });
  });

  // ---------------------------------------------------------------------------
  // Naba Academy Integration Bridge (Honest Remote Confirmation)
  // ---------------------------------------------------------------------------
  app.get('/api/academy/manifest', (_req, res) => {
    res.json({
      module: 'naba-ai-video-studio',
      version: '1.1.0',
      integration_mode: 'decoupled_webhook_and_rest',
      remote_endpoint_configured: Boolean(process.env.NABA_ACADEMY_API_URL?.trim()),
      external_production_db_touched: false,
      supported_contracts: [
        'shared_jwt_or_oidc_instructor_sso',
        'course_lesson_import',
        'mp4_and_srt_media_publish_payload',
        'student_acl_metadata',
      ],
      sample_courses: [
        { id: 'NABA-CS101', title_ar: 'أساسيات البرمجة بلغة C++', title_en: 'C++ Programming Fundamentals' },
        { id: 'NABA-MATH201', title_ar: 'التفاضل والتكامل للهندسة', title_en: 'Engineering Calculus' },
        { id: 'NABA-PHYS102', title_ar: 'الفيزياء الجامعية: الميكانيكا', title_en: 'University Physics: Mechanics' },
      ],
    });
  });

  app.post('/api/academy/publish/:exportId', requireAuth, publishRateLimit, async (req: AuthedRequest, res) => {
    const parsed = PublishSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid publish payload', issues: parsed.error.issues });
      return;
    }

    const exportRow = db
      .prepare(
        `SELECT e.*, p.user_id AS project_owner_id
         FROM exported_videos e
         JOIN projects p ON p.id = e.project_id
         WHERE e.id = ?`,
      )
      .get(req.params.exportId) as Record<string, unknown> | undefined;

    if (!exportRow) {
      res.status(404).json({ error: 'Exported video not found' });
      return;
    }
    if (!canAccessResource(exportRow.project_owner_id ? String(exportRow.project_owner_id) : null, req.user!)) {
      res.status(403).json({ error: 'Forbidden: you do not have permission to publish this export.' });
      return;
    }

    const { course_id: courseId, lesson_id: lessonId, student_access: accessScope } = parsed.data;
    const remoteApiUrl = process.env.NABA_ACADEMY_API_URL?.trim() || '';

    const payload: Record<string, unknown> = {
      schema: 'naba.academy.media.publish.v1',
      prepared_at: new Date().toISOString(),
      course_id: courseId,
      lesson_id: lessonId,
      student_access: accessScope,
      video_id: String(exportRow.id),
      title: String(exportRow.title),
      duration_sec: Number(exportRow.duration_sec),
      resolution: String(exportRow.resolution),
      media_stream_path: `/api/exports/${String(exportRow.id)}/stream`,
      subtitle_srt_path: `/api/exports/${String(exportRow.id)}/srt`,
      render_transparency: {
        render_mode: String(exportRow.render_mode),
        has_real_tts: Boolean(exportRow.has_real_tts),
        has_real_lipsync: Boolean(exportRow.has_real_lipsync),
        has_generative_video: Boolean(exportRow.has_generative_video),
      },
      remote_confirmed: false,
    };

    // Never claim remote publication when no Naba Academy remote endpoint is configured
    if (!remoteApiUrl) {
      db.prepare(
        `UPDATE exported_videos
         SET academy_published = 0, publish_status = 'prepared_local', academy_payload_json = ?
         WHERE id = ?`,
      ).run(JSON.stringify(payload), req.params.exportId);

      recordAuditEvent(db, {
        userId: req.user!.id,
        projectId: String(exportRow.project_id),
        action: 'academy_publish_prepared_local',
        entityType: 'exported_video',
        entityId: String(exportRow.id),
        details: { course_id: courseId, lesson_id: lessonId, remote_confirmed: false },
      });

      res.json({
        published: false,
        remote_confirmed: false,
        publish_status: 'prepared_local' as PublishStatus,
        message:
          'Naba Academy remote endpoint (NABA_ACADEMY_API_URL) is not configured. Local publish manifest prepared without claiming remote publication.',
        academy_payload: payload,
      });
      return;
    }

    const urlCheck = validateExternalEndpointUrl(remoteApiUrl, { allowLoopbackForTest: true });
    if (!urlCheck.ok) {
      db.prepare(
        `UPDATE exported_videos
         SET academy_published = 0, publish_status = 'remote_failed', academy_payload_json = ?
         WHERE id = ?`,
      ).run(JSON.stringify({ ...payload, remote_error: urlCheck.error }), req.params.exportId);

      res.status(502).json({
        published: false,
        remote_confirmed: false,
        publish_status: 'remote_failed' as PublishStatus,
        error: `Configured Naba Academy URL rejected: ${urlCheck.error}`,
        academy_payload: payload,
      });
      return;
    }

    try {
      const bodyStr = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Naba-Module': 'naba-ai-video-studio',
      };
      const webhookSecret = process.env.NABA_ACADEMY_WEBHOOK_SECRET?.trim();
      if (webhookSecret) {
        headers['X-Naba-Signature'] = crypto
          .createHmac('sha256', webhookSecret)
          .update(bodyStr)
          .digest('hex');
      }

      const remoteRes = await fetch(urlCheck.url.toString(), {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(15_000),
      });

      if (!remoteRes.ok) {
        const errorText = (await remoteRes.text().catch(() => '')).slice(0, 240);
        const failPayload = {
          ...payload,
          remote_confirmed: false,
          remote_status: remoteRes.status,
          remote_error: errorText || `Remote returned HTTP ${remoteRes.status}`,
        };
        db.prepare(
          `UPDATE exported_videos
           SET academy_published = 0, publish_status = 'remote_failed', academy_payload_json = ?
           WHERE id = ?`,
        ).run(JSON.stringify(failPayload), req.params.exportId);

        recordAuditEvent(db, {
          userId: req.user!.id,
          projectId: String(exportRow.project_id),
          action: 'academy_publish_failed',
          entityType: 'exported_video',
          entityId: String(exportRow.id),
          details: { course_id: courseId, lesson_id: lessonId, remote_status: remoteRes.status },
        });

        res.status(502).json({
          published: false,
          remote_confirmed: false,
          publish_status: 'remote_failed' as PublishStatus,
          error: `Naba Academy destination rejected publication (HTTP ${remoteRes.status}).`,
          academy_payload: failPayload,
        });
        return;
      }

      const confirmedPayload = {
        ...payload,
        remote_confirmed: true,
        published_at: new Date().toISOString(),
        remote_status: remoteRes.status,
      };
      db.prepare(
        `UPDATE exported_videos
         SET academy_published = 1, publish_status = 'remote_published', academy_payload_json = ?
         WHERE id = ?`,
      ).run(JSON.stringify(confirmedPayload), req.params.exportId);

      recordAuditEvent(db, {
        userId: req.user!.id,
        projectId: String(exportRow.project_id),
        action: 'academy_publish_confirmed',
        entityType: 'exported_video',
        entityId: String(exportRow.id),
        details: { course_id: courseId, lesson_id: lessonId, remote_status: remoteRes.status },
      });

      res.json({
        published: true,
        remote_confirmed: true,
        publish_status: 'remote_published' as PublishStatus,
        message: 'Confirmed published to Naba Academy destination.',
        academy_payload: confirmedPayload,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Network error reaching Naba Academy destination.';
      const failPayload = { ...payload, remote_confirmed: false, remote_error: errMsg };
      db.prepare(
        `UPDATE exported_videos
         SET academy_published = 0, publish_status = 'remote_failed', academy_payload_json = ?
         WHERE id = ?`,
      ).run(JSON.stringify(failPayload), req.params.exportId);

      res.status(502).json({
        published: false,
        remote_confirmed: false,
        publish_status: 'remote_failed' as PublishStatus,
        error: `Could not confirm remote publication: ${errMsg}`,
        academy_payload: failPayload,
      });
    }
  });

  app.get('/api/audit', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;

    if (projectId) {
      const ownership = verifyProjectOwnership(projectId, user);
      if (!ownership.ok) {
        res.status(ownership.status).json({ error: ownership.error });
        return;
      }
      const rows = db
        .prepare('SELECT * FROM audit_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 40')
        .all(projectId) as Array<Record<string, unknown>>;
      res.json({ events: rows.map(hydrateAuditRow) });
      return;
    }

    const rows = (
      user.role === 'admin'
        ? db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 40').all()
        : db
            .prepare('SELECT * FROM audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
            .all(user.id)
    ) as Array<Record<string, unknown>>;

    res.json({ events: rows.map(hydrateAuditRow) });
  });

  // Safe error handler middleware (never leaks stack traces or secrets)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ error: `Upload error: ${err.message}` });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Malformed JSON request body.' });
      return;
    }
    logEvent('error', 'unhandled_api_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'An internal studio error occurred.' });
  });

  return { app, studioDb, jobManager };
}

function hydrateAuditRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    user_id: r.user_id ? String(r.user_id) : null,
    project_id: r.project_id ? String(r.project_id) : null,
    action: String(r.action),
    entity_type: String(r.entity_type),
    entity_id: String(r.entity_id),
    details: JSON.parse(String(r.details_json || '{}')),
    created_at: String(r.created_at),
  };
}
