import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ClassroomEnvironment,
  Lecturer,
  SceneRecord,
  VideoAspectRatio,
  VideoResolution,
  VoiceProfile,
} from '../../src/types/studio.ts';
import {
  hasGeminiApiKey,
  probeMediaDuration,
  synthesizeLocalAcousticTrack,
  synthesizeSpeechWithGemini,
} from '../providers/geminiProvider.ts';
import { attemptLipSync } from '../providers/capabilityRegistry.ts';
import { generateLecturerSceneVideo } from '../providers/lecturerEngine.ts';
import { isPathConfined } from '../services/security.ts';

const execFileAsync = promisify(execFile);

const MONO_FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';

export function getStorageRoot(): string {
  const dir = path.resolve(process.cwd(), process.env.STORAGE_DIR || 'storage');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveSafeAssetPath(urlOrPath: string): string | null {
  if (!urlOrPath) return null;
  const projectRoot = process.cwd();
  const storageRoot = getStorageRoot();
  const assetsBase = path.resolve(projectRoot, 'src', 'assets');

  if (urlOrPath.startsWith('/src/assets/')) {
    const candidate = path.resolve(projectRoot, urlOrPath.slice(1));
    if (isPathConfined(candidate, assetsBase) && fs.existsSync(candidate)) {
      return candidate;
    }
    return null;
  }

  if (urlOrPath.startsWith('/storage/')) {
    const candidate = path.resolve(projectRoot, urlOrPath.slice(1));
    if (isPathConfined(candidate, storageRoot) && fs.existsSync(candidate)) {
      return candidate;
    }
    return null;
  }

  const candidate = path.resolve(urlOrPath);
  if (
    (isPathConfined(candidate, storageRoot) || isPathConfined(candidate, assetsBase)) &&
    fs.existsSync(candidate)
  ) {
    return candidate;
  }
  return null;
}

export function computeOutputDimensions(
  aspectRatio: VideoAspectRatio = '16:9',
  resolution: VideoResolution = '720p',
): { width: number; height: number; isPortrait: boolean } {
  if (aspectRatio === '9:16') {
    return resolution === '1080p'
      ? { width: 1080, height: 1920, isPortrait: true }
      : { width: 720, height: 1280, isPortrait: true };
  }
  return resolution === '1080p'
    ? { width: 1920, height: 1080, isPortrait: false }
    : { width: 1280, height: 720, isPortrait: false };
}

function formatAssTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const hours = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function formatSrtTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const hours = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const adjustedSec = ms === 1000 ? secs + 1 : secs;
  const adjustedMs = ms === 1000 ? 0 : ms;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(adjustedSec).padStart(2, '0')},${String(adjustedMs).padStart(3, '0')}`;
}

function sanitizeAssText(text: string): string {
  return text
    .replace(/\\/g, '/')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

function wrapTextLines(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current += ` ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function buildSceneAssScript(params: {
  scene: SceneRecord;
  sceneIndex: number;
  totalScenes: number;
  projectTitle: string;
  subject: string;
  language: 'ar' | 'en';
  lecturer: Lecturer;
  clipDurationSec: number;
  speechDurationSec: number;
  hasRealLipSync: boolean;
  hasGenerativeVideo: boolean;
  isPortrait: boolean;
}): string {
  const {
    scene,
    sceneIndex,
    totalScenes,
    projectTitle,
    subject,
    language,
    lecturer,
    clipDurationSec,
    speechDurationSec,
    hasRealLipSync,
    hasGenerativeVideo,
    isPortrait,
  } = params;
  const isRtl = language === 'ar';
  const endTs = formatAssTime(clipDurationSec);
  const hasCode = scene.code_snippet.trim().length > 0;
  const hasEq = scene.equation_latex.trim().length > 0;

  const playResX = isPortrait ? 720 : 1280;
  const playResY = isPortrait ? 1280 : 720;

  const brandText = isRtl ? 'أكاديمية نبأ · أستوديو الفيديو التعليمي' : 'Naba Academy · AI Video Studio';
  const sceneCounter = isRtl
    ? `المشهد ${sceneIndex + 1} من ${totalScenes} · ${subject}`
    : `Scene ${sceneIndex + 1} of ${totalScenes} · ${subject}`;
  const lecturerLabel = isRtl ? lecturer.name_ar : lecturer.name;
  const modeDisclosure = hasRealLipSync
    ? isRtl
      ? 'مزامنة شفاه نشطة'
      : 'Lip-Sync Active'
    : hasGenerativeVideo
      ? isRtl
        ? 'فيديو محاضر توليدي'
        : 'AI Lecturer Clip'
      : isRtl
        ? 'السبورة الذكية'
        : 'Smartboard Studio';

  // ASS colors are &H00BBGGRR:
  // Champagne Gold #C49A6C -> &H006C9AC4
  // Primary Text #F9F1F4   -> &H00F4F1F9
  // Secondary Text #C8B7C0 -> &H00C0B7C8
  // Dark Plum #180E15      -> &H00150E18
  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Brand,Noto Kufi Arabic,${isPortrait ? 20 : 22},&H006C9AC4,&H006C9AC4,&H00150E18,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,9,32,32,18,1`,
    `Style: Meta,Noto Sans Arabic,${isPortrait ? 17 : 18},&H00C0B7C8,&H00C0B7C8,&H00150E18,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,32,32,20,1`,
    `Style: BoardTitle,Noto Kufi Arabic,${isPortrait ? 32 : 34},&H00F4F1F9,&H00F4F1F9,&H00150E18,&H00000000,-1,0,0,0,100,100,0,0,1,1,0,9,36,36,20,1`,
    `Style: Bullet,Noto Sans Arabic,${isPortrait ? 24 : 25},&H00EFE5EA,&H00EFE5EA,&H00150E18,&H00000000,0,0,0,0,100,100,0,0,1,0,0,9,36,36,20,1`,
    `Style: PresenterName,Noto Kufi Arabic,${isPortrait ? 22 : 21},&H00F4F1F9,&H00F4F1F9,&H00150E18,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,10,10,10,1`,
    `Style: PresenterSub,Noto Sans Arabic,${isPortrait ? 16 : 15},&H006C9AC4,&H006C9AC4,&H00150E18,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,10,10,10,1`,
    `Style: Subtitle,Noto Sans Arabic,${isPortrait ? 28 : 27},&H00FFFFFF,&H00FFFFFF,&H00150E18,&H80000000,-1,0,0,0,100,100,0,0,1,1.5,0,2,48,48,36,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const titleAlign = isRtl ? 9 : 7;

  if (isPortrait) {
    const boardTextX = isRtl ? 652 : 68;
    lines.push(
      `Dialogue: 2,0:00:00.00,${endTs},Brand,,0,0,0,,{\\an8\\pos(360,26)}${sanitizeAssText(brandText)}`,
      `Dialogue: 2,0:00:00.00,${endTs},Meta,,0,0,0,,{\\an8\\pos(360,58)}${sanitizeAssText(`${sceneCounter} · ${projectTitle}`)}`,
      `Dialogue: 3,0:00:00.00,${endTs},PresenterName,,0,0,0,,{\\an8\\pos(360,364)}${sanitizeAssText(lecturerLabel)}`,
      `Dialogue: 3,0:00:00.00,${endTs},PresenterSub,,0,0,0,,{\\an8\\pos(360,396)}${sanitizeAssText(modeDisclosure)}`,
      `Dialogue: 3,0:00:00.00,${endTs},BoardTitle,,0,0,0,,{\\an${titleAlign}\\pos(${boardTextX},472)}${sanitizeAssText(scene.title)}`,
    );

    const bullets = scene.bullet_points.slice(0, hasCode ? 2 : 4);
    const bulletStartY = hasCode ? 850 : hasEq ? 640 : 560;
    const bulletLineGap = hasCode ? 56 : 74;
    bullets.forEach((b, i) => {
      const wrapped = wrapTextLines(b, isRtl ? 34 : 38).slice(0, 2).join('\\N');
      const y = bulletStartY + i * bulletLineGap;
      lines.push(
        `Dialogue: 3,0:00:00.00,${endTs},Bullet,,0,0,0,,{\\an${titleAlign}\\pos(${boardTextX},${y})}${sanitizeAssText(`• ${wrapped}`)}`,
      );
    });
  } else {
    const boardRightX = isRtl ? 1196 : 86;
    const presenterCenterX = isRtl ? 188 : 1092;
    lines.push(
      `Dialogue: 2,0:00:00.00,${endTs},Brand,,0,0,0,,{\\an${isRtl ? 9 : 7}\\pos(${isRtl ? 1232 : 48},20)}${sanitizeAssText(brandText)}`,
      `Dialogue: 2,0:00:00.00,${endTs},Meta,,0,0,0,,{\\an${isRtl ? 7 : 9}\\pos(${isRtl ? 48 : 1232},22)}${sanitizeAssText(`${sceneCounter} · ${projectTitle}`)}`,
      `Dialogue: 3,0:00:00.00,${endTs},BoardTitle,,0,0,0,,{\\an${titleAlign}\\pos(${boardRightX},114)}${sanitizeAssText(scene.title)}`,
      `Dialogue: 3,0:00:00.00,${endTs},PresenterName,,0,0,0,,{\\an8\\pos(${presenterCenterX},424)}${sanitizeAssText(lecturerLabel)}`,
      `Dialogue: 3,0:00:00.00,${endTs},PresenterSub,,0,0,0,,{\\an8\\pos(${presenterCenterX},456)}${sanitizeAssText(modeDisclosure)}`,
    );

    const bullets = scene.bullet_points.slice(0, hasCode ? 2 : 4);
    const bulletStartY = hasCode ? 454 : hasEq ? 286 : 196;
    const bulletLineGap = hasCode ? 44 : 62;
    bullets.forEach((b, i) => {
      const wrapped = wrapTextLines(b, isRtl ? 54 : 60).slice(0, 2).join('\\N');
      const y = bulletStartY + i * bulletLineGap;
      lines.push(
        `Dialogue: 3,0:00:00.00,${endTs},Bullet,,0,0,0,,{\\an${titleAlign}\\pos(${boardRightX},${y})}${sanitizeAssText(`• ${wrapped}`)}`,
      );
    });
  }

  // Synchronized bottom subtitles timed strictly to actual spoken speech duration
  const subSource = (scene.subtitle_text || scene.dialogue || '').trim();
  const effectiveSubWindow = Math.min(clipDurationSec, Math.max(1.0, speechDurationSec));
  if (subSource) {
    const subLines = wrapTextLines(subSource, isPortrait ? (isRtl ? 34 : 38) : isRtl ? 62 : 68);
    const chunks: string[] = [];
    for (let i = 0; i < subLines.length; i += 2) {
      chunks.push(subLines.slice(i, i + 2).join('\\N'));
    }
    const segDur = effectiveSubWindow / Math.max(1, chunks.length);
    const subPosX = isPortrait ? 360 : 640;
    const subPosY = isPortrait ? 1226 : 680;
    chunks.forEach((chunk, idx) => {
      const sStart = formatAssTime(idx * segDur);
      const sEnd = formatAssTime(Math.min(effectiveSubWindow, (idx + 1) * segDur));
      lines.push(
        `Dialogue: 4,${sStart},${sEnd},Subtitle,,0,0,0,,{\\an2\\pos(${subPosX},${subPosY})}${sanitizeAssText(chunk)}`,
      );
    });
  }

  return lines.join('\n');
}

