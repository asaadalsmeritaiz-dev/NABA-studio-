import React, { useRef, useState } from 'react';
import { Check, Loader2, Plus, ShieldCheck, Upload, Volume2, X } from 'lucide-react';
import type {
  ClassroomEnvironment,
  Lecturer,
  StudioLocale,
  VoiceProfile,
} from '../types/studio.ts';
import { t } from '../i18n/strings.ts';
import { studioApi, withMediaToken } from '../lib/api.ts';

interface Props {
  locale: StudioLocale;
  lecturers: Lecturer[];
  voices: VoiceProfile[];
  environments: ClassroomEnvironment[];
  preferredLecturerId: string;
  preferredVoiceId: string;
  preferredEnvironmentId: string;
  onSelectLecturer: (id: string) => void;
  onSelectVoice: (id: string) => void;
  onSelectEnvironment: (id: string) => void;
  onLecturerAdded: () => Promise<void>;
}

export function LecturersLibrary({
  locale,
  lecturers,
  voices,
  environments,
  preferredLecturerId,
  preferredVoiceId,
  preferredEnvironmentId,
  onSelectLecturer,
  onSelectVoice,
  onSelectEnvironment,
  onLecturerAdded,
}: Props) {
  const s = t(locale);
  const isAr = locale === 'ar';

  const [tab, setTab] = useState<'lecturers' | 'voices' | 'classrooms'>('lecturers');
  const [uploadOpen, setUploadOpen] = useState(false);

  // Voice preview state
  const [speakingRates, setSpeakingRates] = useState<Record<string, number>>({});
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Custom lecturer upload form
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [consentVerified, setConsentVerified] = useState(false);
  const [consentNote, setConsentNote] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handlePreviewVoice(v: VoiceProfile) {
    setPreviewingVoiceId(v.id);
    setVoiceError(null);
    try {
      const rate = speakingRates[v.id] ?? v.speaking_rate;
      const sample =
        v.language === 'ar'
          ? 'أهلًا بكم في أكاديمية نبأ، نقدم لكم دروسًا تعليمية واضحة ومنظمة.'
          : 'Welcome to Naba Academy, bringing structured clarity to every lesson.';
      const res = await studioApi.previewVoice({
        voice_id: v.id,
        text: sample,
        speaking_rate: rate,
      });
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = `data:${res.mime_type};base64,${res.audio_base64}`;
      await audioRef.current.play();
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : isAr ? 'تعذر تشغيل المعاينة' : 'Preview failed');
    } finally {
      setPreviewingVoiceId(null);
    }
  }

  async function handleUploadLecturer(e: React.FormEvent) {
    e.preventDefault();
    setUploadError(null);
    if (!imageFile) {
      setUploadError(isAr ? 'يرجى اختيار صورة (JPG أو PNG أو WEBP).' : 'Please select a portrait image.');
      return;
    }
    if (!consentVerified || consentNote.trim().length < 6) {
      setUploadError(
        isAr
          ? 'تأكيد الموافقة الخطية وإدخال مرجع الموافقة مطلوبان.'
          : 'Explicit likeness consent and authorization reference are required.',
      );
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('name_ar', name.trim());
      fd.append('specialty', specialty.trim() || (isAr ? 'محاضر أكاديمي' : 'Academic Lecturer'));
      fd.append('specialty_ar', specialty.trim() || (isAr ? 'محاضر أكاديمي' : 'Academic Lecturer'));
      fd.append('consent_verified', 'true');
      fd.append('consent_note', consentNote.trim());
      fd.append('image', imageFile);
      await studioApi.uploadCustomLecturer(fd);
      await onLecturerAdded();
      setUploadOpen(false);
      setName('');
      setSpecialty('');
      setConsentVerified(false);
      setConsentNote('');
      setImageFile(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : isAr ? 'فشل رفع صورة المحاضر' : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#F9F1F4]">{s.libraryTitle}</h1>
          <p className="text-sm text-[#C8B7C0] mt-1">{s.librarySubtitle}</p>
        </div>

        {tab === 'lecturers' && (
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#78263F] hover:bg-[#9E4761] text-xs font-bold text-[#F9F1F4] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 text-[#C49A6C]" />
            {s.uploadLecturerBtn}
          </button>
        )}
      </div>

      {/* Category Tabs */}
      <div className="inline-flex p-1 rounded-xl border border-[#654354]/70 bg-[#27131F]">
        {(
          [
            { id: 'lecturers', label: s.libraryLecturers, count: lecturers.length },
            { id: 'voices', label: s.libraryVoices, count: voices.length },
            { id: 'classrooms', label: s.libraryClassrooms, count: environments.length },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap tabular-nums ${
              tab === item.id
                ? 'bg-[#78263F] text-[#F9F1F4]'
                : 'text-[#C8B7C0] hover:text-[#F9F1F4]'
            }`}
          >
            {item.label} ({item.count})
          </button>
        ))}
      </div>

      {/* Lecturers Grid */}
      {tab === 'lecturers' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {lecturers.map((lec) => {
            const isDefault = lec.id === preferredLecturerId;
            return (
              <div
                key={lec.id}
                className={`rounded-2xl border overflow-hidden flex flex-col justify-between transition-colors ${
                  isDefault
                    ? 'border-[#C49A6C] bg-[#3B0D1E]'
                    : 'border-[#654354]/80 bg-[#27131F]'
                }`}
              >
                <div>
                  <div className="aspect-[4/3] bg-[#180E15] overflow-hidden">
                    <img
                      src={withMediaToken(lec.image_url)}
                      alt={isAr ? lec.name_ar : lec.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-4 space-y-1.5">
                    <h2 className="text-base font-bold text-[#F9F1F4]">
                      {isAr ? lec.name_ar : lec.name}
                    </h2>
                    <p className="text-xs font-medium text-[#C49A6C]">
                      {isAr ? lec.specialty_ar : lec.specialty}
                    </p>
                    <p className="text-xs text-[#C8B7C0] line-clamp-2 leading-relaxed">
                      {isAr ? lec.bio_ar : lec.bio}
                    </p>
                  </div>
                </div>

                <div className="px-4 pb-4">
                  <button
                    type="button"
                    onClick={() => onSelectLecturer(lec.id)}
                    className={`w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                      isDefault
                        ? 'bg-[#C49A6C] text-[#180E15]'
                        : 'border border-[#654354] bg-[#180E15] hover:bg-[#581629] text-[#F9F1F4]'
                    }`}
                  >
                    {isDefault && <Check className="w-3.5 h-3.5" />}
                    {isDefault ? s.preferredDefault : s.setPreferred}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Voices List */}
      {tab === 'voices' && (
        <div className="space-y-4">
          {voiceError && (
            <div className="rounded-xl border border-[#F07883]/50 bg-[#F07883]/10 px-4 py-3 text-xs text-[#F07883]">
              {voiceError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {voices.map((v) => {
              const isDefault = v.id === preferredVoiceId;
              const rate = speakingRates[v.id] ?? v.speaking_rate;
              const previewing = previewingVoiceId === v.id;
              return (
                <div
                  key={v.id}
                  className={`rounded-2xl border p-5 space-y-4 transition-colors ${
                    isDefault
                      ? 'border-[#C49A6C] bg-[#3B0D1E]'
                      : 'border-[#654354]/80 bg-[#27131F]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-[#F9F1F4]">
                        {isAr ? v.name_ar : v.name}
                      </h2>
                      <p className="text-xs text-[#C8B7C0] mt-0.5">
                        {v.language === 'ar' ? 'العربية' : 'English'} ·{' '}
                        {v.gender === 'female'
                          ? isAr
                            ? 'صوت نسائي'
                            : 'Female'
                          : isAr
                            ? 'صوت رجالي'
                            : 'Male'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={previewing}
                      onClick={() => handlePreviewVoice(v)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#654354] bg-[#180E15] hover:bg-[#581629] text-xs font-semibold text-[#F9F1F4] whitespace-nowrap"
                    >
                      {previewing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C49A6C]" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5 text-[#C49A6C]" />
                      )}
                      {s.previewVoiceBtn}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 text-xs text-[#C8B7C0]">
                    <span>{s.speakingSpeed}</span>
                    <input
                      type="range"
                      min={0.8}
                      max={1.25}
                      step={0.05}
                      value={rate}
                      onChange={(e) =>
                        setSpeakingRates((prev) => ({ ...prev, [v.id]: Number(e.target.value) }))
                      }
                      className="flex-1 accent-[#C49A6C]"
                    />
                    <span className="font-mono tabular-nums text-[#F9F1F4]">{rate.toFixed(2)}x</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectVoice(v.id)}
                    className={`w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                      isDefault
                        ? 'bg-[#C49A6C] text-[#180E15]'
                        : 'border border-[#654354] bg-[#180E15] hover:bg-[#581629] text-[#F9F1F4]'
                    }`}
                  >
                    {isDefault && <Check className="w-3.5 h-3.5" />}
                    {isDefault ? s.preferredDefault : s.setPreferred}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Classrooms Grid */}
      {tab === 'classrooms' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {environments.map((env) => {
            const isDefault = env.id === preferredEnvironmentId;
            return (
              <div
                key={env.id}
                className={`rounded-2xl border overflow-hidden flex flex-col justify-between transition-colors ${
                  isDefault
                    ? 'border-[#C49A6C] bg-[#3B0D1E]'
                    : 'border-[#654354]/80 bg-[#27131F]'
                }`}
              >
                <div>
                  <div className="aspect-video bg-[#180E15] overflow-hidden">
                    <img
                      src={env.image_url}
                      alt={isAr ? env.name_ar : env.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-5 space-y-1.5">
                    <h2 className="text-base font-bold text-[#F9F1F4]">
                      {isAr ? env.name_ar : env.name}
                    </h2>
                    <p className="text-xs text-[#C8B7C0] leading-relaxed">
                      {isAr ? env.description_ar : env.description}
                    </p>
                  </div>
                </div>

                <div className="px-5 pb-5">
                  <button
                    type="button"
                    onClick={() => onSelectEnvironment(env.id)}
                    className={`w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                      isDefault
                        ? 'bg-[#C49A6C] text-[#180E15]'
                        : 'border border-[#654354] bg-[#180E15] hover:bg-[#581629] text-[#F9F1F4]'
                    }`}
                  >
                    {isDefault && <Check className="w-3.5 h-3.5" />}
                    {isDefault ? s.preferredDefault : s.setPreferred}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Custom Lecturer Upload Modal */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#180E15]/85 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleUploadLecturer}
            className="w-full max-w-lg rounded-2xl border border-[#654354] bg-[#27131F] p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#F9F1F4] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#C49A6C]" />
                {s.uploadLecturerTitle}
              </h2>
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="p-1.5 rounded-lg text-[#C8B7C0] hover:text-[#F9F1F4]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#C8B7C0] mb-1">
                {isAr ? 'اسم المحاضر' : 'Lecturer Name'}
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2.5 text-sm text-[#F9F1F4]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#C8B7C0] mb-1">
                {isAr ? 'التخصص' : 'Specialty'}
              </label>
              <input
                type="text"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2.5 text-sm text-[#F9F1F4]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#C8B7C0] mb-1">
                {isAr ? 'صورة المحاضر (JPG/PNG/WEBP)' : 'Portrait Image (JPG/PNG/WEBP)'}
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-[#C8B7C0] file:me-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#581629] file:text-[#F9F1F4] file:font-semibold"
              />
            </div>

            <label className="flex items-start gap-2.5 text-xs text-[#C8B7C0] cursor-pointer">
              <input
                type="checkbox"
                checked={consentVerified}
                onChange={(e) => setConsentVerified(e.target.checked)}
                className="mt-0.5 accent-[#78263F]"
              />
              <span>{s.consentRequiredLabel}</span>
            </label>

            <input
              type="text"
              required
              minLength={6}
              value={consentNote}
              onChange={(e) => setConsentNote(e.target.value)}
              placeholder={s.consentNotePlaceholder}
              className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-3.5 py-2.5 text-xs text-[#F9F1F4] placeholder-[#C8B7C0]/50"
            />

            {uploadError && <p className="text-xs text-[#F07883]">{uploadError}</p>}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="px-4 py-2 rounded-xl border border-[#654354] text-xs font-semibold text-[#C8B7C0]"
              >
                {s.confirmCancel}
              </button>
              <button
                type="submit"
                disabled={uploading}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#78263F] hover:bg-[#9E4761] disabled:opacity-60 text-xs font-bold text-[#F9F1F4]"
              >
                <Upload className="w-3.5 h-3.5 text-[#C49A6C]" />
                {uploading ? (isAr ? 'جاري الرفع...' : 'Uploading...') : s.uploadLecturerBtn}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
