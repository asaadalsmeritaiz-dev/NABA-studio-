import type { OperatingMode, ProviderCapability, SceneType, SourceAttribution } from '../../src/types/studio.ts';

export interface ScriptGenerationInput {
  topic: string;
  subject: string;
  educationLevel: string;
  language: 'ar' | 'en';
  targetDurationSec: number;
  sourceMaterialText?: string;
  sourceFilename?: string;
}

export interface GeneratedSceneDraft {
  title: string;
  scene_type: SceneType;
  dialogue: string;
  visual_instructions: string;
  code_snippet: string;
  code_language: string;
  equation_latex: string;
  bullet_points: string[];
  subtitle_text: string;
  duration_sec: number;
}

export interface GeneratedScriptResult {
  provider: string;
  usedLiveAI: boolean;
  summary: string;
  learning_objectives: string[];
  key_concepts: string[];
  source_attribution: SourceAttribution;
  scenes: GeneratedSceneDraft[];
}

export interface TTSRequest {
  text: string;
  language: 'ar' | 'en';
  voiceId: string;
  stylePrompt: string;
  speakingRate: number;
  outputWavPath: string;
}

export interface TTSResult {
  provider: string;
  isRealHumanSpeech: boolean;
  wavPath: string;
  durationSec: number;
  note: string;
}

export interface LipSyncRequest {
  lecturerImagePath: string;
  audioWavPath: string;
  outputVideoPath: string;
}

export interface LipSyncResult {
  supported: boolean;
  provider: string;
  videoPath?: string;
  reason: string;
}

export interface VideoGenAdapter {
  key: string;
  displayName: string;
  executionMode: OperatingMode;
  isConfigured(): boolean;
  getCapability(): ProviderCapability;
}
