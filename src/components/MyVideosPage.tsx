import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  FileText,
  Film,
  MoreVertical,
  Play,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { CoursesPanel } from './CoursesPanel.tsx';
import type {
  ClassroomEnvironment,
  ExportedVideo,
  Lecturer,
  ProjectSummary,
  StudioLocale,
} from '../types/studio.ts';
import { formatRelativeDate, formatStatusLabel, t } from '../i18n/strings.ts';
import { studioApi, withMediaToken } from '../lib/api.ts';

interface Props {
  locale: StudioLocale;
  projects: ProjectSummary[];
  exportsList: Array<ExportedVideo & { subject?: string; download_url?: string }>;
  lecturers: Lecturer[];
  environments: ClassroomEnvironment[];
  loading: boolean;
  onCreateNew: () => void;
  onOpenProject: (projectId: string) => void;
  onRefresh: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MyVideosPage({
  locale,
  projects,
  exportsList,
  lecturers,
  environments,
  loading,
  onCreateNew,
  onOpenProject,
  onRefresh,
}: Props) {
  const s = t(locale);
  const isAr = locale === 'ar';

  const [tab, setTab] = useState<'projects' | 'exports' | 'courses'>('projects');
  const [query, setQuery] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingProject, setRenamingProject] = useState<ProjectSummary | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<{ title: string; url: string; srtUrl?: string } | null>(
    null,
  );
  const [publishOpenId, setPublishOpenId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState('NABA-CS101');
  const [lessonId, setLessonId] = useState('LESSON-01');
  const [publishMessage, setPublishMessage] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.title_ar.toLowerCase().includes(q) ||
        p.subject.toLowerCase().includes(q),
    );
  }, [projects, query]);

  const filteredExports = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = exportsList.filter((e) => e.file_exists !== false);
    if (!q) return list;
    return list.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.subject ?? '').toLowerCase().includes(q),
    );
  }, [exportsList, query]);

  function getThumbnail(project: ProjectSummary): string | undefined {
    const env = environments.find((e) => e.id === project.environment_id);
    if (env?.image_url) return env.image_url;
    return lecturers.find((l) => l.id === project.lecturer_id)?.image_url;
  }

  function findLatestExportForProject(projectId: string) {
    return exportsList.find((e) => e.project_id === projectId && e.file_exists !== false) ?? null;
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!renamingProject || renameText.trim().length < 2) return;
    setBusyId(renamingProject.id);
    try {
      await studioApi.updateProject(renamingProject.id, {
        title: renameText.trim(),
        title_ar: renameText.trim(),
      });
      setRenamingProject(null);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteProject(projectId: string) {
    setBusyId(projectId);
    try {
      await studioApi.deleteProject(projectId);
      setDeletingProjectId(null);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteExport(exportId: string) {
    setBusyId(exportId);
    try {
      await studioApi.deleteExport(exportId);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handlePublish(exportId: string) {
    setBusyId(exportId);
    try {
      const res = await studioApi.publishToAcademy(exportId, {
        course_id: courseId.trim() || 'NABA-CS101',
        lesson_id: lessonId.trim() || 'LESSON-01',
        student_access: 'enrolled_students',
      });
      setPublishMessage((prev) => ({
        ...prev,
        [exportId]: {
          ok: res.remote_confirmed,
          text:
            res.message ||
            (res.remote_confirmed
              ? isAr
                ? 'تم تأكيد النشر إلى أكاديمية نبأ.'
                : 'Confirmed published to Naba Academy.'
              : isAr
                ? 'تم تجهيز حزمة النشر محليًا (نقطة الربط البعيدة غير مضبوطة بعد).'
                : 'Export package prepared locally (remote webhook not configured).'),
        },
      }));
      await onRefresh();
    } catch (err) {
      setPublishMessage((prev) => ({
        ...prev,
        [exportId]: {
          ok: false,
          text: err instanceof Error ? err.message : isAr ? 'تعذر النشر' : 'Publish failed',
        },
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#F9F1F4]">{s.myVideosTitle}</h1>
          <p className="text-sm text-[#C8B7C0] mt-1">{s.myVideosSubtitle}</p>
        </div>

        <button
          type="button"
          onClick={onCreateNew}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#78263F] hover:bg-[#9E4761] text-sm font-bold text-[#F9F1F4] transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-[#C49A6C]" />
          {s.navCreate}
        </button>
      </div>

      {/* Controls Bar: Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl border border-[#654354]/70 bg-[#27131F] self-start">
          <button
            type="button"
            onClick={() => setTab('projects')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap tabular-nums ${
              tab === 'projects'
                ? 'bg-[#78263F] text-[#F9F1F4]'
                : 'text-[#C8B7C0] hover:text-[#F9F1F4]'
            }`}
          >
            {s.tabProjects} ({projects.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('exports')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap tabular-nums ${
              tab === 'exports'
                ? 'bg-[#78263F] text-[#F9F1F4]'
                : 'text-[#C8B7C0] hover:text-[#F9F1F4]'
            }`}
          >
            {s.tabExports} ({filteredExports.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('courses')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
              tab === 'courses'
                ? 'bg-[#78263F] text-[#F9F1F4]'
                : 'text-[#C8B7C0] hover:text-[#F9F1F4]'
            }`}
          >
            {s.tabCourses}
          </button>
        </div>

        {tab !== 'courses' && <div className="relative w-full sm:w-72">
          <Search
            className={`w-4 h-4 text-[#C8B7C0]/70 absolute top-3 ${isAr ? 'right-3.5' : 'left-3.5'}`}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={s.searchPlaceholder}
            className={`w-full rounded-xl border border-[#654354] bg-[#27131F] py-2.5 text-sm text-[#F9F1F4] placeholder-[#C8B7C0]/50 focus:border-[#C49A6C] focus:outline-none ${
              isAr ? 'pr-10 pl-4' : 'pl-10 pr-4'
            }`}
          />
        </div>}
      </div>

      {/* Projects Grid */}
      {tab === 'projects' && (
        <>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-64 rounded-2xl border border-[#654354]/50 bg-[#27131F] animate-pulse"
                />
              ))}
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="rounded-2xl border border-[#654354]/70 bg-[#27131F] p-10 text-center space-y-4">
              <Film className="w-8 h-8 text-[#C49A6C] mx-auto" />
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[#F9F1F4]">{s.noProjectsYet}</h2>
                <p className="text-sm text-[#C8B7C0]">{s.homeEmptyDesc}</p>
              </div>
              <button
                type="button"
                onClick={onCreateNew}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#78263F] hover:bg-[#9E4761] text-sm font-bold text-[#F9F1F4] transition-colors"
              >
                <Plus className="w-4 h-4 text-[#C49A6C]" />
                {s.navCreate}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredProjects.map((project) => {
                const latestExp = findLatestExportForProject(project.id);
                const thumb = getThumbnail(project);
                const isMenuOpen = menuOpenId === project.id;
                const isConfirmingDelete = deletingProjectId === project.id;

                return (
                  <article
                    key={project.id}
                    className="rounded-2xl border border-[#654354]/80 bg-[#27131F] overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      <div className="aspect-video bg-[#180E15] relative overflow-hidden">
                        {thumb && (
                          <img
                            src={thumb}
                            alt=""
                            className="w-full h-full object-cover opacity-75"
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-[#180E15]/85 via-transparent to-transparent" />
                        <div
                          className={`absolute bottom-2.5 ${isAr ? 'left-3' : 'right-3'} text-[11px] font-mono text-[#F9F1F4] tabular-nums`}
                        >
                          {project.aspect_ratio || '16:9'} · {Math.round(project.total_duration_sec)}
                          {s.secondsUnit}
                        </div>
                      </div>

                      <div className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2 relative">
                          <h3 className="text-base font-bold text-[#F9F1F4] line-clamp-1">
                            {isAr ? project.title_ar : project.title}
                          </h3>

                          <button
                            type="button"
                            aria-label="More options"
                            onClick={() => setMenuOpenId(isMenuOpen ? null : project.id)}
                            className="p-1 rounded-lg text-[#C8B7C0] hover:text-[#F9F1F4] hover:bg-[#341A29] transition-colors shrink-0"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {isMenuOpen && (
                            <div
                              className={`absolute top-8 ${isAr ? 'left-0' : 'right-0'} z-20 w-40 rounded-xl border border-[#654354] bg-[#341A29] py-1 shadow-xl`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setRenamingProject(project);
                                  setRenameText(isAr ? project.title_ar : project.title);
                                }}
                                className="w-full px-3 py-2 text-start text-xs font-medium text-[#F9F1F4] hover:bg-[#581629] flex items-center gap-2"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-[#C49A6C]" />
                                {s.actionRename}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setDeletingProjectId(project.id);
                                }}
                                className="w-full px-3 py-2 text-start text-xs font-medium text-[#F07883] hover:bg-[#581629] flex items-center gap-2"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {s.actionDelete}
                              </button>
                            </div>
                          )}
                        </div>

                        <p className="text-xs text-[#C8B7C0] tabular-nums">
                          {project.subject} · {formatStatusLabel(project.status, locale)} ·{' '}
                          {formatRelativeDate(project.updated_at, locale)}
                        </p>
                      </div>
                    </div>

                    {isConfirmingDelete ? (
                      <div className="px-4 pb-4 pt-2 border-t border-[#654354]/40 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#F07883]">
                          {s.confirmDeleteProject}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDeletingProjectId(null)}
                            className="px-3 py-1.5 rounded-lg border border-[#654354] text-xs text-[#C8B7C0] hover:text-[#F9F1F4]"
                          >
                            {s.confirmCancel}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === project.id}
                            onClick={() => handleDeleteProject(project.id)}
                            className="px-3 py-1.5 rounded-lg bg-[#F07883] text-[#180E15] text-xs font-bold"
                          >
                            {s.confirmDeleteYes}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 pb-4 pt-3 border-t border-[#654354]/40 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenProject(project.id)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#581629] hover:bg-[#78263F] text-xs font-bold text-[#F9F1F4] transition-colors whitespace-nowrap"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-[#C49A6C]" />
                          {s.actionEdit}
                        </button>

                        {latestExp && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewVideo({
                                  title: isAr ? project.title_ar : project.title,
                                  url: withMediaToken(latestExp.video_url),
                                  srtUrl: withMediaToken(latestExp.srt_url),
                                })
                              }
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#341A29] text-xs font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap"
                            >
                              <Play className="w-3.5 h-3.5 text-[#C49A6C]" />
                              {s.actionPreview}
                            </button>
                            <a
                              href={withMediaToken(latestExp.download_url || `/api/exports/${latestExp.id}/download`)}
                              download
                              title={s.actionDownload}
                              className="inline-flex items-center justify-center p-2 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#341A29] text-[#C49A6C] transition-colors shrink-0"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Exports Tab (Export Center) */}
      {tab === 'exports' && (
        <div className="space-y-4">
          {filteredExports.length === 0 ? (
            <div className="rounded-2xl border border-[#654354]/70 bg-[#27131F] p-10 text-center space-y-2">
              <Film className="w-8 h-8 text-[#C49A6C] mx-auto" />
              <h2 className="text-base font-bold text-[#F9F1F4]">{s.noExportsYet}</h2>
              <p className="text-sm text-[#C8B7C0] max-w-md mx-auto">{s.noExportsHint}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredExports.map((exp) => {
                const isPublishOpen = publishOpenId === exp.id;
                const pubMsg = publishMessage[exp.id];
                return (
                  <div
                    key={exp.id}
                    className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-5 space-y-4"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <h3 className="text-base font-bold text-[#F9F1F4] truncate">{exp.title}</h3>
                        <p className="text-xs text-[#C8B7C0] tabular-nums">
                          {exp.resolution} · {exp.duration_sec.toFixed(1)}
                          {s.secondsUnit} · {formatBytes(exp.size_bytes)} ·{' '}
                          {formatRelativeDate(exp.created_at, locale)}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewVideo({
                              title: exp.title,
                              url: withMediaToken(exp.video_url),
                              srtUrl: withMediaToken(exp.srt_url),
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#341A29] text-xs font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap"
                        >
                          <Play className="w-3.5 h-3.5 text-[#C49A6C]" />
                          {s.actionPreview}
                        </button>

                        <a
                          href={withMediaToken(exp.download_url || `/api/exports/${exp.id}/download`)}
                          download
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#78263F] hover:bg-[#9E4761] text-xs font-bold text-[#F9F1F4] transition-colors whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5 text-[#C49A6C]" />
                          {s.genDownloadMp4}
                        </a>

                        <a
                          href={withMediaToken(exp.srt_url)}
                          download
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#341A29] text-xs font-semibold text-[#C8B7C0] hover:text-[#F9F1F4] transition-colors whitespace-nowrap"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#C49A6C]" />
                          SRT
                        </a>

                        <button
                          type="button"
                          disabled={busyId === exp.id}
                          onClick={() => handleDeleteExport(exp.id)}
                          aria-label={s.actionDelete}
                          className="p-2 rounded-xl border border-[#654354]/70 text-[#C8B7C0] hover:text-[#F07883] hover:border-[#F07883]/50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Optional Expandable Naba Academy Publishing */}
                    <div className="pt-3 border-t border-[#654354]/40">
                      <button
                        type="button"
                        onClick={() => setPublishOpenId(isPublishOpen ? null : exp.id)}
                        className="inline-flex items-center gap-2 text-xs font-semibold text-[#C8B7C0] hover:text-[#F9F1F4] transition-colors"
                      >
                        <Send className="w-3.5 h-3.5 text-[#C49A6C]" />
                        {s.publishSectionTitle}
                        {isPublishOpen ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {isPublishOpen && (
                        <div className="mt-3 rounded-xl border border-[#654354]/60 bg-[#180E15] p-4 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                            <div>
                              <label className="block text-[11px] text-[#C8B7C0] mb-1">
                                {s.courseIdLabel}
                              </label>
                              <input
                                type="text"
                                dir="ltr"
                                value={courseId}
                                onChange={(e) => setCourseId(e.target.value)}
                                className="w-full rounded-lg border border-[#654354] bg-[#27131F] px-3 py-2 text-xs text-[#F9F1F4]"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-[#C8B7C0] mb-1">
                                {s.lessonIdLabel}
                              </label>
                              <input
                                type="text"
                                dir="ltr"
                                value={lessonId}
                                onChange={(e) => setLessonId(e.target.value)}
                                className="w-full rounded-lg border border-[#654354] bg-[#27131F] px-3 py-2 text-xs text-[#F9F1F4]"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={busyId === exp.id}
                              onClick={() => handlePublish(exp.id)}
                              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#581629] hover:bg-[#78263F] text-xs font-bold text-[#F9F1F4] transition-colors whitespace-nowrap"
                            >
                              <Check className="w-3.5 h-3.5 text-[#C49A6C]" />
                              {s.publishBtn}
                            </button>
                          </div>

                          {pubMsg && (
                            <p
                              className={`text-xs ${
                                pubMsg.ok ? 'text-[#49B894]' : 'text-[#E7B66A]'
                              }`}
                            >
                              {pubMsg.text}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'courses' && (
        <CoursesPanel locale={locale} projects={projects} onOpenProject={onOpenProject} />
      )}

      {/* Video Preview Modal */}
      {previewVideo && (
        <div
          className="fixed inset-0 z-50 bg-[#180E15]/85 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl rounded-2xl border border-[#654354] bg-[#27131F] p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-[#F9F1F4] truncate">{previewVideo.title}</h3>
              <button
                type="button"
                onClick={() => setPreviewVideo(null)}
                className="p-1.5 rounded-lg text-[#C8B7C0] hover:text-[#F9F1F4] hover:bg-[#341A29]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <video
              src={previewVideo.url}
              controls
              autoPlay
              className="w-full max-h-[68vh] rounded-xl bg-black"
            />
          </div>
        </div>
      )}

      {/* Rename Project Modal */}
      {renamingProject && (
        <div
          className="fixed inset-0 z-50 bg-[#180E15]/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleRenameSubmit}
            className="w-full max-w-md rounded-2xl border border-[#654354] bg-[#27131F] p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-[#F9F1F4]">{s.actionRename}</h3>
            <input
              type="text"
              required
              minLength={2}
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-4 py-2.5 text-sm text-[#F9F1F4] focus:border-[#C49A6C] focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenamingProject(null)}
                className="px-4 py-2 rounded-xl border border-[#654354] text-xs font-semibold text-[#C8B7C0]"
              >
                {s.confirmCancel}
              </button>
              <button
                type="submit"
                disabled={busyId === renamingProject.id}
                className="px-5 py-2 rounded-xl bg-[#78263F] hover:bg-[#9E4761] text-xs font-bold text-[#F9F1F4]"
              >
                {s.editorSaveScene}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
