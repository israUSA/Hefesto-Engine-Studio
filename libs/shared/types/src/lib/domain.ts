/**
 * Domain models shared by the API and the UI.
 * See docs/03-modelo-de-datos.md.
 */

export type Platform = 'tiktok' | 'youtube';
export type VideoFormat = '9:16' | '16:9';

export interface Channel {
  id: string;
  name: string;
  slug: string;
  platform: Platform;
  handle: string;
  language: string;
  format: VideoFormat;
  topic: string;
  /** "Biblia del canal": tone, audience, do's and don'ts, examples. */
  bible: string;
  bibleTranslation?: string;
  durationTarget: { min: number; max: number };
  aiLabel: boolean;
  monetized: boolean;
  active: boolean;
  voice: VoiceProfile;
  visualStyle: VisualStyle;
}

export interface VoiceProfile {
  /** ProviderConfig id; null = global binding. */
  providerConfigId?: string;
  voiceId: string;
  language: string;
  stylePrompt?: string;
  speed?: number;
  pauseBeforeAmenMs?: number;
  params?: Record<string, unknown>;
}

export type VisualSource = 'stock' | 'ai-image' | 'ai-video' | 'mixed';
export type Motion = 'kenburns' | 'parallax' | 'static';

export interface VisualStyle {
  source: VisualSource;
  basePrompt?: string;
  negativePrompt?: string;
  motion: Motion;
  transition?: string;
}

export interface VerseRef {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
}

export interface SceneDraft {
  text: string;
  visualPrompt: string;
  /** Short search terms for stock providers. */
  keywords: string[];
}

export interface PlatformMetadata {
  title: string;
  description: string;
  hashtags: string[];
}

/** Structured script returned by the text provider (validated with zod in the API). */
export interface ScriptDraft {
  hook: string;
  body: string;
  cta: string;
  scenes: SceneDraft[];
  /** References only. Verse text always comes from the local Bible (ADR-009). */
  verseRefs: VerseRef[];
  metadata: Partial<Record<Platform, PlatformMetadata>>;
}

export type ProductionStage =
  | 'scripted'
  | 'voiced'
  | 'transcribed'
  | 'visuals_ready'
  | 'rendered'
  | 'qa_passed'
  | 'qa_failed'
  | 'archived'
  | 'scheduled'
  | 'published';

export type RunStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled';

/** Word-level timing, same shape regardless of the transcription provider. */
export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface CostEntry {
  id: string;
  productionId?: string;
  channelId: string;
  providerConfigId: string;
  operation: string;
  units: number;
  costUsd: number;
  durationMs: number;
  createdAt: string;
}