export function buildSrtContent(
  entries: Array<{ startSec: number; endSec: number; text: string }>,
): string {
  return entries
    .map((entry, idx) => {
      return `${idx + 1}\n${formatSrtTime(entry.startSec)} --> ${formatSrtTime(entry.endSec)}\n${entry.text.trim()}\n`;
    })
    .join('\n');
}

function getAudioCachePath(params: {
  dialogue: string;
  language: 'ar' | 'en';
  voiceId: string;
  speakingRate: number;
  stylePrompt: string;
  allowCloudTts: boolean;
  durationSec: number;
}): string {
  const cacheDir = path.join(getStorageRoot(), 'audio_cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const hash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        dialogue: params.dialogue.trim(),
        language: params.language,
        voiceId: params.voiceId,
        speakingRate: Number(params.speakingRate.toFixed(2)),
        stylePrompt: params.stylePrompt,
        cloud: params.allowCloudTts && hasGeminiApiKey(),
        // Local acoustic tracks depend on duration_sec; cloud TTS duration comes from speech
        dur: params.allowCloudTts && hasGeminiApiKey() ? 0 : Number(params.durationSec.toFixed(1)),
      }),
    )
    .digest('hex')
    .slice(0, 24);
  return path.join(cacheDir, `${hash}.wav`);
}

