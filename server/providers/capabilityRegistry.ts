import { execFileSync } from 'node:child_process';
import type { CostEstimate, OperatingMode, ProviderCapability } from '../../src/types/studio.ts';
import { hasGeminiApiKey } from './geminiProvider.ts';
import { isPaidGeminiModelsEnabled, runLipSyncAdapter } from './lecturerEngine.ts';
import type { LipSyncRequest, LipSyncResult } from './types.ts';

function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Honest 5-modality capability matrix + script LLM & code validator:
 * 1. Deterministic smartboard video rendering (FFmpeg)
 * 2. Real neural TTS generation (Gemini 3.8 TTS)
 * 3. Real image generation (Gemini 3.1 Flash Lite Image — paid opt-in)
 * 4. Real generative video (Gemini Omni Flash / Wan 2.1 / LTX-Video)
 * 5. Real lip synchronization (SadTalker / MuseTalk / HeyGen)
 */
export function detectProviderCapabilities(): ProviderCapability[] {
  const hasFfmpeg = commandExists('ffmpeg');
  const hasGpp = commandExists('g++');
  const geminiReady = hasGeminiApiKey();
  const paidGeminiReady = isPaidGeminiModelsEnabled();
  const sadTalkerReady = Boolean(process.env.SADTALKER_ENDPOINT?.trim());
  const museTalkReady = Boolean(process.env.MUSETALK_ENDPOINT?.trim());
  const heygenReady = Boolean(process.env.HEYGEN_API_KEY?.trim());
  const wanReady = Boolean(process.env.WAN_VIDEO_ENDPOINT?.trim());
  const ltxReady = Boolean(process.env.LTX_VIDEO_ENDPOINT?.trim());

  return [
    {
      id: 'cap-ffmpeg-smartboard',
      category: 'renderer',
      provider_key: 'ffmpeg-deterministic-smartboard',
      display_name: '1. Deterministic Smartboard & Code Renderer (FFmpeg)',
      display_name_ar: '١. التصيير الحتمي للسبورة الذكية والأكواد (FFmpeg)',
      execution_mode: 'local',
      available: hasFfmpeg,
      is_free_tier: true,
      requires_gpu_or_paid_api: false,
      status_label_en: hasFfmpeg ? 'Active (Free Local CPU)' : 'Missing FFmpeg binary',
      status_label_ar: hasFfmpeg ? 'نشط (محلي مجاني)' : 'FFmpeg غير مثبت',
      limitation_note_en:
        'Renders crisp 1280x720 H.264/AAC MP4 with HarfBuzz Arabic RTL shaping, monospace code blocks, lecturer PiP card, and synced SRT subtitles. Not photorealistic facial animation.',
      limitation_note_ar:
        'ينتج فيديو MP4 بدقة 720p بنص عربي متصل وأكواد برمجية دقيقة وبطاقة المحاضر وترجمة متزامنة مجانًا (لا يُعدّ تحريكًا واقعيًا للشفاه).',
    },
    {
      id: 'cap-gemini-tts',
      category: 'tts',
      provider_key: 'gemini-3.8-flash-lite-tts',
      display_name: '2. Real Neural TTS Narration (Gemini 3.8 Flash Lite TTS)',
      display_name_ar: '٢. التعليق الصوتي العصبي الحقيقي (Gemini 3.8 TTS)',
      execution_mode: 'hybrid',
      available: geminiReady,
      is_free_tier: true,
      requires_gpu_or_paid_api: false,
      status_label_en: geminiReady ? 'Active (24kHz Arabic/English WAV)' : 'Provider Not Configured (Offline Fallback)',
      status_label_ar: geminiReady ? 'نشط (صوت عربي فصيح 24kHz)' : 'غير مفعّل (وضع التوقيت المحلي البديل)',
      limitation_note_en:
        'Synthesizes genuine Modern Standard Arabic and English speech WAV tracks. When unconfigured, falls back honestly to a silent studio cadence track.',
      limitation_note_ar:
        'يولّد تعليقًا صوتيًا حقيقيًا بالفصحى والإنجليزية. عند عدم توفر المفتاح يستخدم مسار توقيت صامت ويُصرّح بذلك بوضوح.',
    },
    {
      id: 'cap-image-gen',
      category: 'image_gen',
      provider_key: 'gemini-3.1-flash-lite-image',
      display_name: '3. Real AI Image Generation (Gemini 3.1 Flash Lite Image)',
      display_name_ar: '٣. توليد الصور بالذكاء الاصطناعي (Gemini Image)',
      execution_mode: 'cloud',
      available: paidGeminiReady,
      is_free_tier: false,
      requires_gpu_or_paid_api: true,
      status_label_en: paidGeminiReady
        ? 'Configured (Paid Opt-In Enabled)'
        : 'Provider Not Configured (Paid Key & Opt-In Required)',
      status_label_ar: paidGeminiReady
        ? 'مفعّل (بموافقة خطة مدفوعة)'
        : 'غير مفعّل (يتطلب مفتاحًا مدفوعًا وتفعيلًا صريحًا)',
      limitation_note_en:
        'Uses pre-bundled studio classroom backdrops and portraits by default. Live image generation requires a paid Gemini key and ENABLE_PAID_GEMINI_MODELS=true.',
      limitation_note_ar:
        'يستخدم خلفيات القاعات وصور المحاضرين المدمجة افتراضيًا. التوليد الفوري للصور يتطلب مفتاحًا مدفوعًا وتفعيلًا صريحًا.',
    },
    {
      id: 'cap-video-gen',
      category: 'video_gen',
      provider_key: 'gemini-omni-wan-ltx',
      display_name: '4. Real Generative Lecturer Video (Gemini Omni Flash / Wan 2.1 / LTX-Video)',
      display_name_ar: '٤. توليد فيديو المحاضر التوليدي (Gemini Omni / Wan 2.1 / LTX)',
      execution_mode: 'cloud',
      available: wanReady || ltxReady || paidGeminiReady,
      is_free_tier: false,
      requires_gpu_or_paid_api: true,
      status_label_en: wanReady || ltxReady
        ? 'External GPU Worker Configured'
        : paidGeminiReady
          ? 'Gemini Omni Flash Ready (Paid Opt-In)'
          : 'Provider Not Configured',
      status_label_ar: wanReady || ltxReady
        ? 'خادم GPU خارجي متصل'
        : paidGeminiReady
          ? 'Gemini Omni Flash جاهز (مدفوع)'
          : 'المزود غير مفعّل (Provider Not Configured)',
      limitation_note_en:
        'Generates scene lecturer video clips from reference portraits. Requires WAN_VIDEO_ENDPOINT, LTX_VIDEO_ENDPOINT, or ENABLE_PAID_GEMINI_MODELS=true. Preserves smartboard fallback when unconfigured.',
      limitation_note_ar:
        'يولّد مقاطع فيديو حقيقية للمحاضر من صورته المرجعية. يتطلب خادم GPU أو تفعيل Gemini Omni المدفوع؛ وإلا يحافظ على وضع السبورة الذكية.',
    },
    {
      id: 'cap-lipsync',
      category: 'lip_sync',
      provider_key: 'sadtalker-musetalk-heygen',
      display_name: '5. Real Facial Lip Synchronization (SadTalker / MuseTalk / HeyGen)',
      display_name_ar: '٥. مزامنة الشفاه الواقعية للوجه (SadTalker / MuseTalk / HeyGen)',
      execution_mode: 'cloud',
      available: sadTalkerReady || museTalkReady || heygenReady,
      is_free_tier: false,
      requires_gpu_or_paid_api: true,
      status_label_en: sadTalkerReady || museTalkReady
        ? 'External GPU Worker Configured'
        : heygenReady
          ? 'HeyGen Key Detected (Mapping Required)'
          : 'Provider Not Configured',
      status_label_ar: sadTalkerReady || museTalkReady
        ? 'خادم GPU لمزامنة الشفاه متصل'
        : heygenReady
          ? 'مفتاح HeyGen موجود (يتطلب ربط معرف الأفاتار)'
          : 'المزود غير مفعّل (Provider Not Configured)',
      limitation_note_en:
        'Real lip synchronization requires SADTALKER_ENDPOINT or MUSETALK_ENDPOINT on a GPU worker. Static presenter cards are never labeled as lip-sync.',
      limitation_note_ar:
        'مزامنة الشفاه الواقعية تتطلب خادم GPU مخصص (SadTalker أو MuseTalk). لا يتم تقديم بطاقة المحاضر الثابتة كمزامنة شفاه أبدًا.',
    },
    {
      id: 'cap-gemini-script',
      category: 'script_llm',
      provider_key: 'gemini-4-hydrogen',
      display_name: 'Educational Script Generation (Gemini 4 Hydrogen)',
      display_name_ar: 'توليد السيناريو التعليمي (Gemini 4 Hydrogen)',
      execution_mode: 'hybrid',
      available: geminiReady,
      is_free_tier: true,
      requires_gpu_or_paid_api: false,
      status_label_en: geminiReady ? 'Active (Free-Tier Quota)' : 'Provider Not Configured',
      status_label_ar: geminiReady ? 'نشط (حصة مجانية)' : 'المزود غير مفعّل',
      limitation_note_en:
        'Transforms lessons and uploaded PDF/DOCX/PPTX documents into structured bilingual storyboards with source attribution.',
      limitation_note_ar:
        'يحوّل الدروس والملفات المرفوعة إلى سيناريو ومشاهد منظمة مع التمييز بين النص المصدري والإضافات.',
    },
    {
      id: 'cap-gpp-validator',
      category: 'code_validator',
      provider_key: 'gpp-syntax-only',
      display_name: 'Deterministic Code Verification (g++ / python3 / node)',
      display_name_ar: 'التحقق النحوي الحتمي من الأكواد (g++ / python3 / node)',
      execution_mode: 'local',
      available: hasGpp,
      is_free_tier: true,
      requires_gpu_or_paid_api: false,
      status_label_en: hasGpp ? 'Active (Safe Syntax-Only)' : 'g++ Not Installed',
      status_label_ar: hasGpp ? 'نشط (فحص نحوي آمن دون تنفيذ)' : 'مترجم g++ غير متاح',
      limitation_note_en:
        'Verifies C/C++, Python, and JavaScript syntax without executing untrusted binaries. Never reports success if a required compiler is unavailable.',
      limitation_note_ar:
        'يتحقق من صحة الأكواد برمجيًا قبل التصيير دون تنفيذ أي ملفات، ولا يدّعي النجاح أبدًا إذا كان المترجم غير متاح.',
    },
  ];
}

