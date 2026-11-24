import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  GeneratedSceneDraft,
  GeneratedScriptResult,
  ScriptGenerationInput,
  TTSRequest,
  TTSResult,
} from './types.ts';

const execFileAsync = promisify(execFile);

export function hasGeminiApiKey(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function probeMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { timeout: 10000 },
    );
    const parsed = Number.parseFloat(stdout.trim());
    return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0;
  } catch {
    return 0;
  }
}

export async function generateEducationalScript(
  input: ScriptGenerationInput,
): Promise<GeneratedScriptResult> {
  if (!hasGeminiApiKey()) {
    throw new Error(
      'AI script generation requires GEMINI_API_KEY in the server environment. Configure it in Settings > Secrets, or edit the storyboard manually in Mode A (Local).',
    );
  }

  const ai = getGeminiClient();
  const isArabic = input.language === 'ar';
  const sceneCount = Math.max(2, Math.min(6, Math.round(input.targetDurationSec / 8)));

  const sourceBlock = input.sourceMaterialText
    ? `\nUploaded Educational Source Material (${input.sourceFilename ?? 'document'}):\n"""\n${input.sourceMaterialText.slice(0, 14000)}\n"""\nPreserve source meaning strictly. In source_attribution, separate points directly grounded in the uploaded material from any AI-added pedagogical elaborations. Never fabricate citations.`
    : '\nNo external file uploaded. Generate an accurate, university-grade educational lesson from the topic. In source_attribution, clearly state that no uploaded file was attached and all points are instructor-reviewable AI drafts.';

  const prompt = `You are a senior academic instructional designer for Naba Academy (أكاديمية نبأ).
Create a structured educational video script for:
- Topic / Lesson: ${input.topic}
- Subject: ${input.subject}
- Education Level: ${input.educationLevel}
- Primary Language: ${isArabic ? 'Modern Standard Arabic (العربية الفصحى) with accurate English technical terms where appropriate' : 'Academic English'}
- Target Total Duration: approximately ${input.targetDurationSec} seconds across ${sceneCount} concise scenes.
${sourceBlock}

Requirements:
1. Keep dialogue natural, spoken-ready, accurate, and paced for the target duration.
2. For programming subjects (like C++, Python, JavaScript), include complete, syntactically valid, deterministic code in code_snippet (plain code only, no markdown fences).
3. For mathematics/physics/engineering, include clear equations in equation_latex.
4. Provide 2-3 concise bullet_points per scene for the deterministic smartboard overlay.
5. Make subtitle_text concise and faithful to the spoken dialogue.
6. Ensure scene durations sum close to ${input.targetDurationSec} seconds.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are Naba Academy instructional video architect. Output strictly valid JSON matching the schema. Prioritize factual accuracy and clear Arabic/English pedagogy.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          learning_objectives: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          key_concepts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          source_attribution: {
            type: Type.OBJECT,
            properties: {
              source_grounded_points: { type: Type.ARRAY, items: { type: Type.STRING } },
              ai_elaboration_points: { type: Type.ARRAY, items: { type: Type.STRING } },
              citation_note: { type: Type.STRING },
            },
          },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                scene_type: {
                  type: Type.STRING,
                  description: 'One of: intro, smartboard, code, equation, diagram, summary',
                },
                dialogue: { type: Type.STRING },
                visual_instructions: { type: Type.STRING },
                code_snippet: { type: Type.STRING },
                code_language: { type: Type.STRING },
                equation_latex: { type: Type.STRING },
                bullet_points: { type: Type.ARRAY, items: { type: Type.STRING } },
                subtitle_text: { type: Type.STRING },
                duration_sec: { type: Type.NUMBER },
              },
            },
          },
        },
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty script response.');
  }

  const parsed = JSON.parse(rawText) as {
    summary?: string;
    learning_objectives?: string[];
    key_concepts?: string[];
    source_attribution?: {
      source_grounded_points?: string[];
      ai_elaboration_points?: string[];
      citation_note?: string;
    };
    scenes?: Array<Partial<GeneratedSceneDraft>>;
  };

  const allowedTypes = new Set(['intro', 'smartboard', 'code', 'equation', 'diagram', 'summary']);
  const scenes: GeneratedSceneDraft[] = (parsed.scenes ?? []).map((s, idx) => ({
    title: s.title?.trim() || (isArabic ? `المشهد ${idx + 1}` : `Scene ${idx + 1}`),
    scene_type: (allowedTypes.has(s.scene_type ?? '') ? s.scene_type : 'smartboard') as GeneratedSceneDraft['scene_type'],
    dialogue: s.dialogue?.trim() || '',
    visual_instructions: s.visual_instructions?.trim() || '',
    code_snippet: (s.code_snippet ?? '').replace(/^```[\w+-]*\n?|\n?```$/g, '').trim(),
    code_language: s.code_language?.trim() || (input.subject.toLowerCase().includes('c++') ? 'cpp' : 'text'),
    equation_latex: s.equation_latex?.trim() || '',
    bullet_points: Array.isArray(s.bullet_points) ? s.bullet_points.filter(Boolean).slice(0, 5) : [],
    subtitle_text: s.subtitle_text?.trim() || s.dialogue?.trim() || '',
    duration_sec: Math.max(2.5, Math.min(45, Number(s.duration_sec) || 5)),
  }));

  if (scenes.length === 0) {
    throw new Error('Generated script did not contain any scenes.');
  }

  return {
    provider: 'gemini-4-hydrogen',
    usedLiveAI: true,
    summary: parsed.summary?.trim() || input.topic,
    learning_objectives: parsed.learning_objectives ?? [],
    key_concepts: parsed.key_concepts ?? [],
    source_attribution: {
      source_grounded_points: parsed.source_attribution?.source_grounded_points ?? [],
      ai_elaboration_points: parsed.source_attribution?.ai_elaboration_points ?? [],
      citation_note:
        parsed.source_attribution?.citation_note ??
        (isArabic
          ? 'مسودة تعليمية مولّدة بالذكاء الاصطناعي وتخضع لمراجعة واعتماد المحاضر.'
          : 'AI-generated instructional draft pending instructor accuracy review.'),
    },
    scenes,
  };
}

export async function synthesizeSpeechWithGemini(req: TTSRequest): Promise<TTSResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  const ai = new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  fs.mkdirSync(path.dirname(req.outputWavPath), { recursive: true });

  const callTts = async (includeSpeechMetadata: boolean) =>
    ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            includeSpeechMetadata
              ? ({
                  text: req.text,
                  speechMetadata: {
                    style: req.stylePrompt,
                  },
                } as unknown as { text: string })
              : {
                  text: req.text,
                },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: req.voiceId || 'Charon',
            },
          },
        },
      },
    });

  let response;
  try {
    response = await callTts(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('speechMetadata')) {
      response = await callTts(false);
    } else {
      throw err;
    }
  }

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Gemini TTS did not return audio data.');
  }

  const rawWavPath =
    Math.abs(req.speakingRate - 1.0) > 0.03
      ? req.outputWavPath.replace(/\.wav$/i, '.raw.wav')
      : req.outputWavPath;

  // Unary Gemini 3.8 TTS returns a complete RIFF WAV file (24kHz mono 16-bit).
  fs.writeFileSync(rawWavPath, Buffer.from(base64Audio, 'base64'));

  if (rawWavPath !== req.outputWavPath) {
    const safeRate = Math.max(0.7, Math.min(1.5, req.speakingRate));
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', rawWavPath, '-filter:a', `atempo=${safeRate.toFixed(2)}`, '-ar', '24000', '-ac', '1', req.outputWavPath],
      { timeout: 20000 },
    );
    fs.rmSync(rawWavPath, { force: true });
  }

  const durationSec = await probeMediaDuration(req.outputWavPath);
  return {
    provider: 'gemini-3.8-flash-lite-tts',
    isRealHumanSpeech: true,
    wavPath: req.outputWavPath,
    durationSec: durationSec || 4.0,
    note: 'Synthesized via Gemini 3.8 Flash Lite Neural TTS (24kHz WAV).',
  };
}

/**
 * Transparent Mode A offline/local fallback audio track when no cloud TTS key is configured.
 * Generates a gentle, low-volume academic presentation acoustic pulse bed so FFmpeg always
 * outputs a valid synchronized audio stream while explicitly reporting isRealHumanSpeech=false.
 */
export async function synthesizeLocalAcousticTrack(
  outputWavPath: string,
  durationSec: number,
  language: 'ar' | 'en',
  text?: string,
): Promise<TTSResult> {
  fs.mkdirSync(path.dirname(outputWavPath), { recursive: true });
  const safeDuration = Math.max(2.0, Math.min(60.0, durationSec || 5.0));

  // If English and ffmpeg libflite is compiled in, try real local offline speech via flite!
  if (language === 'en' && text && text.trim().length > 0) {
    const cleanText = text.replace(/[^a-zA-Z0-9 ,.!?\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (cleanText.length > 0) {
      try {
        await execFileAsync(
          'ffmpeg',
          [
            '-y',
            '-f',
            'lavfi',
            '-i',
            `flite=text='${cleanText.replace(/'/g, '')}':voice=slt`,
            '-ar',
            '24000',
            '-ac',
            '1',
            outputWavPath,
          ],
          { timeout: 15000 },
        );
        const dur = await probeMediaDuration(outputWavPath);
        if (dur > 0.5) {
          return {
            provider: 'ffmpeg-libflite-local',
            isRealHumanSpeech: true,
            wavPath: outputWavPath,
            durationSec: dur,
            note: 'Synthesized locally via FFmpeg libflite offline speech engine (zero-cost Mode A).',
          };
        }
      } catch {
        // Fall through cleanly to acoustic cadence track
      }
    }
  }

  // Generate clean soft studio chime + silent narration bed (honestly labeled as non-speech fallback)
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=0.18:sample_rate=24000`,
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=24000:cl=mono:d=${safeDuration.toFixed(2)}`,
      '-filter_complex',
      `[0:a]volume=0.08,afade=t=in:st=0:d=0.03,afade=t=out:st=0.08:d=0.10[chime];[chime][1:a]amix=inputs=2:duration=longest,atrim=0:${safeDuration.toFixed(2)}[out]`,
      '-map',
      '[out]',
      '-ar',
      '24000',
      '-ac',
      '1',
      outputWavPath,
    ],
    { timeout: 15000 },
  );

  const actualDuration = await probeMediaDuration(outputWavPath);
  return {
    provider: 'local-silent-cadence-fallback',
    isRealHumanSpeech: false,
    wavPath: outputWavPath,
    durationSec: actualDuration || safeDuration,
    note: 'Offline Mode A fallback audio track (configure GEMINI_API_KEY for live Arabic/English neural narration).',
  };
}
