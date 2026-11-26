export type StudioLocale = 'ar' | 'en';

export type OperatingMode = 'local' | 'cloud' | 'hybrid';

export type VideoAspectRatio = '16:9' | '9:16';

export type VideoResolution = '720p' | '1080p';

export type SceneType =
  | 'intro'
  | 'smartboard'
  | 'code'
  | 'equation'
  | 'diagram'
  | 'summary';

export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'generating_script'
  | 'generating_audio'
  | 'generating_visuals'
  | 'synchronizing'
  | 'rendering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PublishStatus =
  | 'not_published'
  | 'prepared_local'
  | 'remote_published'
  | 'remote_failed';

export interface StudioUser {
  id: string;
  email: string;
  name: string;
  role: 'instructor' | 'admin' | 'reviewer';
  locale: StudioLocale;
  workspace_claimed: boolean;
}

export interface AuthStatus {
  authenticated: boolean;
  claim_required: boolean;
  passcode_configured: boolean;
  default_email: string;
  user: StudioUser | null;
}

export interface Lecturer {
  id: string;
  name: string;
  name_ar: string;
  specialty: string;
  specialty_ar: string;
  bio: string;
  bio_ar: string;
  image_url: string;
  is_custom: number;
  consent_verified: number;
  consent_note: string | null;
  consent_approved_by?: string | null;
  consent_approved_at?: string | null;
  owner_user_id?: string | null;
  created_at: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  name_ar: string;
  language: 'ar' | 'en';
  provider: string;
  provider_voice_id: string;
  gender: 'male' | 'female';
  style_prompt: string;
  speaking_rate: number;
  is_free_tier: number;
}

export interface ClassroomEnvironment {
  id: string;
  name: string;
  name_ar: string;
  description: string;
  description_ar: string;
  image_url: string;
  accent_hex: string;
  board_style: 'navy_glass' | 'slate_studio' | 'chalk_minimal';
}

export interface EducationalMaterial {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  extracted_text: string;
  source_checksum: string;
  created_at: string;
}

export interface MediaAssetRecord {
  id: string;
  project_id: string;
  scene_id: string | null;
  asset_type: string;
  mime_type: string;
  duration_sec: number;
  size_bytes: number;
  url: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SourceAttribution {
  source_grounded_points: string[];
  ai_elaboration_points: string[];
  citation_note: string;
}

export interface ScriptRecord {
  id: string;
  project_id: string;
  version: number;
  learning_objectives: string[];
  key_concepts: string[];
  summary: string;
  source_attribution: SourceAttribution;
  approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface SceneRecord {
  id: string;
  project_id: string;
  script_id: string | null;
  sort_order: number;
  title: string;
  scene_type: SceneType;
  dialogue: string;
  visual_instructions: string;
  code_snippet: string;
  code_language: string;
  equation_latex: string;
  bullet_points: string[];
  subtitle_text: string;
  duration_sec: number;
  audio_asset_id: string | null;
  audio_url?: string | null;
  visual_asset_id: string | null;
  visual_url?: string | null;
  status: 'draft' | 'audio_ready' | 'rendered';
  updated_at: string;
}

export interface GenerationJobStage {
  key: string;
  label_en: string;
  label_ar: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  detail?: string;
}

export interface GenerationJob {
  id: string;
  project_id: string;
  job_type: 'full_render' | 'audio_only' | 'preview';
  mode: OperatingMode;
  status: JobStatus;
  progress_pct: number;
  current_stage: string;
  stages: GenerationJobStage[];
  cost_estimate_usd: number;
  error_message: string | null;
  retry_count: number;
  cancel_requested: boolean;
  output_video_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportedVideo {
  id: string;
  project_id: string;
  job_id: string | null;
  title: string;
  file_path: string;
  video_url: string;
  srt_url: string;
  duration_sec: number;
  resolution: string;
  size_bytes: number;
  render_mode: string;
  has_real_lipsync: boolean;
  has_real_tts: boolean;
  has_generative_video: boolean;
  academy_published: boolean;
  publish_status: PublishStatus;
  academy_payload: Record<string, unknown> | null;
  file_exists?: boolean;
  created_at: string;
}

export interface ProjectSummary {
  id: string;
  user_id?: string | null;
  title: string;
  title_ar: string;
  subject: string;
  education_level: string;
  language: 'ar' | 'en';
  mode: OperatingMode;
  aspect_ratio: VideoAspectRatio;
  resolution: VideoResolution;
  lecturer_id: string;
  voice_id: string;
  environment_id: string;
  status: string;
  academy_course_id: string | null;
  academy_lesson_id: string | null;
  scene_count: number;
  total_duration_sec: number;
  export_count: number;
  latest_video_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseLesson {
  id: string;
  chapter_id: string;
  sort_order: number;
  project_id: string | null;
  title: string;
  title_ar: string;
  learning_objectives: string[];
  exercises: Array<{ prompt: string; solution: string; example_code: string }>;
  assessment: Array<{
    question: string;
    options: string[];
    correct_option_index: number;
    explanation: string;
  }>;
  source_materials: Array<{ id: string; filename: string; source_checksum: string }>;
  estimated_duration_sec: number;
  created_at: string;
  updated_at: string;
}

export interface CourseChapter {
  id: string;
  course_id: string;
  sort_order: number;
  title: string;
  title_ar: string;
  learning_objectives: string[];
  lessons: CourseLesson[];
  created_at: string;
  updated_at: string;
}

export interface CourseRecord {
  id: string;
  owner_user_id: string;
  title: string;
  title_ar: string;
  subject: string;
  description: string;
  education_level: string;
  language: StudioLocale;
  status: 'draft' | 'active' | 'archived';
  chapters: CourseChapter[];
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  materials: EducationalMaterial[];
  media_assets: MediaAssetRecord[];
  script: ScriptRecord | null;
  scenes: SceneRecord[];
  jobs: GenerationJob[];
  exports: ExportedVideo[];
}

export interface ProviderCapability {
  id: string;
  category:
    | 'renderer'
    | 'tts'
    | 'image_gen'
    | 'video_gen'
    | 'lip_sync'
    | 'script_llm'
    | 'code_validator';
  provider_key: string;
  display_name: string;
  display_name_ar: string;
  execution_mode: OperatingMode;
  available: boolean;
  is_free_tier: boolean;
  requires_gpu_or_paid_api: boolean;
  status_label_en: string;
  status_label_ar: string;
  limitation_note_en: string;
  limitation_note_ar: string;
}

export interface CostEstimate {
  mode: OperatingMode;
  estimated_usd: number;
  currency: 'USD';
  breakdown: Array<{
    stage_en: string;
    stage_ar: string;
    provider: string;
    cost_usd: number;
    tier: 'free_local' | 'free_quota' | 'paid_external';
  }>;
  warnings_en: string[];
  warnings_ar: string[];
}

export interface CodeValidationResult {
  valid: boolean;
  unavailable?: boolean;
  language: string;
  validator: string;
  diagnostics: string[];
}

export interface AuditEvent {
  id: string;
  user_id: string | null;
  project_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  created_at: string;
}
