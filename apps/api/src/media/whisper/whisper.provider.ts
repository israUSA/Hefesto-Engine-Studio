/**
 * `TranscriptionProvider` backed by the local whisper.cpp `whisper-cli.exe` (docs/13, adapter
 * 'whisper-cpp'). Runs word-level transcription in Spanish, using the GPU lock when the
 * downloaded build is CUDA-capable (rule #2: one GPU task at a time).
 */

import { mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  HealthResult,
  ProviderConfig,
  ProviderManifest,
  Usage,
  WordTiming,
} from '@hefesto/shared-types';
import type {
  CallContext,
  Provider,
  ProviderFactory,
  TranscribeInput,
  TranscribeResult,
  TranscriptionProvider,
} from '../../providers/contracts';
import { env, paths } from '../../config/env';
import { run } from '../process';
import { gpuLock } from '../gpu-lock';

/** True when the installed whisper-cli build links CUDA (its folder ships cudart/cublas DLLs). */
export function isCudaBuild(): boolean {
  const binDir = dirname(paths.bin('whisper-cli'));
  if (!existsSync(binDir)) return false;
  try {
    return readdirSync(binDir).some((f) => /cudart|cublas/i.test(f));
  } catch {
    return false;
  }
}

export function buildWhisperManifest(cuda: boolean): ProviderManifest {
  return {
    adapter: 'whisper-cpp',
    displayName: cuda ? 'whisper.cpp (CUDA local)' : 'whisper.cpp (CPU local)',
    capabilities: ['transcribe'],
    kind: 'local',
    resources: { lane: cuda ? 'gpu' : 'cpu' },
    license: { name: 'MIT', commercial: true, url: 'https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE' },
    secrets: [],
    features: { wordTimestamps: true, languages: ['es', 'en'] },
    pricing: { unit: 'request', usdPerUnit: 0 },
  };
}

// ── whisper-cli JSON shape (full JSON output, `-oj`/`-ojf`) ───────────────

interface WhisperToken {
  text: string;
  timestamps: { from: string; to: string };
  offsets: { from: number; to: number };
  /** Present with `-ojf` (word-level, sub-word tokens merged into words by whisper-cli itself). */
  t_dtw?: number;
  p?: number;
}

interface WhisperSegment {
  text: string;
  offsets: { from: number; to: number };
  tokens?: WhisperToken[];
}

interface WhisperJsonOutput {
  transcription: WhisperSegment[];
}

/** Whisper tokens include leading spaces/punctuation-only fragments; merges them into words
 * and drops the special `[_TT_xxx]`/`[_BEG_]` control tokens whisper.cpp sometimes emits. */
function tokensToWords(segments: WhisperSegment[]): WordTiming[] {
  const words: WordTiming[] = [];
  for (const seg of segments) {
    if (!seg.tokens) continue;
    for (const tok of seg.tokens) {
      const text = tok.text.trim();
      if (!text || /^\[_[A-Z]+_?\d*\]$/.test(text)) continue;
      // whisper.cpp starts a new word with a token whose raw text has a leading space,
      // and continues the previous word otherwise (sub-word BPE pieces).
      const startsNewWord = /^\s/.test(tok.text) || words.length === 0;
      if (startsNewWord) {
        words.push({
          word: text,
          startMs: tok.offsets.from,
          endMs: tok.offsets.to,
          confidence: tok.p,
        });
      } else {
        const last = words[words.length - 1];
        last.word += text;
        last.endMs = tok.offsets.to;
        if (tok.p !== undefined) {
          last.confidence = last.confidence !== undefined ? (last.confidence + tok.p) / 2 : tok.p;
        }
      }
    }
  }
  return words;
}

export class WhisperCppProvider implements Provider, TranscriptionProvider {
  readonly manifest: ProviderManifest;

  constructor(
    readonly config: ProviderConfig,
    private readonly cuda: boolean,
  ) {
    this.manifest = buildWhisperManifest(cuda);
  }

  async healthCheck(): Promise<HealthResult> {
    const exe = paths.bin('whisper-cli');
    const modelPath = paths.model(env.whisperModel);
    if (!existsSync(exe)) return { ok: false, message: `whisper-cli not found at ${exe}. Run tools/fetch-binaries.ts.` };
    if (!existsSync(modelPath)) return { ok: false, message: `Model not found at ${modelPath}. Run tools/fetch-binaries.ts --model <name>.` };
    return { ok: true, message: 'whisper-cli and model present.' };
  }

  async transcribe(input: TranscribeInput, ctx: CallContext): Promise<TranscribeResult> {
    const started = Date.now();
    const exe = paths.bin('whisper-cli');
    const modelPath = paths.model(env.whisperModel);
    if (!existsSync(exe)) throw new Error(`whisper-cli not found at ${exe}. Run tools/fetch-binaries.ts.`);
    if (!existsSync(modelPath)) throw new Error(`Whisper model not found at ${modelPath}. Run tools/fetch-binaries.ts --model <name>.`);

    const workDir = join(tmpdir(), 'hefesto-whisper', randomUUID());
    mkdirSync(workDir, { recursive: true });
    const wavPath = join(workDir, 'audio-16k.wav');
    const outputBase = join(workDir, 'out');

    // whisper.cpp expects 16kHz mono WAV.
    await normalizeAudioTo16k(input.audioPath, wavPath, ctx.signal);

    const args = [
      '-m',
      modelPath,
      '-f',
      wavPath,
      '-l',
      input.language || 'es',
      '-ojf', // full JSON output: includes the per-token `tokens[]` array with ms offsets
      '-of',
      outputBase,
      '-nt', // no timestamps printed to stdout, keep the console quiet
    ];
    if (input.prompt) args.push('--prompt', input.prompt);

    const runTranscription = () =>
      run(exe, args, {
        signal: ctx.signal,
        timeoutMs: 10 * 60_000,
      });

    if (this.cuda) {
      await gpuLock.withLock(runTranscription);
    } else {
      await runTranscription();
    }

    const jsonPath = `${outputBase}.json`;
    const raw = readFileSync(jsonPath, 'utf8');
    const parsed: WhisperJsonOutput = JSON.parse(raw);
    const words = tokensToWords(parsed.transcription);
    const text = parsed.transcription.map((s) => s.text).join(' ').trim();

    const usage: Usage = { units: 1, unit: 'request', costUsd: 0, durationMs: Date.now() - started };
    return { text, words, usage };
  }
}

async function normalizeAudioTo16k(inPath: string, outPath: string, signal?: AbortSignal): Promise<void> {
  // whisper.cpp needs 16 kHz mono; plain resampling, no loudness normalization (we want the
  // raw levels for accurate ASR, not broadcast loudness — that's applied to the final voice track).
  mkdirSync(dirname(outPath), { recursive: true });
  await run(paths.bin('ffmpeg'), ['-y', '-hide_banner', '-i', inPath, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', outPath], {
    signal,
    timeoutMs: 2 * 60_000,
  });
}

export const whisperCppFactory: ProviderFactory = {
  manifest: buildWhisperManifest(isCudaBuild()),
  create(config: ProviderConfig): Provider {
    return new WhisperCppProvider(config, isCudaBuild());
  },
};
