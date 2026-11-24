import React, { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FileUp, Film, Play, Sparkles } from 'lucide-react';
import type {
  ClassroomEnvironment,
  Lecturer,
  ProjectSummary,
  StudioLocale,
} from '../types/studio.ts';
import { formatRelativeDate, formatStatusLabel, t } from '../i18n/strings.ts';

interface Props {
  locale: StudioLocale;
  projects: ProjectSummary[];
  lecturers: Lecturer[];
  environments: ClassroomEnvironment[];
  loading: boolean;
  onStartCreate: (initialTopic: string, initialFile?: File | null) => void;
  onOpenProject: (projectId: string) => void;
  onGoMyVideos: () => void;
}

const STARTER_TOPICS = {
  ar: [
    'مقدمة في المتغيرات بلغة C++',
    'قوانين نيوتن للحركة في الفيزياء',
    'شرح الدوال والعودية في بايثون',
  ],
  en: [
    'Introduction to Variables in C++',
    'Newton Laws of Motion Explained',
    'Functions and Recursion in Python',
  ],
};

export function HomePage({
  locale,
  projects,
  lecturers,
  environments,
  loading,
  onStartCreate,
  onOpenProject,
  onGoMyVideos,
}: Props) {
  const s = t(locale);
  const isAr = locale === 'ar';
  const [topic, setTopic] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const latestProject = projects[0] ?? null;
  const recentProjects = projects.slice(0, 3);
  const ArrowIcon = isAr ? ArrowLeft : ArrowRight;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onStartCreate(topic.trim(), attachedFile);
  }

  function getThumbnail(project: ProjectSummary): string | undefined {
    const env = environments.find((e) => e.id === project.environment_id);
    if (env?.image_url) return env.image_url;
    const lec = lecturers.find((l) => l.id === project.lecturer_id);
    return lec?.image_url;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-12">
      {/* Focused Hero Creation Surface */}
      <section className="rounded-3xl border border-[#654354]/80 bg-[#27131F] p-6 sm:p-10 space-y-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-2xl sm:text-4xl font-extrabold text-[#F9F1F4] leading-tight tracking-tight">
            {s.homeHeadline}
          </h1>
          <p className="text-sm sm:text-base text-[#C8B7C0] leading-relaxed">
            {s.homeSubheadline}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-2xl border border-[#654354] bg-[#180E15] p-3 sm:p-4 focus-within:border-[#C49A6C] transition-colors">
            <textarea
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={s.homeInputPlaceholder}
              className="w-full resize-none bg-transparent text-sm sm:text-base text-[#F9F1F4] placeholder-[#C8B7C0]/50 focus:outline-none leading-relaxed"
            />
            <div className="mt-3 pt-3 border-t border-[#654354]/40 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setAttachedFile(f);
                    if (f && !topic.trim()) {
                      setTopic(f.name.replace(/\.[^.]+$/, ''));
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#654354] bg-[#27131F] hover:bg-[#341A29] text-xs font-semibold text-[#C8B7C0] hover:text-[#F9F1F4] transition-colors whitespace-nowrap"
                >
                  <FileUp className="w-4 h-4 text-[#C49A6C]" />
                  {attachedFile ? attachedFile.name : s.homeAttachDoc}
                </button>
              </div>

              <button
                type="submit"
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#78263F] hover:bg-[#9E4761] text-[#F9F1F4] text-sm font-bold transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-4 h-4 text-[#C49A6C]" />
                {s.homeCreateCta}
              </button>
            </div>
          </div>
        </form>

        {/* Quick Topic Prompts */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#C8B7C0]">
          <span className="font-semibold text-[#C49A6C]">{s.homeQuickExamples}</span>
          {STARTER_TOPICS[locale].map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setTopic(sample)}
              className="hover:text-[#F9F1F4] underline decoration-[#654354] underline-offset-4 transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>
      </section>

      {/* Continue Editing */}
      {!loading && latestProject && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-[#F9F1F4]">{s.homeContinueEditing}</h2>
          <div className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-28 h-16 rounded-xl overflow-hidden border border-[#654354]/70 bg-[#180E15] shrink-0 relative">
                {getThumbnail(latestProject) ? (
                  <img
                    src={getThumbnail(latestProject)}
                    alt=""
                    className="w-full h-full object-cover opacity-75"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-5 h-5 text-[#C49A6C]" />
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <h3 className="text-base font-bold text-[#F9F1F4] truncate">
                  {isAr ? latestProject.title_ar : latestProject.title}
                </h3>
                <p className="text-xs text-[#C8B7C0] tabular-nums">
                  {latestProject.subject} · {latestProject.scene_count} {s.scenesUnit} ·{' '}
                  {Math.round(latestProject.total_duration_sec)}
                  {s.secondsUnit} · {formatStatusLabel(latestProject.status, locale)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenProject(latestProject.id)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#581629] hover:bg-[#78263F] border border-[#654354] text-sm font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-4 h-4 text-[#C49A6C]" />
              {s.homeContinueEditing}
            </button>
          </div>
        </section>
      )}

      {/* Recent Projects */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-[#F9F1F4]">{s.homeRecentProjects}</h2>
          {projects.length > 0 && (
            <button
              type="button"
              onClick={onGoMyVideos}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#C49A6C] hover:text-[#F9F1F4] transition-colors whitespace-nowrap"
            >
              {s.homeViewAll}
              <ArrowIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-52 rounded-2xl border border-[#654354]/50 bg-[#27131F] animate-pulse"
              />
            ))}
          </div>
        ) : recentProjects.length === 0 ? (
          <div className="rounded-2xl border border-[#654354]/70 bg-[#27131F] p-8 text-center space-y-2">
            <h3 className="text-base font-bold text-[#F9F1F4]">{s.homeEmptyTitle}</h3>
            <p className="text-sm text-[#C8B7C0] max-w-md mx-auto">{s.homeEmptyDesc}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {recentProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onOpenProject(project.id)}
                className="group text-start rounded-2xl border border-[#654354]/70 hover:border-[#C49A6C]/70 bg-[#27131F] overflow-hidden transition-colors flex flex-col"
              >
                <div className="aspect-video w-full bg-[#180E15] relative overflow-hidden">
                  {getThumbnail(project) && (
                    <img
                      src={getThumbnail(project)}
                      alt=""
                      className="w-full h-full object-cover opacity-75 group-hover:scale-[1.03] transition-transform duration-300"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#180E15]/85 via-transparent to-transparent" />
                  <span
                    className={`absolute bottom-2.5 ${isAr ? 'left-3' : 'right-3'} text-[11px] font-mono text-[#F9F1F4] tabular-nums`}
                  >
                    {Math.round(project.total_duration_sec)}
                    {s.secondsUnit}
                  </span>
                </div>
                <div className="p-4 space-y-1.5 flex-1 flex flex-col justify-between">
                  <h3 className="text-sm font-bold text-[#F9F1F4] line-clamp-1 group-hover:text-[#C49A6C] transition-colors">
                    {isAr ? project.title_ar : project.title}
                  </h3>
                  <p className="text-xs text-[#C8B7C0] tabular-nums">
                    {formatStatusLabel(project.status, locale)} ·{' '}
                    {formatRelativeDate(project.updated_at, locale)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