export function estimateGenerationCost(
  mode: OperatingMode,
  sceneCount: number,
  totalDurationSec: number,
  options?: { allowPaidVideoGen?: boolean },
): CostEstimate {
  const geminiReady = hasGeminiApiKey();
  const hasLipSync = Boolean(
    process.env.SADTALKER_ENDPOINT?.trim() ||
      process.env.MUSETALK_ENDPOINT?.trim() ||
      process.env.HEYGEN_API_KEY?.trim(),
  );
  const hasExternalVideoGen = Boolean(
    process.env.WAN_VIDEO_ENDPOINT?.trim() || process.env.LTX_VIDEO_ENDPOINT?.trim(),
  );
  const willUsePaidOmniVideo = Boolean(options?.allowPaidVideoGen && isPaidGeminiModelsEnabled());

  const breakdown: CostEstimate['breakdown'] = [
    {
      stage_en: 'Deterministic Smartboard & Code Rendering (FFmpeg)',
      stage_ar: 'تصيير السبورة الذكية والأكواد (FFmpeg محلي)',
      provider: 'ffmpeg-local',
      cost_usd: 0,
      tier: 'free_local',
    },
    {
      stage_en: `Neural Narration (${sceneCount} scenes, ~${Math.round(totalDurationSec)}s)`,
      stage_ar: `التعليق الصوتي العصبي (${sceneCount} مشاهد، ~${Math.round(totalDurationSec)} ثانية)`,
      provider: geminiReady ? 'gemini-3.8-flash-lite-tts' : 'local-fallback',
      cost_usd: 0,
      tier: geminiReady ? 'free_quota' : 'free_local',
    },
  ];

  const warningsEn: string[] = [];
  const warningsAr: string[] = [];

  if (!geminiReady) {
    warningsEn.push(
      'GEMINI_API_KEY is not active in this process: Mode A will assemble a verified deterministic MP4 with an offline timing track instead of neural Arabic speech.',
    );
    warningsAr.push(
      'مفتاح GEMINI_API_KEY غير مفعل حاليًا: سيتم تصدير فيديو تعليمي حتمي حقيقي مع مسار توقيت محلي بديل حتى يتم تفعيل المفتاح.',
    );
  }

  let estimatedUsd = 0;
  if (mode === 'cloud' || mode === 'hybrid') {
    if (hasLipSync) {
      const est = Number((totalDurationSec * 0.015).toFixed(3));
      estimatedUsd += est;
      breakdown.push({
        stage_en: 'External Avatar Lip-Sync Inference',
        stage_ar: 'مزامنة شفاه المحاضر عبر خادم GPU خارجي',
        provider: process.env.HEYGEN_API_KEY ? 'heygen-api' : 'self-hosted-gpu-lipsync',
        cost_usd: est,
        tier: 'paid_external',
      });
    } else {
      warningsEn.push(
        'Lip-Sync Provider Not Configured: The studio will render a framed Presenter Picture-in-Picture smartboard video and clearly mark lip-sync as inactive.',
      );
      warningsAr.push(
        'مزود مزامنة الشفاه غير مفعّل: سيُنتج الاستوديو فيديو سبورة ذكية مع بطاقة المحاضر دون ادعاء وجود تحريك شفاه واقعي.',
      );
    }

    if (willUsePaidOmniVideo) {
      const est = Number((sceneCount * 0.15).toFixed(3));
      estimatedUsd += est;
      breakdown.push({
        stage_en: `Generative Lecturer Video (${sceneCount} scenes via Gemini Omni Flash)`,
        stage_ar: `توليد فيديو المحاضر (${sceneCount} مشاهد عبر Gemini Omni Flash)`,
        provider: 'gemini-omni-1.2-flash',
        cost_usd: est,
        tier: 'paid_external',
      });
    } else if (hasExternalVideoGen) {
      breakdown.push({
        stage_en: 'External GPU Lecturer Video (Wan 2.1 / LTX-Video)',
        stage_ar: 'فيديو المحاضر عبر خادم GPU خارجي (Wan / LTX)',
        provider: process.env.WAN_VIDEO_ENDPOINT ? 'wan-2.1-gpu' : 'ltx-video-gpu',
        cost_usd: 0,
        tier: 'paid_external',
      });
    } else if (mode === 'cloud') {
      warningsEn.push(
        'Generative Video Provider Not Configured: Visual composition will preserve deterministic classroom backdrops and smartboard overlays.',
      );
      warningsAr.push(
        'مزود الفيديو التوليدي غير مفعّل: سيحافظ الإنتاج على خلفيات القاعات التعليمية والسبورة الذكية الحتمية.',
      );
    }
  } else {
    warningsEn.push(
      'Mode A (Lightweight Local): Zero paid cloud video charges. Produces deterministic smartboard & code MP4 with presenter PiP.',
    );
    warningsAr.push(
      'الوضع أ (محلي خفيف): بدون أي رسوم فيديو سحابية. يُنتج فيديو MP4 حتميًا للسبورة الذكية والأكواد مع بطاقة المحاضر.',
    );
  }

  return {
    mode,
    estimated_usd: Number(estimatedUsd.toFixed(3)),
    currency: 'USD',
    breakdown,
    warnings_en: warningsEn,
    warnings_ar: warningsAr,
  };
}

export async function attemptLipSync(req: LipSyncRequest): Promise<LipSyncResult> {
  return runLipSyncAdapter(req);
}
