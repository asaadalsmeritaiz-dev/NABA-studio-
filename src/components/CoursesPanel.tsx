import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BookOpen, ExternalLink, Plus, Save, Trash2 } from 'lucide-react';
import type { CourseRecord, ProjectSummary, StudioLocale } from '../types/studio.ts';
import { t } from '../i18n/strings.ts';
import { studioApi } from '../lib/api.ts';

interface Props {
  locale: StudioLocale;
  projects: ProjectSummary[];
  onOpenProject: (projectId: string) => void;
}

interface ChapterDraft {
  title: string;
  objectives: string;
}

interface LessonDraft {
  title: string;
  objectives: string;
  duration: string;
  projectId: string;
}

const emptyChapterDraft = (): ChapterDraft => ({ title: '', objectives: '' });
const emptyLessonDraft = (): LessonDraft => ({ title: '', objectives: '', duration: '300', projectId: '' });

function parseObjectives(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((objective) => objective.trim())
    .filter(Boolean);
}

export function CoursesPanel({ locale, projects, onOpenProject }: Props) {
  const s = t(locale);
  const isAr = locale === 'ar';
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [courseSubject, setCourseSubject] = useState('');
  const [courseDescription, setCourseDescription] = useState('');
  const [courseEdits, setCourseEdits] = useState<
    Record<string, { title: string; subject: string; status: CourseRecord['status'] }>
  >({});
  const [chapterDrafts, setChapterDrafts] = useState<Record<string, ChapterDraft>>({});
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, LessonDraft>>({});

  const loadCourses = useCallback(async () => {
    const response = await studioApi.listCourses();
    setCourses(response.courses);
    setCourseEdits(
      Object.fromEntries(
        response.courses.map((course) => [
          course.id,
          { title: course.title, subject: course.subject, status: course.status },
        ]),
      ),
    );
    setError('');
  }, []);

  useEffect(() => {
    let active = true;
    studioApi
      .listCourses()
      .then((response) => {
        if (!active) return;
        setCourses(response.courses);
        setCourseEdits(
          Object.fromEntries(
            response.courses.map((course) => [
              course.id,
              { title: course.title, subject: course.subject, status: course.status },
            ]),
          ),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : s.courseLoadFailed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [s.courseLoadFailed]);

  async function execute(key: string, operation: () => Promise<unknown>): Promise<boolean> {
    setBusy(key);
    setError('');
    try {
      await operation();
      await loadCourses();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : s.courseLoadFailed);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await execute('create-course', () =>
      studioApi.createCourse({
        title: courseTitle.trim(),
        title_ar: courseTitle.trim(),
        subject: courseSubject.trim(),
        description: courseDescription.trim(),
        language: locale,
      }),
    );
    if (created) {
      setCourseTitle('');
      setCourseSubject('');
      setCourseDescription('');
    }
  }

  async function createChapter(event: FormEvent<HTMLFormElement>, courseId: string) {
    event.preventDefault();
    const draft = chapterDrafts[courseId] ?? emptyChapterDraft();
    const created = await execute(`chapter:${courseId}`, () =>
      studioApi.createCourseChapter(courseId, {
        title: draft.title.trim(),
        title_ar: draft.title.trim(),
        learning_objectives: parseObjectives(draft.objectives),
      }),
    );
    if (created) setChapterDrafts((previous) => ({ ...previous, [courseId]: emptyChapterDraft() }));
  }

  async function createLesson(event: FormEvent<HTMLFormElement>, courseId: string, chapterId: string) {
    event.preventDefault();
    const draft = lessonDrafts[chapterId] ?? emptyLessonDraft();
    const created = await execute(`lesson:${chapterId}`, () =>
      studioApi.createCourseLesson(courseId, chapterId, {
        title: draft.title.trim(),
        title_ar: draft.title.trim(),
        learning_objectives: parseObjectives(draft.objectives),
        estimated_duration_sec: Number(draft.duration),
        project_id: draft.projectId || null,
      }),
    );
    if (created) setLessonDrafts((previous) => ({ ...previous, [chapterId]: emptyLessonDraft() }));
  }

  const panelInputClass =
    'w-full rounded-lg border border-[#654354] bg-[#180E15] px-3 py-2 text-sm text-[#F9F1F4] placeholder-[#C8B7C0]/60 focus:border-[#C49A6C] focus:outline-none';
  const secondaryButtonClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-[#654354] px-3 py-2 text-xs font-bold text-[#F9F1F4] hover:border-[#C49A6C] disabled:opacity-50';

  return (
    <section dir={isAr ? 'rtl' : 'ltr'} className="space-y-5">
      <header className="flex items-start gap-3">
        <BookOpen className="mt-1 h-5 w-5 shrink-0 text-[#C49A6C]" />
        <div>
          <h2 className="text-lg font-extrabold text-[#F9F1F4]">{s.coursesTitle}</h2>
          <p className="mt-1 text-sm text-[#C8B7C0]">{s.coursesSubtitle}</p>
        </div>
      </header>

      <form
        onSubmit={(event) => void createCourse(event)}
        className="grid gap-3 rounded-2xl border border-[#654354]/80 bg-[#27131F] p-4 sm:grid-cols-2"
      >
        <label className="space-y-1 text-xs font-semibold text-[#C8B7C0]">
          <span>{s.courseName}</span>
          <input
            required
            minLength={2}
            maxLength={160}
            value={courseTitle}
            onChange={(event) => setCourseTitle(event.target.value)}
            className={panelInputClass}
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-[#C8B7C0]">
          <span>{s.courseSubject}</span>
          <input
            required
            minLength={2}
            maxLength={100}
            value={courseSubject}
            onChange={(event) => setCourseSubject(event.target.value)}
            className={panelInputClass}
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-[#C8B7C0] sm:col-span-2">
          <span>{s.courseDescription}</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={courseDescription}
            onChange={(event) => setCourseDescription(event.target.value)}
            className={panelInputClass}
          />
        </label>
        <button
          type="submit"
          disabled={busy !== null}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#78263F] px-4 py-2.5 text-sm font-bold text-[#F9F1F4] hover:bg-[#9E4761] disabled:opacity-50 sm:col-span-2 sm:justify-self-start"
        >
          <Plus className="h-4 w-4 text-[#C49A6C]" />
          {s.courseCreate}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-[#C8B7C0]">{s.editorSaving}</p>
      ) : courses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#654354] px-5 py-10 text-center text-sm text-[#C8B7C0]">
          {s.courseEmpty}
        </div>
      ) : (
        <div className="space-y-4">
          {courses.map((course) => {
            const edit = courseEdits[course.id] ?? {
              title: course.title,
              subject: course.subject,
              status: course.status,
            };
            const chapterDraft = chapterDrafts[course.id] ?? emptyChapterDraft();
            return (
              <article key={course.id} className="space-y-4 rounded-2xl border border-[#654354]/80 bg-[#27131F] p-4">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                  <label className="sr-only" htmlFor={`course-title-${course.id}`}>{s.courseName}</label>
                  <input
                    id={`course-title-${course.id}`}
                    value={edit.title}
                    maxLength={160}
                    onChange={(event) =>
                      setCourseEdits((previous) => ({
                        ...previous,
                        [course.id]: { ...edit, title: event.target.value },
                      }))
                    }
                    className={panelInputClass}
                  />
                  <label className="sr-only" htmlFor={`course-subject-${course.id}`}>{s.courseSubject}</label>
                  <input
                    id={`course-subject-${course.id}`}
                    value={edit.subject}
                    maxLength={100}
                    onChange={(event) =>
                      setCourseEdits((previous) => ({
                        ...previous,
                        [course.id]: { ...edit, subject: event.target.value },
                      }))
                    }
                    className={panelInputClass}
                  />
                  <select
                    aria-label={isAr ? 'حالة المقرر' : 'Course status'}
                    value={edit.status}
                    onChange={(event) =>
                      setCourseEdits((previous) => ({
                        ...previous,
                        [course.id]: {
                          ...edit,
                          status: event.target.value as CourseRecord['status'],
                        },
                      }))
                    }
                    className={panelInputClass}
                  >
                    <option value="draft">{isAr ? 'مسودة' : 'Draft'}</option>
                    <option value="active">{isAr ? 'نشط' : 'Active'}</option>
                    <option value="archived">{isAr ? 'مؤرشف' : 'Archived'}</option>
                  </select>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy !== null || edit.title.trim().length < 2 || edit.subject.trim().length < 2}
                      onClick={() =>
                        void execute(`save-course:${course.id}`, () =>
                          studioApi.updateCourse(course.id, {
                            title: edit.title.trim(),
                            title_ar: edit.title.trim(),
                            subject: edit.subject.trim(),
                            status: edit.status,
                          }),
                        )
                      }
                      className={secondaryButtonClass}
                    >
                      <Save className="h-3.5 w-3.5" />
                      {s.courseSave}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        if (window.confirm(s.courseDeleteConfirm)) {
                          void execute(`delete-course:${course.id}`, () => studioApi.deleteCourse(course.id));
                        }
                      }}
                      className={`${secondaryButtonClass} text-red-200`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {s.courseDelete}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {course.chapters.map((chapter) => {
                    const lessonDraft = lessonDrafts[chapter.id] ?? emptyLessonDraft();
                    return (
                      <section key={chapter.id} className="space-y-3 rounded-xl border border-[#654354]/60 bg-[#180E15]/50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-bold text-[#F9F1F4]">
                            {chapter.sort_order}. {chapter.title}
                          </h3>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => {
                              if (window.confirm(s.chapterDeleteConfirm)) {
                                void execute(`delete-chapter:${chapter.id}`, () =>
                                  studioApi.deleteCourseChapter(course.id, chapter.id),
                                );
                              }
                            }}
                            className={`${secondaryButtonClass} text-red-200`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {s.chapterDelete}
                          </button>
                        </div>
                        {chapter.learning_objectives.length > 0 && (
                          <ul className="list-inside list-disc space-y-1 text-xs text-[#C8B7C0]">
                            {chapter.learning_objectives.map((objective) => <li key={objective}>{objective}</li>)}
                          </ul>
                        )}
                        {chapter.lessons.map((lesson) => (
                          <div key={lesson.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#654354]/40 px-3 py-2 text-sm">
                            <div>
                              <p className="font-semibold text-[#F9F1F4]">{lesson.sort_order}. {lesson.title}</p>
                              <p className="text-xs text-[#C8B7C0]">
                                {lesson.estimated_duration_sec}{s.secondsUnit}
                                {lesson.project_id ? ` · ${projects.find((project) => project.id === lesson.project_id)?.title ?? lesson.project_id}` : ''}
                              </p>
                              {lesson.learning_objectives.length > 0 && (
                                <p className="mt-1 text-xs text-[#C8B7C0]">{lesson.learning_objectives.join(' · ')}</p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              {lesson.project_id && (
                                <button
                                  type="button"
                                  onClick={() => onOpenProject(lesson.project_id!)}
                                  className={secondaryButtonClass}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  {s.actionEdit}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => {
                                  if (window.confirm(s.lessonDeleteConfirm)) {
                                    void execute(`delete-lesson:${lesson.id}`, () =>
                                      studioApi.deleteCourseLesson(course.id, lesson.id),
                                    );
                                  }
                                }}
                                className={`${secondaryButtonClass} text-red-200`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                {s.lessonDelete}
                              </button>
                            </div>
                          </div>
                        ))}
                        <form
                          onSubmit={(event) => void createLesson(event, course.id, chapter.id)}
                          className="grid gap-2 sm:grid-cols-2"
                        >
                          <label className="space-y-1 text-xs text-[#C8B7C0]">
                            <span>{s.lessonName}</span>
                            <input
                              required
                              minLength={2}
                              maxLength={160}
                              value={lessonDraft.title}
                              onChange={(event) =>
                                setLessonDrafts((previous) => ({
                                  ...previous,
                                  [chapter.id]: { ...lessonDraft, title: event.target.value },
                                }))
                              }
                              className={panelInputClass}
                            />
                          </label>
                          <label className="space-y-1 text-xs text-[#C8B7C0]">
                            <span>{s.lessonDuration}</span>
                            <input
                              type="number"
                              min={8}
                              max={1800}
                              step={1}
                              value={lessonDraft.duration}
                              onChange={(event) =>
                                setLessonDrafts((previous) => ({
                                  ...previous,
                                  [chapter.id]: { ...lessonDraft, duration: event.target.value },
                                }))
                              }
                              className={panelInputClass}
                            />
                          </label>
                          <label className="space-y-1 text-xs text-[#C8B7C0]">
                            <span>{s.lessonObjectives}</span>
                            <textarea
                              rows={2}
                              value={lessonDraft.objectives}
                              onChange={(event) =>
                                setLessonDrafts((previous) => ({
                                  ...previous,
                                  [chapter.id]: { ...lessonDraft, objectives: event.target.value },
                                }))
                              }
                              className={panelInputClass}
                            />
                          </label>
                          <label className="space-y-1 text-xs text-[#C8B7C0]">
                            <span>{s.lessonProject}</span>
                            <select
                              value={lessonDraft.projectId}
                              onChange={(event) =>
                                setLessonDrafts((previous) => ({
                                  ...previous,
                                  [chapter.id]: { ...lessonDraft, projectId: event.target.value },
                                }))
                              }
                              className={panelInputClass}
                            >
                              <option value="">{isAr ? 'بدون مشروع مرتبط' : 'No linked project'}</option>
                              {projects.map((project) => (
                                <option key={project.id} value={project.id}>{project.title}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="submit"
                            disabled={busy !== null}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#78263F] px-3 py-2 text-xs font-bold text-[#F9F1F4] hover:bg-[#9E4761] disabled:opacity-50 sm:col-span-2 sm:justify-self-start"
                          >
                            <Plus className="h-3.5 w-3.5 text-[#C49A6C]" />
                            {s.lessonCreate}
                          </button>
                        </form>
                      </section>
                    );
                  })}
                </div>

                <form
                  onSubmit={(event) => void createChapter(event, course.id)}
                  className="grid gap-2 border-t border-[#654354]/60 pt-3 sm:grid-cols-2"
                >
                  <label className="space-y-1 text-xs text-[#C8B7C0]">
                    <span>{s.chapterName}</span>
                    <input
                      required
                      minLength={2}
                      maxLength={160}
                      value={chapterDraft.title}
                      onChange={(event) =>
                        setChapterDrafts((previous) => ({
                          ...previous,
                          [course.id]: { ...chapterDraft, title: event.target.value },
                        }))
                      }
                      className={panelInputClass}
                    />
                  </label>
                  <label className="space-y-1 text-xs text-[#C8B7C0]">
                    <span>{s.chapterObjectives}</span>
                    <textarea
                      rows={2}
                      value={chapterDraft.objectives}
                      onChange={(event) =>
                        setChapterDrafts((previous) => ({
                          ...previous,
                          [course.id]: { ...chapterDraft, objectives: event.target.value },
                        }))
                      }
                      className={panelInputClass}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy !== null}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#78263F] px-3 py-2 text-xs font-bold text-[#F9F1F4] hover:bg-[#78263F]/40 disabled:opacity-50 sm:col-span-2 sm:justify-self-start"
                  >
                    <Plus className="h-3.5 w-3.5 text-[#C49A6C]" />
                    {s.chapterCreate}
                  </button>
                </form>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
