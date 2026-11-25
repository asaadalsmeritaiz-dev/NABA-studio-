import type {
  AuthStatus,
  ClassroomEnvironment,
  CodeValidationResult,
  CostEstimate,
  CourseRecord,
  ExportedVideo,
  GenerationJob,
  Lecturer,
  OperatingMode,
  ProjectDetail,
  ProjectSummary,
  ProviderCapability,
  PublishStatus,
  SceneRecord,
  StudioUser,
  VideoAspectRatio,
  VideoResolution,
  VoiceProfile,
} from '../types/studio.ts';

// Strictly in-memory session & media tokens (never persisted in localStorage/sessionStorage)
let authToken: string | null = null;
let mediaToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setSessionTokens(token: string, nextMediaToken: string): void {
  authToken = token;
  mediaToken = nextMediaToken;
}

export function clearSessionTokens(): void {
  authToken = null;
  mediaToken = null;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function withMediaToken(url: string | null | undefined): string {
  if (!url) return '';
  if (!mediaToken) return url;
  if (!url.startsWith('/api/') && !url.startsWith('/storage/')) {
    return url;
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}media_token=${encodeURIComponent(mediaToken)}`;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    clearSessionTokens();
    unauthorizedHandler?.();
  }

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface AuthSessionResponse {
  token: string;
  media_token: string;
  expires_at: string;
  user: StudioUser;
}

export const studioApi = {
  // Authentication
  getAuthStatus: () => apiFetch<AuthStatus>('/api/auth/status'),

  claimWorkspace: (payload: { claim_code: string; password: string; name?: string }) =>
    apiFetch<AuthSessionResponse>('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  register: (payload: { email: string; name: string; password: string; locale: 'ar' | 'en' }) =>
    apiFetch<AuthSessionResponse>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    apiFetch<AuthSessionResponse>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  logout: () =>
    apiFetch<{ logged_out: boolean }>('/api/auth/logout', { method: 'POST' }).finally(() => {
      clearSessionTokens();
    }),

  // Capabilities & Catalog
  getCapabilities: () =>
    apiFetch<{
      capabilities: ProviderCapability[];
      lecturers: Lecturer[];
      voices: VoiceProfile[];
      environments: ClassroomEnvironment[];
    }>('/api/capabilities'),

  // Projects
  listProjects: () => apiFetch<{ projects: ProjectSummary[] }>('/api/projects'),

  getProject: (id: string) => apiFetch<{ project: ProjectDetail }>(`/api/projects/${id}`),

  // Courses, chapters & linked video lessons
  listCourses: () => apiFetch<{ courses: CourseRecord[] }>('/api/courses'),

  createCourse: (payload: {
    title: string;
    title_ar?: string;
    subject: string;
    description?: string;
    education_level?: string;
    language: 'ar' | 'en';
  }) =>
    apiFetch<{ course: CourseRecord }>('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateCourse: (id: string, payload: Record<string, unknown>) =>
    apiFetch<{ course: CourseRecord }>(`/api/courses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  deleteCourse: (id: string) =>
    apiFetch<{ deleted: boolean; id: string }>(`/api/courses/${id}`, { method: 'DELETE' }),

  createCourseChapter: (
    courseId: string,
    payload: { title: string; title_ar?: string; learning_objectives: string[] },
  ) =>
    apiFetch<{ course: CourseRecord; chapter_id: string }>(`/api/courses/${courseId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateCourseChapter: (
    courseId: string,
    chapterId: string,
    payload: { title?: string; title_ar?: string; learning_objectives?: string[] },
  ) =>
    apiFetch<{ course: CourseRecord }>(`/api/courses/${courseId}/chapters/${chapterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  deleteCourseChapter: (courseId: string, chapterId: string) =>
    apiFetch<{ deleted: boolean; course: CourseRecord }>(
      `/api/courses/${courseId}/chapters/${chapterId}`,
      { method: 'DELETE' },
    ),

  createCourseLesson: (
    courseId: string,
    chapterId: string,
    payload: {
      title: string;
      title_ar?: string;
      learning_objectives: string[];
      estimated_duration_sec?: number;
      project_id?: string | null;
    },
  ) =>
    apiFetch<{ course: CourseRecord; lesson_id: string }>(
      `/api/courses/${courseId}/chapters/${chapterId}/lessons`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    ),

  updateCourseLesson: (
    courseId: string,
    lessonId: string,
    payload: {
      title?: string;
      title_ar?: string;
      learning_objectives?: string[];
      estimated_duration_sec?: number;
      project_id?: string | null;
    },
  ) =>
    apiFetch<{ course: CourseRecord }>(`/api/courses/${courseId}/lessons/${lessonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  deleteCourseLesson: (courseId: string, lessonId: string) =>
    apiFetch<{ deleted: boolean; course: CourseRecord }>(`/api/courses/${courseId}/lessons/${lessonId}`, {
      method: 'DELETE',
    }),

  createProject: (payload: {
    title: string;
    title_ar?: string;
    subject: string;
    education_level: string;
    language: 'ar' | 'en';
    mode: OperatingMode;
    aspect_ratio?: VideoAspectRatio;
    resolution?: VideoResolution;
    lecturer_id: string;
    voice_id: string;
    environment_id: string;
  }) =>
    apiFetch<{ project: ProjectDetail }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateProject: (id: string, payload: Record<string, unknown>) =>
    apiFetch<{ project: ProjectDetail }>(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  deleteProject: (id: string) =>
    apiFetch<{ deleted: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  // Materials & Media Assets
  uploadMaterial: async (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiFetch<{ material: ProjectDetail['materials'][number] }>(`/api/projects/${projectId}/materials`, {
      method: 'POST',
      body: fd,
    });
  },

  deleteMaterial: (projectId: string, materialId: string) =>
    apiFetch<{ deleted: boolean; project: ProjectDetail }>(
      `/api/projects/${projectId}/materials/${materialId}`,
      { method: 'DELETE' },
    ),

  deleteMediaAsset: (projectId: string, assetId: string) =>
    apiFetch<{ deleted: boolean; project: ProjectDetail }>(
      `/api/projects/${projectId}/assets/${assetId}`,
      { method: 'DELETE' },
    ),

  // Scripts
  generateScript: (
    projectId: string,
    payload: { topic: string; target_duration_sec: number; material_id?: string },
  ) =>
    apiFetch<{ provider: string; project: ProjectDetail }>(`/api/projects/${projectId}/script/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  saveManualScript: (projectId: string, payload: { raw_script: string; target_duration_sec?: number }) =>
    apiFetch<{ project: ProjectDetail }>(`/api/projects/${projectId}/script/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  approveScript: (projectId: string, approvedBy: string) =>
    apiFetch<{ project: ProjectDetail }>(`/api/projects/${projectId}/script/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved_by: approvedBy }),
    }),

  // Scenes
  addScene: (projectId: string, scene: Partial<SceneRecord>) =>
    apiFetch<{ scene_id: string; project: ProjectDetail }>(`/api/projects/${projectId}/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scene),
    }),

  updateScene: (projectId: string, sceneId: string, scene: Partial<SceneRecord>) =>
    apiFetch<{ project: ProjectDetail }>(`/api/projects/${projectId}/scenes/${sceneId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scene),
    }),

  deleteScene: (projectId: string, sceneId: string) =>
    apiFetch<{ project: ProjectDetail }>(`/api/projects/${projectId}/scenes/${sceneId}`, {
      method: 'DELETE',
    }),

  reorderScenes: (projectId: string, sceneIds: string[]) =>
    apiFetch<{ project: ProjectDetail }>(`/api/projects/${projectId}/scenes/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_ids: sceneIds }),
    }),

  generateSceneAudio: (projectId: string, sceneId: string) =>
    apiFetch<{
      audio_url: string;
      provider: string;
      is_real_speech: boolean;
      duration_sec: number;
      note: string;
      project: ProjectDetail;
    }>(`/api/projects/${projectId}/scenes/${sceneId}/audio`, { method: 'POST' }),

  generateSceneLecturerVideo: (projectId: string, sceneId: string, allowPaidVideoGen = false) =>
    apiFetch<{
      status: string;
      provider: string;
      visual_url: string;
      duration_sec: number;
      reason: string;
      project: ProjectDetail;
    }>(`/api/projects/${projectId}/scenes/${sceneId}/lecturer-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allow_paid_video_gen: allowPaidVideoGen }),
    }),

  // Voices & Lecturers
  previewVoice: (payload: { voice_id: string; text: string; speaking_rate: number }) =>
    apiFetch<{
      audio_base64: string;
      mime_type: string;
      provider: string;
      is_real_speech: boolean;
      duration_sec: number;
      note: string;
    }>('/api/voices/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  uploadCustomLecturer: (formData: FormData) =>
    apiFetch<{ lecturer: Lecturer }>('/api/lecturers', {
      method: 'POST',
      body: formData,
    }),

  reviewLecturerConsent: (lecturerId: string, authorizationReference: string) =>
    apiFetch<{ lecturer: Lecturer; review_status: 'approved' }>(
      `/api/lecturers/${encodeURIComponent(lecturerId)}/consent-review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorization_reference: authorizationReference }),
      },
    ),

  // Code Validation
  validateCode: (code: string, language: string) =>
    apiFetch<{ result: CodeValidationResult }>('/api/tools/validate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language }),
    }),

  // Cost & Render Jobs
  getCostEstimate: (projectId: string, mode: OperatingMode, allowPaidVideoGen = false) =>
    apiFetch<{ estimate: CostEstimate }>(
      `/api/projects/${projectId}/cost-estimate?mode=${mode}&allow_paid_video_gen=${String(allowPaidVideoGen)}`,
    ),

  startRender: (
    projectId: string,
    payload: {
      mode: OperatingMode;
      aspect_ratio?: VideoAspectRatio;
      resolution?: VideoResolution;
      allow_cloud_tts?: boolean;
      allow_paid_video_gen?: boolean;
      retry_from_job_id?: string;
    },
  ) =>
    apiFetch<{ job: GenerationJob }>(`/api/projects/${projectId}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  getJob: (jobId: string) => apiFetch<{ job: GenerationJob }>(`/api/jobs/${jobId}`),

  cancelJob: (jobId: string) =>
    apiFetch<{ job: GenerationJob }>(`/api/jobs/${jobId}/cancel`, { method: 'POST' }),

  // Exports & Academy Publishing
  listExports: () =>
    apiFetch<{ exports: Array<ExportedVideo & { subject?: string; download_url?: string }> }>('/api/exports'),

  deleteExport: (exportId: string) =>
    apiFetch<{ deleted: boolean; id: string }>(`/api/exports/${exportId}`, { method: 'DELETE' }),

  publishToAcademy: (
    exportId: string,
    payload: { course_id: string; lesson_id: string; student_access: string },
  ) =>
    apiFetch<{
      published: boolean;
      remote_confirmed: boolean;
      publish_status: PublishStatus;
      message?: string;
      academy_payload: Record<string, unknown>;
    }>(`/api/academy/publish/${exportId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
};