export async function renderSceneAudio(params: {
  scene: SceneRecord;
  language: 'ar' | 'en';
  voice: VoiceProfile;
  outputWavPath: string;
  allowCloudTts: boolean;
}): Promise<{
  wavPath: string;
  durationSec: number;
  provider: string;
  isRealHumanSpeech: boolean;
  note: string;
  cached?: boolean;
}> {
  const { scene, language, voice, outputWavPath, allowCloudTts } = params;
  const cacheWav = getAudioCachePath({
    dialogue: scene.dialogue,
    language,
    voiceId: voice.provider_voice_id,
    speakingRate: voice.speaking_rate,
    stylePrompt: voice.style_prompt,
    allowCloudTts,
    durationSec: scene.duration_sec,
  });
  const cacheMetaPath = `${cacheWav}.json`;

  if (fs.existsSync(cacheWav) && fs.existsSync(cacheMetaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(cacheMetaPath, 'utf8')) as {
        durationSec: number;
        provider: string;
        isRealHumanSpeech: boolean;
        note: string;
      };
      if (meta.durationSec > 0.5 && fs.statSync(cacheWav).size > 1000) {
        fs.mkdirSync(path.dirname(outputWavPath), { recursive: true });
        fs.copyFileSync(cacheWav, outputWavPath);
        return {
          wavPath: outputWavPath,
          durationSec: meta.durationSec,
          provider: `${meta.provider} (cached)`,
          isRealHumanSpeech: meta.isRealHumanSpeech,
          note: meta.note,
          cached: true,
        };
      }
    } catch {
      // Cache entry corrupt; regenerate cleanly
    }
  }

  let result: { wavPath: string; durationSec: number; provider: string; isRealHumanSpeech: boolean; note: string };

  if (allowCloudTts && hasGeminiApiKey() && scene.dialogue.trim().length > 0) {
    try {
      result = await synthesizeSpeechWithGemini({
        text: scene.dialogue,
        language,
        voiceId: voice.provider_voice_id,
        stylePrompt: voice.style_prompt,
        speakingRate: voice.speaking_rate,
        outputWavPath,
      });
    } catch (err) {
      const fallback = await synthesizeLocalAcousticTrack(
        outputWavPath,
        scene.duration_sec,
        language,
        scene.dialogue,
      );
      result = {
        ...fallback,
        note: `Cloud TTS unavailable (${err instanceof Error ? err.message : 'error'}); used local fallback.`,
      };
    }
  } else {
    result = await synthesizeLocalAcousticTrack(outputWavPath, scene.duration_sec, language, scene.dialogue);
  }

  try {
    if (fs.existsSync(result.wavPath) && fs.statSync(result.wavPath).size > 1000) {
      fs.copyFileSync(result.wavPath, cacheWav);
      fs.writeFileSync(
        cacheMetaPath,
        JSON.stringify({
          durationSec: result.durationSec,
          provider: result.provider,
          isRealHumanSpeech: result.isRealHumanSpeech,
          note: result.note,
        }),
        'utf8',
      );
    }
  } catch {
    // Non-fatal cache write failure
  }

  return { ...result, cached: false };
}

