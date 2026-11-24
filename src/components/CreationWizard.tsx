import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  FileText,
  FileUp,
  Loader2,
  Monitor,
  Play,
  Plus,
  RotateCcw,
  Smartphone,
  Sparkles,
  Volume2,
  XCircle,
} from 'lucide-react';
import type {
  ClassroomEnvironment,
  GenerationJob,
  Lecturer,
  OperatingMode,
  ProjectDetail,
  StudioLocale,
  VideoAspectRatio,
  VideoResolution,
  VoiceProfile,
} from '../types/studio.ts';
import { t } from '../i18n/strings.ts';
import { studioApi, withMediaToken } from '../lib/api.ts';

interface Props {
  locale: StudioLocale;
  lecturers: Lecturer[];
  voices: VoiceProfile[];
  environments: ClassroomEnvironment[];
  initialTopic?: string;
  initialFile?: File | null;
  defaultLecturerId?: string;
  defaultVoiceId?: string;
  defaultEnvironmentId?: string;
  onProjectReady: (projectId: string) => void;
  onRefreshProjects: () => Promise<void>;
}

const SUBJECTS = [
  { id: 'Computer Science', ar: 'علوم الحاسوب والبرمجة', en: 'Computer Science & Programming' },
  { id: 'Mathematics', ar: 'الرياضيات', en: 'Mathematics' },
  { id: 'Physics', ar: 'الفيزياء', en: 'Physics' },
  { id: 'Engineering', ar: 'الهندسة', en: 'Engineering' },
  { id: 'Science', ar: 'العلوم الطبيعية', en: 'Natural Sciences' },
  { id: 'General', ar: 'معرفة عامة وتعليم', en: 'General Education' },
];

const LEVELS = [
  { id: 'k12', ar: 'المرحلة الابتدائية والمتوسطة', en: 'K-12' },
  { id: 'high_school', ar: 'المرحلة الثانوية', en: 'High School' },
  { id: 'undergraduate', ar: 'المرحلة الجامعية', en: 'Undergraduate' },
  { id: 'graduate', ar: 'الدراسات العليا', en: 'Graduate' },
  { id: 'professional', ar: 'التدريب المهني', en: 'Professional' },
];

const DURATION_PRESETS = [
  { sec: 20, ar: 'سريع (20 ث)', en: 'Quick (20s)' },
  { sec: 45, ar: 'متوسط (45 ث)', en: 'Standard (45s)' },
  { sec: 90, ar: 'تفصيلي (90 ث)', en: 'Detailed (90s)' },
];

