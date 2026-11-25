import React from 'react';
import { Code2, Sigma } from 'lucide-react';
import katex from 'katex';
import type {
  ClassroomEnvironment,
  Lecturer,
  SceneRecord,
  StudioLocale,
  VideoAspectRatio,
} from '../types/studio.ts';
import { withMediaToken } from '../lib/api.ts';

function renderLatex(source: string): string {
  try {
    return katex.renderToString(source, {
      throwOnError: false,
      strict: 'warn',
      output: 'html',
      displayMode: false,
    });
  } catch {
    return '';
  }
}

interface Props {
  scene: SceneRecord;
  sceneIndex: number;
  totalScenes: number;
  projectTitle: string;
  subject: string;
  language: 'ar' | 'en';
  locale: StudioLocale;
  aspectRatio?: VideoAspectRatio;
  lecturer?: Lecturer;
  environment?: ClassroomEnvironment;
}

export function SceneStagePreview({
  scene,
  sceneIndex,
  totalScenes,
  projectTitle,
  subject,
  language,
  aspectRatio = '16:9',
  lecturer,
  environment,
}: Props) {
  const isRtl = language === 'ar';
  const isPortrait = aspectRatio === '9:16';
  const progressPct = Math.round(((sceneIndex + 1) / Math.max(1, totalScenes)) * 100);
  const lecturerSrc = lecturer ? withMediaToken(lecturer.image_url) : '';

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`relative mx-auto rounded-2xl overflow-hidden border border-[#654354] bg-[#180E15] select-none ${
        isPortrait ? 'aspect-[9/16] max-w-[340px] w-full' : 'aspect-video w-full'
      }`}
    >
      {/* Classroom Backdrop */}
      {environment?.image_url && (
        <img
          src={environment.image_url}
          alt={isRtl ? environment.name_ar : environment.name}
          className="absolute inset-0 w-full h-full object-cover opacity-20"
        />
      )}
      <div className="absolute inset-0 bg-[#180E15]/80" />

      {/* Top Burgundy Broadcast Bar */}
      <div className="relative z-10 flex items-center justify-between gap-2 px-4 py-2.5 bg-[#3B0D1E]/95 border-b border-[#C49A6C]/50">
        <span className="text-[11px] font-bold text-[#C49A6C] truncate">
          {isRtl ? 'أكاديمية نبأ' : 'Naba Academy'}
        </span>
        <span className="text-[11px] text-[#C8B7C0] truncate tabular-nums">
          {isRtl
            ? `المشهد ${sceneIndex + 1}/${totalScenes} · ${subject}`
            : `Scene ${sceneIndex + 1}/${totalScenes} · ${subject}`}
        </span>
      </div>

      {/* Main Content Stage */}
      <div
        className={`relative z-10 p-3.5 sm:p-4 grid gap-3 ${
          isPortrait ? 'grid-cols-1 h-[calc(100%-108px)]' : 'grid-cols-12 h-[calc(100%-96px)]'
        }`}
      >
        {/* Presenter Portrait */}
        <div
          className={`${
            isPortrait
              ? 'flex items-center gap-3 bg-[#27131F]/90 border border-[#654354]/70 rounded-xl p-2.5'
              : 'col-span-3 flex flex-col items-center justify-center'
          }`}
        >
          {lecturer && (
            <>
              <div
                className={`rounded-xl overflow-hidden border-2 border-[#C49A6C]/70 bg-[#27131F] shrink-0 ${
                  isPortrait ? 'w-14 h-14' : 'w-full max-w-[140px] aspect-square'
                }`}
              >
                <img
                  src={lecturerSrc}
                  alt={isRtl ? lecturer.name_ar : lecturer.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className={isPortrait ? 'min-w-0' : 'mt-2 text-center w-full'}>
                <p className="text-xs font-bold text-[#F9F1F4] truncate">
                  {isRtl ? lecturer.name_ar : lecturer.name}
                </p>
                <p className="text-[10px] text-[#C49A6C] truncate">
                  {isRtl ? lecturer.specialty_ar : lecturer.specialty}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Smartboard Surface */}
        <div
          className={`${
            isPortrait ? 'flex-1' : 'col-span-9'
          } rounded-xl border border-[#654354]/80 bg-[#27131F]/95 p-3.5 sm:p-4 flex flex-col justify-between overflow-hidden`}
        >
          <div className="space-y-2.5 overflow-hidden">
            <h3 className="text-sm sm:text-base font-bold text-[#F9F1F4] leading-snug line-clamp-2">
              {scene.title || projectTitle}
            </h3>

            {scene.code_snippet.trim() && (
              <div
                dir="ltr"
                className="rounded-lg border border-[#78263F]/70 bg-[#140911] p-2.5 overflow-hidden"
              >
                <div className="flex items-center gap-1.5 text-[10px] text-[#C49A6C] mb-1 font-mono uppercase">
                  <Code2 className="w-3 h-3" />
                  <span>{scene.code_language || 'cpp'}</span>
                </div>
                <pre className="text-[11px] font-mono text-[#F9F1F4] leading-relaxed whitespace-pre-wrap line-clamp-5">
                  {scene.code_snippet}
                </pre>
              </div>
            )}

            {scene.equation_latex.trim() && (
              <div
                dir="ltr"
                className="rounded-lg border border-[#C49A6C]/50 bg-[#341A29] px-3 py-2 flex items-center justify-center"
              >
                <Sigma className="w-3.5 h-3.5 text-[#C49A6C] shrink-0 me-2" />
                <div
                  className="katex-preview text-[#F9F1F4] overflow-hidden"
                  dangerouslySetInnerHTML={{
                    __html: renderLatex(scene.equation_latex),
                  }}
                />
              </div>
            )}

            {scene.bullet_points.length > 0 && (
              <ul className="space-y-1">
                {scene.bullet_points.slice(0, scene.code_snippet.trim() ? 2 : 4).map((point, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-[#F9F1F4]/90 leading-relaxed flex items-start gap-2"
                  >
                    <span className="text-[#C49A6C] font-bold">•</span>
                    <span className="line-clamp-2">{point}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Progress Strip */}
          <div className="pt-2">
            <div className="h-1 w-full rounded-full bg-[#341A29] overflow-hidden">
              <div
                className="h-full bg-[#C49A6C] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Synchronized Subtitle Strip */}
      <div className="absolute bottom-0 inset-x-0 z-20 bg-[#180E15]/95 border-t border-[#654354]/50 px-4 py-2 text-center">
        <p className="text-xs font-medium text-[#F9F1F4] line-clamp-2 leading-relaxed">
          {scene.subtitle_text || scene.dialogue || scene.title}
        </p>
      </div>
    </div>
  );
}