async function verifyRenderedMp4(
  mp4Path: string,
): Promise<{ durationSec: number; hasVideo: boolean; hasAudio: boolean; resolution: string }> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4Path],
    { timeout: 10_000 },
  );
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const hasVideo = Boolean(videoStream);
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  const durationSec = Number.parseFloat(parsed.format?.duration ?? '0') || 0;
  const resolution =
    videoStream?.width && videoStream?.height ? `${videoStream.width}x${videoStream.height}` : '1280x720';
  return { durationSec, hasVideo, hasAudio, resolution };
}

export async function renderProjectVideo(params: {
  projectId: string;
  projectTitle: string;
  subject: string;
  language: 'ar' | 'en';
  aspectRatio?: VideoAspectRatio;
  resolution?: VideoResolution;
  lecturer: Lecturer;
  voice: VoiceProfile;
  environment: ClassroomEnvironment;
  scenes: SceneRecord[];
  sceneVisualPaths?: Map<string, string>;
  allowCloudTts: boolean;
  attemptExternalLipSync: boolean;
  allowPaidVideoGen?: boolean;
  workDir: string;
  outputMp4Path: string;
  outputSrtPath: string;
  onStageProgress: (stage: string, pct: number, detail: string) => void;
  isCancelled: () => boolean;
}): Promise<{
  mp4Path: string;
  srtPath: string;
  durationSec: number;
  resolution: string;
  sizeBytes: number;
  hasRealTts: boolean;
  hasRealLipSync: boolean;
  hasGenerativeVideo: boolean;
  renderMode: string;
  sceneAudioOutputs: Array<{ sceneId: string; wavPath: string; durationSec: number; provider: string }>;
}> {
  const {
    projectTitle,
    subject,
    language,
    aspectRatio = '16:9',
    resolution = '720p',
    lecturer,
    voice,
    environment,
    scenes,
    sceneVisualPaths,
    allowCloudTts,
    attemptExternalLipSync,
    allowPaidVideoGen = false,
    workDir,
    outputMp4Path,
    outputSrtPath,
    onStageProgress,
    isCancelled,
  } = params;

  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputMp4Path), { recursive: true });

  const dims = computeOutputDimensions(aspectRatio, resolution);
  const baseW = dims.isPortrait ? 720 : 1280;
  const baseH = dims.isPortrait ? 1280 : 720;

  const bgPath = resolveSafeAssetPath(environment.image_url);
  const lecturerPath = resolveSafeAssetPath(lecturer.image_url);

  if (isCancelled()) throw new Error('Job cancelled by user.');

  // Stage 1: Generate / Synchronize Narration Audio per Scene (with cache reuse)
  onStageProgress('generating_audio', 18, 'Synthesizing scene narration audio tracks...');
  const sceneAudioOutputs: Array<{
    sceneId: string;
    wavPath: string;
    durationSec: number;
    speechDurationSec: number;
    provider: string;
  }> = [];
  let anyRealTts = false;

  for (let i = 0; i < scenes.length; i++) {
    if (isCancelled()) throw new Error('Job cancelled by user.');
    const scene = scenes[i];
    const wavPath = path.join(workDir, `scene_${i + 1}.wav`);
    const ttsRes = await renderSceneAudio({
      scene,
      language,
      voice,
      outputWavPath: wavPath,
      allowCloudTts,
    });
    if (ttsRes.isRealHumanSpeech) anyRealTts = true;

    const speechDur = ttsRes.durationSec;
    const effectiveDur = ttsRes.isRealHumanSpeech
      ? Math.max(2.5, Number((speechDur + 0.35).toFixed(2)))
      : Math.max(2.5, Number(Math.max(speechDur, scene.duration_sec).toFixed(2)));

    sceneAudioOutputs.push({
      sceneId: scene.id,
      wavPath: ttsRes.wavPath,
      durationSec: effectiveDur,
      speechDurationSec: Number(Math.min(effectiveDur, Math.max(1.0, speechDur)).toFixed(2)),
      provider: ttsRes.provider,
    });

    onStageProgress(
      'generating_audio',
      18 + Math.round(((i + 1) / scenes.length) * 24),
      `Scene ${i + 1}/${scenes.length}: ${ttsRes.provider} (${speechDur.toFixed(1)}s speech -> ${effectiveDur.toFixed(1)}s clip)`,
    );
  }

  // Stage 2: Lip-Sync & Generative Lecturer Video Resolution (Honest provider checks)
  onStageProgress('synchronizing', 46, 'Checking lip-sync & lecturer video providers...');
  let anyRealLipSync = false;
  let anyGenerativeVideo = false;
  const presenterVideoClips = new Map<string, { path: string; kind: 'lipsync' | 'generative' }>();

  if (sceneVisualPaths) {
    for (const scene of scenes) {
      const prePath = sceneVisualPaths.get(scene.id);
      if (prePath && fs.existsSync(prePath)) {
        presenterVideoClips.set(scene.id, { path: prePath, kind: 'generative' });
        anyGenerativeVideo = true;
      }
    }
  }

  if (attemptExternalLipSync && lecturerPath) {
    for (let i = 0; i < scenes.length; i++) {
      if (isCancelled()) throw new Error('Job cancelled by user.');
      const clipOut = path.join(workDir, `lipsync_${i + 1}.mp4`);
      const lsRes = await attemptLipSync({
        lecturerImagePath: lecturerPath,
        audioWavPath: sceneAudioOutputs[i].wavPath,
        outputVideoPath: clipOut,
      });
      if (lsRes.supported && lsRes.videoPath) {
        anyRealLipSync = true;
        presenterVideoClips.set(scenes[i].id, { path: lsRes.videoPath, kind: 'lipsync' });
      } else {
        onStageProgress('synchronizing', 52, lsRes.reason);
        break;
      }
    }
  }

  if (!anyRealLipSync && lecturerPath && (allowPaidVideoGen || process.env.WAN_VIDEO_ENDPOINT || process.env.LTX_VIDEO_ENDPOINT)) {
    for (let i = 0; i < scenes.length; i++) {
      if (presenterVideoClips.has(scenes[i].id)) continue;
      if (isCancelled()) throw new Error('Job cancelled by user.');
      const clipOut = path.join(workDir, `lecturer_gen_${i + 1}.mp4`);
      const genRes = await generateLecturerSceneVideo({
        lecturer,
        lecturerImagePath: lecturerPath,
        environment,
        scene: scenes[i],
        language,
        targetDurationSec: sceneAudioOutputs[i].durationSec,
        outputVideoPath: clipOut,
        allowPaidVideoGen,
      });
      if (genRes.status === 'generated' && genRes.videoPath) {
        anyGenerativeVideo = true;
        presenterVideoClips.set(scenes[i].id, { path: genRes.videoPath, kind: 'generative' });
      } else {
        onStageProgress('synchronizing', 55, genRes.reason);
        break;
      }
    }
  } else if (!anyRealLipSync && !anyGenerativeVideo) {
    onStageProgress(
      'synchronizing',
      55,
      'Smartboard Studio Mode active (Presenter PiP — external lip-sync/video provider not configured).',
    );
  }

  // Stage 3: Render each deterministic scene MP4 clip (Dark Burgundy Smartboard Palette)
  onStageProgress(
    'generating_visuals',
    58,
    `Rendering smartboard & code scenes (${dims.width}x${dims.height} · ${aspectRatio})...`,
  );
  const clipPaths: string[] = [];
  const srtEntries: Array<{ startSec: number; endSec: number; text: string }> = [];
  let runningTime = 0;
  const isRtl = language === 'ar';

  for (let i = 0; i < scenes.length; i++) {
    if (isCancelled()) throw new Error('Job cancelled by user.');
    const scene = scenes[i];
    const audioMeta = sceneAudioOutputs[i];
    const dur = audioMeta.durationSec;
    const presenterVideo = presenterVideoClips.get(scene.id);

    const assPath = path.join(workDir, `scene_${i + 1}.ass`);
    const assContent = buildSceneAssScript({
      scene,
      sceneIndex: i,
      totalScenes: scenes.length,
      projectTitle,
      subject,
      language,
      lecturer,
      clipDurationSec: dur,
      speechDurationSec: audioMeta.speechDurationSec,
      hasRealLipSync: presenterVideo?.kind === 'lipsync',
      hasGenerativeVideo: presenterVideo?.kind === 'generative',
      isPortrait: dims.isPortrait,
    });
    fs.writeFileSync(assPath, assContent, 'utf8');

    const clipPath = path.join(workDir, `clip_${i + 1}.mp4`);
    const hasCode = scene.code_snippet.trim().length > 0;
    const hasEq = scene.equation_latex.trim().length > 0;

    // Layout coordinates computed in base design space (1280x720 or 720x1280), then scaled if 1080p
    const boardX = dims.isPortrait ? 36 : isRtl ? 364 : 48;
    const boardY = dims.isPortrait ? 444 : 92;
    const boardW = dims.isPortrait ? 648 : 868;
    const boardH = dims.isPortrait ? 632 : 472;
    const pipX = dims.isPortrait ? 240 : isRtl ? 48 : 952;
    const pipY = dims.isPortrait ? 104 : 122;
    const pipSize = dims.isPortrait ? 240 : 280;
    const progressW = Math.max(40, Math.round(((i + 1) / scenes.length) * boardW));

    const args: string[] = ['-y'];

    if (bgPath) {
      args.push('-loop', '1', '-t', dur.toFixed(2), '-i', bgPath);
    } else {
      args.push('-f', 'lavfi', '-i', `color=c=0x180E15:s=${baseW}x${baseH}:r=24:d=${dur.toFixed(2)}`);
    }

    args.push('-i', audioMeta.wavPath);

    const hasPresenterInput = Boolean(presenterVideo || lecturerPath);
    if (presenterVideo) {
      args.push('-stream_loop', '-1', '-t', dur.toFixed(2), '-i', presenterVideo.path);
    } else if (lecturerPath) {
      args.push('-loop', '1', '-t', dur.toFixed(2), '-i', lecturerPath);
    }

    const filterParts: string[] = [];
    // Dark Plum atmospheric overlay (#180E15)
    filterParts.push(
      `[0:v]scale=${baseW}:${baseH}:force_original_aspect_ratio=increase,crop=${baseW}:${baseH},fps=24,drawbox=x=0:y=0:w=${baseW}:h=${baseH}:color=0x180E15@0.82:t=fill[bg0]`,
    );

    const topBarH = dims.isPortrait ? 92 : 68;
    const subBarY = dims.isPortrait ? 1104 : 604;
    const subBarH = dims.isPortrait ? 176 : 116;

    // Deep Burgundy top bar (#3B0D1E), Elevated Surface smartboard (#27131F), Champagne Gold accent (#C49A6C)
    let panelFilter =
      `[bg0]` +
      `drawbox=x=0:y=0:w=${baseW}:h=${topBarH}:color=0x3B0D1E@0.96:t=fill,` +
      `drawbox=x=0:y=${topBarH}:w=${baseW}:h=2:color=0xC49A6C@0.85:t=fill,` +
      `drawbox=x=${boardX}:y=${boardY}:w=${boardW}:h=${boardH}:color=0x27131F@0.95:t=fill,` +
      `drawbox=x=${boardX}:y=${boardY}:w=${boardW}:h=${boardH}:color=0x654354@0.85:t=2,` +
      `drawbox=x=${boardX}:y=${boardY + boardH - 6}:w=${progressW}:h=6:color=0xC49A6C@0.95:t=fill,` +
      `drawbox=x=0:y=${subBarY}:w=${baseW}:h=${subBarH}:color=0x180E15@0.94:t=fill`;

    if (hasCode) {
      const codeFile = path.join(workDir, `code_${i + 1}.txt`);
      const codeLines = scene.code_snippet.split(/\r?\n/).slice(0, dims.isPortrait ? 10 : 12).join('\n');
      fs.writeFileSync(codeFile, codeLines, 'utf8');
      const codeBoxX = boardX + 24;
      const codeBoxY = dims.isPortrait ? boardY + 96 : boardY + 92;
      const codeBoxW = boardW - 48;
      const codeBoxH = dims.isPortrait ? 286 : 254;
      panelFilter +=
        `,drawbox=x=${codeBoxX}:y=${codeBoxY}:w=${codeBoxW}:h=${codeBoxH}:color=0x140911@0.98:t=fill,` +
        `drawbox=x=${codeBoxX}:y=${codeBoxY}:w=${codeBoxW}:h=${codeBoxH}:color=0x78263F@0.75:t=2,` +
        `drawtext=fontfile='${MONO_FONT_PATH}':textfile='${escapeFfmpegFilterPath(codeFile)}':fontcolor=0xF9F1F4:fontsize=${dims.isPortrait ? 18 : 20}:line_spacing=7:x=${codeBoxX + 18}:y=${codeBoxY + 18}`;
    }

    if (hasEq) {
      const eqFile = path.join(workDir, `eq_${i + 1}.txt`);
      fs.writeFileSync(eqFile, scene.equation_latex.trim(), 'utf8');
      const eqBoxX = boardX + 24;
      const eqBoxY = hasCode ? (dims.isPortrait ? boardY + 394 : boardY + 354) : boardY + 98;
      const eqBoxW = boardW - 48;
      const eqBoxH = 66;
      panelFilter +=
        `,drawbox=x=${eqBoxX}:y=${eqBoxY}:w=${eqBoxW}:h=${eqBoxH}:color=0x341A29@0.96:t=fill,` +
        `drawbox=x=${eqBoxX}:y=${eqBoxY}:w=${eqBoxW}:h=${eqBoxH}:color=0xC49A6C@0.65:t=2,` +
        `drawtext=fontfile='${MONO_FONT_PATH}':textfile='${escapeFfmpegFilterPath(eqFile)}':fontcolor=0xF9F1F4:fontsize=${dims.isPortrait ? 21 : 24}:x=${eqBoxX + 24}:y=${eqBoxY + 20}`;
    }

    panelFilter += `[panels]`;
    filterParts.push(panelFilter);

    let afterOverlay = '[panels]';
    if (hasPresenterInput) {
      const nameCardH = 74;
      filterParts.push(
        `[2:v]scale=${pipSize}:${pipSize}:force_original_aspect_ratio=increase,crop=${pipSize}:${pipSize},fps=24[pip]`,
      );
      filterParts.push(
        `[panels]drawbox=x=${pipX - 4}:y=${pipY - 4}:w=${pipSize + 8}:h=${pipSize + 8}:color=0xC49A6C@0.90:t=fill,` +
          `drawbox=x=${pipX - 4}:y=${pipY + pipSize + 10}:w=${pipSize + 8}:h=${nameCardH}:color=0x3B0D1E@0.95:t=fill,` +
          `drawbox=x=${pipX - 4}:y=${pipY + pipSize + 10}:w=${pipSize + 8}:h=${nameCardH}:color=0x654354@0.8:t=1[pbg]`,
      );
      filterParts.push(`[pbg][pip]overlay=x=${pipX}:y=${pipY}:shortest=1[withpip]`);
      afterOverlay = '[withpip]';
    }

    const scaleSuffix =
      dims.width !== baseW || dims.height !== baseH ? `,scale=${dims.width}:${dims.height}:flags=lanczos` : '';

    filterParts.push(`${afterOverlay}ass='${escapeFfmpegFilterPath(assPath)}'${scaleSuffix}[vout]`);

    args.push(
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[vout]',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '24',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-t',
      dur.toFixed(2),
      '-movflags',
      '+faststart',
      clipPath,
    );

    await execFileAsync('ffmpeg', args, { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });

    const actualClipDur = await probeMediaDuration(clipPath);
    const verifiedDur = actualClipDur > 0.5 ? actualClipDur : dur;
    clipPaths.push(clipPath);

    const subtitleLine = (scene.subtitle_text || scene.dialogue || scene.title).trim();
    const subSpan = Math.min(verifiedDur, Math.max(1.0, audioMeta.speechDurationSec));
    if (subtitleLine) {
      srtEntries.push({
        startSec: runningTime,
        endSec: runningTime + subSpan,
        text: subtitleLine,
      });
    }
    runningTime += verifiedDur;

    onStageProgress(
      'generating_visuals',
      58 + Math.round(((i + 1) / scenes.length) * 26),
      `Rendered scene ${i + 1}/${scenes.length}: ${scene.title} (${verifiedDur.toFixed(2)}s)`,
    );
  }

  if (isCancelled()) throw new Error('Job cancelled by user.');

  // Stage 4: Concatenate clips & write drift-free SRT
  onStageProgress('rendering', 88, 'Assembling final MP4 video and synchronized SRT subtitles...');
  const concatListPath = path.join(workDir, 'concat.txt');
  fs.writeFileSync(
    concatListPath,
    clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8',
  );

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputMp4Path,
    ],
    { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  );

  fs.writeFileSync(outputSrtPath, buildSrtContent(srtEntries), 'utf8');

  const verification = await verifyRenderedMp4(outputMp4Path);
  if (!verification.hasVideo || !verification.hasAudio || verification.durationSec <= 0) {
    throw new Error('Rendered MP4 failed integrity verification (missing video/audio stream).');
  }

  const stats = fs.statSync(outputMp4Path);
  const renderMode = anyRealLipSync
    ? 'external_lipsync_smartboard'
    : anyGenerativeVideo
      ? 'generative_lecturer_smartboard'
      : anyRealTts
        ? 'gemini_tts_smartboard'
        : 'local_deterministic_smartboard';

  onStageProgress('completed', 100, `Final MP4 ready (${verification.durationSec.toFixed(1)}s · ${verification.resolution})`);

  return {
    mp4Path: outputMp4Path,
    srtPath: outputSrtPath,
    durationSec: Number(verification.durationSec.toFixed(2)),
    resolution: verification.resolution,
    sizeBytes: stats.size,
    hasRealTts: anyRealTts,
    hasRealLipSync: anyRealLipSync,
    hasGenerativeVideo: anyGenerativeVideo,
    renderMode,
    sceneAudioOutputs: sceneAudioOutputs.map((s) => ({
      sceneId: s.sceneId,
      wavPath: s.wavPath,
      durationSec: s.durationSec,
      provider: s.provider,
    })),
  };
}