export function CreationWizard({
  locale,
  lecturers,
  voices,
  environments,
  initialTopic = '',
  initialFile = null,
  defaultLecturerId,
  defaultVoiceId,
  defaultEnvironmentId,
  onProjectReady,
  onRefreshProjects,
}: Props) {
  const s = t(locale);
  const isAr = locale === 'ar';
  const NextIcon = isAr ? ArrowLeft : ArrowRight;
  const BackIcon = isAr ? ArrowRight : ArrowLeft;

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — Content
  const [contentMode, setContentMode] = useState<'topic' | 'paste' | 'upload'>(
    initialFile ? 'upload' : 'topic',
  );
  const [topic, setTopic] = useState(initialTopic);
  const [subject, setSubject] = useState('Computer Science');
  const [language, setLanguage] = useState<'ar' | 'en'>(locale);
  const [educationLevel, setEducationLevel] = useState('undergraduate');
  const [pastedScript, setPastedScript] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile);

  // Step 2 — Video Style
  const [lecturerId, setLecturerId] = useState(defaultLecturerId || lecturers[0]?.id || 'lec-tariq');
  const [environmentId, setEnvironmentId] = useState(
    defaultEnvironmentId || environments[0]?.id || 'env-lecture-hall',
  );
  const [voiceId, setVoiceId] = useState(() => {
    if (defaultVoiceId) return defaultVoiceId;
    const match = voices.find((v) => v.language === locale);
    return match?.id || voices[0]?.id || 'voice-ar-tariq';
  });
  const [targetDuration, setTargetDuration] = useState(20);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [resolution, setResolution] = useState<VideoResolution>('720p');
  const [mode, setMode] = useState<OperatingMode>('hybrid');
  const [allowPaidVideoGen, setAllowPaidVideoGen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Persisted Project + Job State
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [voicePreviewingId, setVoicePreviewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep matching voice when language switches if user hasn't picked one in that language
  useEffect(() => {
    const currentVoice = voices.find((v) => v.id === voiceId);
    if (!currentVoice || currentVoice.language !== language) {
      const match = voices.find((v) => v.language === language);
      if (match) setVoiceId(match.id);
    }
  }, [language, voices, voiceId]);

  // Poll active generation job
  useEffect(() => {
    if (!job) return;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;

    const timer = window.setInterval(async () => {
      try {
        const res = await studioApi.getJob(job.id);
        setJob(res.job);
        if (res.job.status === 'completed' && project) {
          const updated = await studioApi.getProject(project.id);
          setProject(updated.project);
          await onRefreshProjects();
        }
      } catch {
        // Ignore transient poll error
      }
    }, 1400);

    return () => window.clearInterval(timer);
  }, [job, project, onRefreshProjects]);

  async function ensureProjectCreated(): Promise<ProjectDetail> {
    if (project) return project;
    const cleanTitle =
      topic.trim() ||
      selectedFile?.name.replace(/\.[^.]+$/, '') ||
      (language === 'ar' ? 'درس تعليمي جديد' : 'New Educational Lesson');

    const res = await studioApi.createProject({
      title: cleanTitle,
      title_ar: cleanTitle,
      subject,
      education_level: educationLevel,
      language,
      mode,
      aspect_ratio: aspectRatio,
      resolution,
      lecturer_id: lecturerId,
      voice_id: voiceId,
      environment_id: environmentId,
    });
    setProject(res.project);
    await onRefreshProjects();
    return res.project;
  }

  async function handlePrepareContent() {
    setError(null);
    setInfoNotice(null);
    setBusy(true);
    try {
      const proj = await ensureProjectCreated();

      if (contentMode === 'paste') {
        if (pastedScript.trim().length < 12) {
          throw new Error(
            isAr
              ? 'يرجى لصق نص سيناريو لا يقل عن جملة واحدة.'
              : 'Please paste at least one paragraph of lesson script.',
          );
        }
        const saved = await studioApi.saveManualScript(proj.id, {
          raw_script: pastedScript.trim(),
          target_duration_sec: targetDuration,
        });
        setProject(saved.project);
        setInfoNotice(
          isAr
            ? `تم تقسيم النص إلى ${saved.project.scenes.length} مشاهد جاهزة للتعديل.`
            : `Split your script into ${saved.project.scenes.length} editable scenes.`,
        );
        return;
      }

      let materialId: string | undefined;
      if (selectedFile) {
        const uploaded = await studioApi.uploadMaterial(proj.id, selectedFile);
        materialId = uploaded.material.id;
      }

      const effectiveTopic =
        topic.trim() ||
        selectedFile?.name.replace(/\.[^.]+$/, '') ||
        (language === 'ar' ? 'درس تعليمي متكامل' : 'Structured Academic Lesson');

      const gen = await studioApi.generateScript(proj.id, {
        topic: effectiveTopic,
        target_duration_sec: targetDuration,
        material_id: materialId,
      });
      setProject(gen.project);
      setInfoNotice(
        isAr
          ? `تم توليد ${gen.project.scenes.length} مشاهد تعليمية. يمكنك مراجعتها أو تعديلها قبل المتابعة.`
          : `Generated ${gen.project.scenes.length} educational scenes. Review or edit them before continuing.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر تجهيز المحتوى' : 'Failed to prepare content');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateSceneQuick(sceneId: string, fields: { title?: string; dialogue?: string }) {
    if (!project) return;
    const target = project.scenes.find((sc) => sc.id === sceneId);
    if (!target) return;
    const updatedDialogue = fields.dialogue ?? target.dialogue;
    const updatedTitle = fields.title ?? target.title;
    setProject({
      ...project,
      scenes: project.scenes.map((sc) =>
        sc.id === sceneId
          ? { ...sc, title: updatedTitle, dialogue: updatedDialogue, subtitle_text: updatedDialogue.slice(0, 260) }
          : sc,
      ),
    });
    try {
      await studioApi.updateScene(project.id, sceneId, {
        title: updatedTitle,
        dialogue: updatedDialogue,
        subtitle_text: updatedDialogue.slice(0, 260),
      });
    } catch {
      // Non-blocking inline edit
    }
  }

  async function handleProceedFromStep1() {
    setError(null);
    setBusy(true);
    try {
      const proj = await ensureProjectCreated();
      // If user hasn't generated or pasted scenes yet, auto-apply if pasted or keep starter intro scene
      if (contentMode === 'paste' && pastedScript.trim().length >= 12 && !proj.script) {
        const saved = await studioApi.saveManualScript(proj.id, { raw_script: pastedScript.trim() });
        setProject(saved.project);
      }
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر المتابعة' : 'Unable to proceed');
    } finally {
      setBusy(false);
    }
  }

  async function handleProceedFromStep2() {
    setError(null);
    setBusy(true);
    try {
      const proj = await ensureProjectCreated();
      const updated = await studioApi.updateProject(proj.id, {
        language,
        subject,
        education_level: educationLevel,
        mode,
        aspect_ratio: aspectRatio,
        resolution,
        lecturer_id: lecturerId,
        voice_id: voiceId,
        environment_id: environmentId,
      });
      setProject(updated.project);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر حفظ اختيارات النمط' : 'Failed to save style');
    } finally {
      setBusy(false);
    }
  }

  async function handlePreviewVoice(v: VoiceProfile) {
    setVoicePreviewingId(v.id);
    setError(null);
    try {
      const sampleText =
        v.language === 'ar'
          ? 'مرحبًا بكم في أكاديمية نبأ، حيث نحوّل المعرفة إلى تجربة تعليمية واضحة وممتعة.'
          : 'Welcome to Naba Academy, where every lesson becomes a clear educational experience.';
      const res = await studioApi.previewVoice({
        voice_id: v.id,
        text: sampleText,
        speaking_rate: v.speaking_rate,
      });
      const src = `data:${res.mime_type};base64,${res.audio_base64}`;
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      audioRef.current.src = src;
      await audioRef.current.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر تشغيل المعاينة الصوتية' : 'Voice preview failed');
    } finally {
      setVoicePreviewingId(null);
    }
  }

  async function handleStartGeneration(retryFromJobId?: string) {
    if (!project) return;
    setError(null);
    setBusy(true);
    try {
      const res = await studioApi.startRender(project.id, {
        mode,
        aspect_ratio: aspectRatio,
        resolution,
        allow_cloud_tts: mode !== 'local',
        allow_paid_video_gen: allowPaidVideoGen,
        retry_from_job_id: retryFromJobId,
      });
      setJob(res.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر بدء إنتاج الفيديو' : 'Could not start video generation');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelGeneration() {
    if (!job) return;
    try {
      const res = await studioApi.cancelJob(job.id);
      setJob(res.job);
    } catch {
      // Ignore
    }
  }

  const languageVoices = voices.filter((v) => v.language === language);
  const selectedLecturer = lecturers.find((l) => l.id === lecturerId);
  const selectedEnv = environments.find((e) => e.id === environmentId);
  const selectedVoice = voices.find((v) => v.id === voiceId);
  const completedExport =
    job?.status === 'completed' && project
      ? project.exports.find((e) => e.id === job.output_video_id) ?? project.exports[0] ?? null
      : null;

  const isGenerating =
    job !== null &&
    job.status !== 'completed' &&
    job.status !== 'failed' &&
    job.status !== 'cancelled';

  const stepsMeta = [
    { num: 1 as const, label: s.step1Title },
    { num: 2 as const, label: s.step2Title },
    { num: 3 as const, label: s.step3Title },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-8">
      {/* Header + Minimal 3-Step Stepper */}
      <div className="space-y-5">
        <h1 className="text-2xl font-extrabold text-[#F9F1F4]">{s.wizardTitle}</h1>

        <ol className="grid grid-cols-3 gap-3">
          {stepsMeta.map((item) => {
            const active = step === item.num;
            const done = step > item.num;
            return (
              <li
                key={item.num}
                className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors ${
                  active
                    ? 'border-[#C49A6C] bg-[#3B0D1E]'
                    : done
                      ? 'border-[#49B894]/50 bg-[#27131F]'
                      : 'border-[#654354]/60 bg-[#27131F]/60'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold tabular-nums shrink-0 ${
                    active
                      ? 'bg-[#C49A6C] text-[#180E15]'
                      : done
                        ? 'bg-[#49B894] text-[#180E15]'
                        : 'bg-[#341A29] text-[#C8B7C0]'
                  }`}
                >
                  {done ? <Check className="w-4 h-4" /> : item.num}
                </span>
                <span
                  className={`text-xs sm:text-sm font-bold truncate ${
                    active || done ? 'text-[#F9F1F4]' : 'text-[#C8B7C0]'
                  }`}
                >
                  {item.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {error && (
        <div className="rounded-xl border border-[#F07883]/50 bg-[#F07883]/10 px-4 py-3 flex items-start gap-2.5 text-sm text-[#F07883]">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {infoNotice && (
        <div className="rounded-xl border border-[#49B894]/40 bg-[#49B894]/10 px-4 py-3 text-sm text-[#49B894]">
          {infoNotice}
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP 1 — CONTENT                                                  */}
      {/* ================================================================= */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-5 sm:p-7 space-y-6">
            {/* Content Input Mode Tabs */}
            <div className="inline-flex flex-wrap p-1 rounded-xl border border-[#654354]/70 bg-[#180E15] gap-1">
              {(
                [
                  { id: 'topic', label: s.contentTabTopic },
                  { id: 'paste', label: s.contentTabPaste },
                  { id: 'upload', label: s.contentTabUpload },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setContentMode(tab.id)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                    contentMode === tab.id
                      ? 'bg-[#78263F] text-[#F9F1F4]'
                      : 'text-[#C8B7C0] hover:text-[#F9F1F4]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Topic / Title */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                  {s.lessonTopicLabel}
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={s.lessonTopicPlaceholder}
                  className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-4 py-3 text-sm text-[#F9F1F4] placeholder-[#C8B7C0]/50 focus:border-[#C49A6C] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                    {s.languageLabel}
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')}
                    className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2.5 text-sm text-[#F9F1F4] focus:border-[#C49A6C] focus:outline-none"
                  >
                    <option value="ar">العربية (Arabic)</option>
                    <option value="en">English (الإنجليزية)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                    {s.subjectLabel}
                  </label>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2.5 text-sm text-[#F9F1F4] focus:border-[#C49A6C] focus:outline-none"
                  >
                    {SUBJECTS.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {isAr ? sub.ar : sub.en}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                    {s.levelLabel}
                  </label>
                  <select
                    value={educationLevel}
                    onChange={(e) => setEducationLevel(e.target.value)}
                    className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2.5 text-sm text-[#F9F1F4] focus:border-[#C49A6C] focus:outline-none"
                  >
                    {LEVELS.map((lv) => (
                      <option key={lv.id} value={lv.id}>
                        {isAr ? lv.ar : lv.en}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {contentMode === 'paste' && (
                <div>
                  <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                    {s.pasteScriptLabel}
                  </label>
                  <textarea
                    rows={6}
                    value={pastedScript}
                    onChange={(e) => setPastedScript(e.target.value)}
                    placeholder={s.pasteScriptPlaceholder}
                    className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-4 py-3 text-sm text-[#F9F1F4] placeholder-[#C8B7C0]/50 focus:border-[#C49A6C] focus:outline-none leading-relaxed"
                  />
                </div>
              )}

              {contentMode === 'upload' && (
                <div className="rounded-xl border border-dashed border-[#654354] bg-[#180E15] p-6 text-center space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.pptx,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setSelectedFile(f);
                      if (f && !topic.trim()) setTopic(f.name.replace(/\.[^.]+$/, ''));
                    }}
                  />
                  <FileUp className="w-7 h-7 text-[#C49A6C] mx-auto" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-[#F9F1F4]">
                      {selectedFile ? selectedFile.name : s.uploadDropTitle}
                    </p>
                    <p className="text-xs text-[#C8B7C0]">{s.uploadDropSub}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#654354] bg-[#27131F] hover:bg-[#341A29] text-xs font-bold text-[#F9F1F4] transition-colors"
                  >
                    <FileUp className="w-4 h-4 text-[#C49A6C]" />
                    {selectedFile ? (isAr ? 'تغيير الملف' : 'Change File') : isAr ? 'اختيار ملف' : 'Choose File'}
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handlePrepareContent}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#78263F] hover:bg-[#9E4761] disabled:opacity-60 text-sm font-bold text-[#F9F1F4] transition-colors whitespace-nowrap"
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-[#C49A6C]" />
                  )}
                  {busy
                    ? s.generatingScript
                    : contentMode === 'paste'
                      ? s.applyScriptBtn
                      : s.generateScriptBtn}
                </button>
              </div>
            </div>
          </div>

          {/* Inline Script & Scene Review (Visible once scenes exist) */}
          {project && project.scenes.length > 0 && (
            <div className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-[#F9F1F4]">{s.scriptReadyTitle}</h2>
                  <p className="text-xs text-[#C8B7C0] mt-0.5">{s.scriptReadySub}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const added = await studioApi.addScene(project.id, {
                      title: isAr ? `مشهد ${project.scenes.length + 1}` : `Scene ${project.scenes.length + 1}`,
                      dialogue: isAr ? 'اكتب نص الشرح لهذا المشهد هنا.' : 'Write the narration for this scene.',
                      duration_sec: 5,
                    });
                    setProject(added.project);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#341A29] text-xs font-semibold text-[#F9F1F4] whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C49A6C]" />
                  {s.addSceneQuick}
                </button>
              </div>

              <div className="space-y-3">
                {project.scenes.map((sc, idx) => (
                  <div
                    key={sc.id}
                    className="rounded-xl border border-[#654354]/60 bg-[#180E15] p-4 space-y-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-[#C49A6C] tabular-nums">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <input
                        type="text"
                        value={sc.title}
                        onChange={(e) => handleUpdateSceneQuick(sc.id, { title: e.target.value })}
                        className="flex-1 bg-transparent text-sm font-bold text-[#F9F1F4] focus:outline-none border-b border-transparent focus:border-[#C49A6C] pb-0.5"
                      />
                    </div>
                    <textarea
                      rows={2}
                      value={sc.dialogue}
                      onChange={(e) => handleUpdateSceneQuick(sc.id, { dialogue: e.target.value })}
                      className="w-full rounded-lg border border-[#654354]/50 bg-[#27131F]/60 px-3 py-2 text-xs text-[#F9F1F4] focus:border-[#C49A6C] focus:outline-none leading-relaxed"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 1 Footer */}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={handleProceedFromStep1}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#78263F] hover:bg-[#9E4761] disabled:opacity-60 text-sm font-bold text-[#F9F1F4] transition-colors whitespace-nowrap"
            >
              {s.stepNext}
              <NextIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP 2 — VIDEO STYLE                                              */}
      {/* ================================================================= */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Virtual Lecturer Visual Cards */}
          <section className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-[#F9F1F4]">{s.styleLecturerTitle}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {lecturers.map((lec) => {
                const selected = lec.id === lecturerId;
                return (
                  <button
                    key={lec.id}
                    type="button"
                    onClick={() => setLecturerId(lec.id)}
                    className={`text-start rounded-xl border p-3 flex items-center gap-3.5 transition-colors ${
                      selected
                        ? 'border-[#C49A6C] bg-[#3B0D1E]'
                        : 'border-[#654354]/60 bg-[#180E15] hover:border-[#9E4761]'
                    }`}
                  >
                    <img
                      src={withMediaToken(lec.image_url)}
                      alt={isAr ? lec.name_ar : lec.name}
                      className="w-14 h-14 rounded-xl object-cover border border-[#654354] shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#F9F1F4] truncate">
                        {isAr ? lec.name_ar : lec.name}
                      </p>
                      <p className="text-xs text-[#C8B7C0] truncate">
                        {isAr ? lec.specialty_ar : lec.specialty}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Classroom Environment Visual Cards */}
          <section className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-[#F9F1F4]">{s.styleClassroomTitle}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {environments.map((env) => {
                const selected = env.id === environmentId;
                return (
                  <button
                    key={env.id}
                    type="button"
                    onClick={() => setEnvironmentId(env.id)}
                    className={`text-start rounded-xl border overflow-hidden transition-colors ${
                      selected
                        ? 'border-[#C49A6C] bg-[#3B0D1E]'
                        : 'border-[#654354]/60 bg-[#180E15] hover:border-[#9E4761]'
                    }`}
                  >
                    <div className="aspect-[16/7] w-full overflow-hidden bg-[#180E15]">
                      <img
                        src={env.image_url}
                        alt={isAr ? env.name_ar : env.name}
                        className="w-full h-full object-cover opacity-80"
                      />
                    </div>
                    <div className="p-3.5 space-y-1">
                      <p className="text-sm font-bold text-[#F9F1F4]">
                        {isAr ? env.name_ar : env.name}
                      </p>
                      <p className="text-xs text-[#C8B7C0] line-clamp-1">
                        {isAr ? env.description_ar : env.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Voice Selection + Preview */}
          <section className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-[#F9F1F4]">{s.styleVoiceTitle}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {languageVoices.map((v) => {
                const selected = v.id === voiceId;
                const previewing = voicePreviewingId === v.id;
                return (
                  <div
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setVoiceId(v.id);
                    }}
                    className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                      selected
                        ? 'border-[#C49A6C] bg-[#3B0D1E]'
                        : 'border-[#654354]/60 bg-[#180E15] hover:border-[#9E4761]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#F9F1F4] truncate">
                        {isAr ? v.name_ar : v.name}
                      </p>
                      <p className="text-xs text-[#C8B7C0] truncate">
                        {v.gender === 'female' ? (isAr ? 'صوت نسائي' : 'Female') : isAr ? 'صوت رجالي' : 'Male'} ·{' '}
                        {v.speaking_rate}x
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={previewing}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePreviewVoice(v);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#654354] bg-[#27131F] hover:bg-[#581629] text-xs font-semibold text-[#F9F1F4] whitespace-nowrap shrink-0"
                    >
                      {previewing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C49A6C]" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5 text-[#C49A6C]" />
                      )}
                      {s.previewVoiceBtn}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Aspect Ratio + Duration */}
          <section className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-[#F9F1F4]">{s.styleAspectTitle}</h2>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAspectRatio('16:9')}
                  className={`rounded-xl border p-3.5 text-start space-y-1.5 transition-colors ${
                    aspectRatio === '16:9'
                      ? 'border-[#C49A6C] bg-[#3B0D1E]'
                      : 'border-[#654354]/60 bg-[#180E15] hover:border-[#9E4761]'
                  }`}
                >
                  <Monitor className="w-5 h-5 text-[#C49A6C]" />
                  <p className="text-xs font-bold text-[#F9F1F4]">16:9</p>
                  <p className="text-[11px] text-[#C8B7C0]">{s.aspect169}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setAspectRatio('9:16')}
                  className={`rounded-xl border p-3.5 text-start space-y-1.5 transition-colors ${
                    aspectRatio === '9:16'
                      ? 'border-[#C49A6C] bg-[#3B0D1E]'
                      : 'border-[#654354]/60 bg-[#180E15] hover:border-[#9E4761]'
                  }`}
                >
                  <Smartphone className="w-5 h-5 text-[#C49A6C]" />
                  <p className="text-xs font-bold text-[#F9F1F4]">9:16</p>
                  <p className="text-[11px] text-[#C8B7C0]">{s.aspect916}</p>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-bold text-[#F9F1F4]">{s.styleDurationTitle}</h2>
              <div className="grid grid-cols-3 gap-2.5">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.sec}
                    type="button"
                    onClick={() => setTargetDuration(preset.sec)}
                    className={`rounded-xl border py-3 px-2 text-xs font-bold transition-colors tabular-nums ${
                      targetDuration === preset.sec
                        ? 'border-[#C49A6C] bg-[#3B0D1E] text-[#F9F1F4]'
                        : 'border-[#654354]/60 bg-[#180E15] text-[#C8B7C0] hover:text-[#F9F1F4]'
                    }`}
                  >
                    {isAr ? preset.ar : preset.en}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Progressive Disclosure: Advanced Settings */}
          <section className="rounded-2xl border border-[#654354]/70 bg-[#27131F] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full px-5 py-4 flex items-center justify-between text-xs font-bold text-[#C8B7C0] hover:text-[#F9F1F4] transition-colors"
            >
              <span>{s.advancedSettingsToggle}</span>
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showAdvanced && (
              <div className="px-5 pb-5 pt-2 border-t border-[#654354]/40 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                    {s.resolutionLabel}
                  </label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as VideoResolution)}
                    className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2.5 text-sm text-[#F9F1F4]"
                  >
                    <option value="720p">720p HD (Default — Fast)</option>
                    <option value="1080p">1080p Full HD</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                    {s.modeLabel}
                  </label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as OperatingMode)}
                    className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2.5 text-sm text-[#F9F1F4]"
                  >
                    <option value="hybrid">{s.modeHybrid}</option>
                    <option value="local">{s.modeLocal}</option>
                    <option value="cloud">{s.modeCloud}</option>
                  </select>
                </div>

                <label className="sm:col-span-2 flex items-center gap-2.5 text-xs text-[#C8B7C0] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowPaidVideoGen}
                    onChange={(e) => setAllowPaidVideoGen(e.target.checked)}
                    className="rounded border-[#654354] accent-[#78263F]"
                  />
                  <span>{s.paidVideoToggle}</span>
                </label>
              </div>
            )}
          </section>

          {/* Step 2 Footer */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#654354] bg-[#27131F] hover:bg-[#341A29] text-sm font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap"
            >
              <BackIcon className="w-4 h-4" />
              {s.stepBack}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handleProceedFromStep2}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#78263F] hover:bg-[#9E4761] disabled:opacity-60 text-sm font-bold text-[#F9F1F4] transition-colors whitespace-nowrap"
            >
              {s.stepNext}
              <NextIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP 3 — GENERATION & EXPORT                                      */}
      {/* ================================================================= */}
      {step === 3 && project && (
        <div className="space-y-6">
          {/* Summary Card */}
          <div className="rounded-2xl border border-[#654354]/80 bg-[#27131F] p-5 sm:p-7 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-[#F9F1F4]">
                  {isAr ? project.title_ar : project.title}
                </h2>
                <p className="text-xs text-[#C8B7C0] tabular-nums">
                  {project.scenes.length} {s.scenesUnit} · {aspectRatio} · {resolution} ·{' '}
                  {selectedLecturer ? (isAr ? selectedLecturer.name_ar : selectedLecturer.name) : ''} ·{' '}
                  {selectedVoice ? (isAr ? selectedVoice.name_ar : selectedVoice.name) : ''} ·{' '}
                  {selectedEnv ? (isAr ? selectedEnv.name_ar : selectedEnv.name) : ''}
                </p>
              </div>

              {!isGenerating && !completedExport && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleStartGeneration()}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#78263F] hover:bg-[#9E4761] disabled:opacity-60 text-sm font-bold text-[#F9F1F4] transition-colors whitespace-nowrap shrink-0"
                >
                  <Play className="w-4 h-4 text-[#C49A6C]" />
                  {s.genStartBtn}
                </button>
              )}
            </div>

            {/* Real Generation Progress */}
            {job && (
              <div className="rounded-xl border border-[#654354]/70 bg-[#180E15] p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-[#F9F1F4]">
                    {job.status === 'completed'
                      ? s.genCompletedTitle
                      : job.status === 'failed'
                        ? isAr
                          ? 'فشل إنتاج الفيديو'
                          : 'Generation Failed'
                        : job.status === 'cancelled'
                          ? isAr
                            ? 'تم إلغاء الإنتاج'
                            : 'Generation Cancelled'
                          : s.genInProgress}
                  </span>
                  <span className="text-sm font-mono font-bold text-[#C49A6C] tabular-nums">
                    {job.progress_pct}%
                  </span>
                </div>

                <div className="h-2 w-full rounded-full bg-[#341A29] overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      job.status === 'failed' || job.status === 'cancelled'
                        ? 'bg-[#F07883]'
                        : job.status === 'completed'
                          ? 'bg-[#49B894]'
                          : 'bg-[#C49A6C]'
                    }`}
                    style={{ width: `${Math.max(4, job.progress_pct)}%` }}
                  />
                </div>

                <div className="space-y-2">
                  {job.stages.map((st) => (
                    <div key={st.key} className="flex items-center justify-between gap-3 text-xs">
                      <span
                        className={
                          st.status === 'completed'
                            ? 'text-[#49B894] font-semibold'
                            : st.status === 'running'
                              ? 'text-[#F9F1F4] font-semibold'
                              : st.status === 'failed'
                                ? 'text-[#F07883]'
                                : 'text-[#C8B7C0]/60'
                        }
                      >
                        {isAr ? st.label_ar : st.label_en}
                      </span>
                      <span className="text-[#C8B7C0] truncate max-w-[55%]">
                        {st.detail || ''}
                      </span>
                    </div>
                  ))}
                </div>

                {job.error_message && (
                  <p className="text-xs text-[#F07883] pt-2 border-t border-[#654354]/40">
                    {job.error_message}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2.5 pt-2">
                  {isGenerating && (
                    <button
                      type="button"
                      onClick={handleCancelGeneration}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#F07883]/50 text-xs font-bold text-[#F07883] hover:bg-[#F07883]/10"
                    >
                      <XCircle className="w-4 h-4" />
                      {s.genCancelBtn}
                    </button>
                  )}

                  {(job.status === 'failed' || job.status === 'cancelled') && (
                    <button
                      type="button"
                      onClick={() => handleStartGeneration(job.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#78263F] hover:bg-[#9E4761] text-xs font-bold text-[#F9F1F4]"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {s.genRetryBtn}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Finished Playable Video Preview & Downloads */}
            {completedExport && (
              <div className="space-y-4 pt-2">
                <video
                  src={withMediaToken(completedExport.video_url)}
                  controls
                  className="w-full max-h-[520px] rounded-xl border border-[#654354] bg-black"
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <a
                      href={withMediaToken(`/api/exports/${completedExport.id}/download`)}
                      download
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#78263F] hover:bg-[#9E4761] text-sm font-bold text-[#F9F1F4] transition-colors whitespace-nowrap"
                    >
                      <Download className="w-4 h-4 text-[#C49A6C]" />
                      {s.genDownloadMp4}
                    </a>
                    <a
                      href={withMediaToken(completedExport.srt_url)}
                      download
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#341A29] text-sm font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap"
                    >
                      <FileText className="w-4 h-4 text-[#C49A6C]" />
                      {s.genDownloadSrt}
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={() => onProjectReady(project.id)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#654354] bg-[#341A29] hover:bg-[#581629] text-sm font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap"
                  >
                    <Edit3 className="w-4 h-4 text-[#C49A6C]" />
                    {s.genOpenEditor}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 3 Back Button */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#654354] bg-[#27131F] hover:bg-[#341A29] disabled:opacity-50 text-sm font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap"
            >
              <BackIcon className="w-4 h-4" />
              {s.stepBack}
            </button>

            <button
              type="button"
              onClick={() => onProjectReady(project.id)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#654354] bg-[#27131F] hover:bg-[#341A29] text-sm font-semibold text-[#C49A6C] transition-colors whitespace-nowrap"
            >
              <Edit3 className="w-4 h-4" />
              {s.genOpenEditor}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
