/**
 * Thin FFmpeg/ffprobe helpers shared by the pipeline stages: probing media, normalizing audio
 * (48 kHz mono WAV, loudness-normalized), concatenating voice fragments and measuring loudness
 * for QA (docs/04 §7).
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../config/env';
import { run } from './process';

export interface ProbeStream {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}

export interface ProbeResult {
  durationMs: number;
  streams: ProbeStream[];
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
}

function parseFrameRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [num, den] = rate.split('/').map(Number);
  if (!den) return num;
  return num / den;
}

/** Runs ffprobe and returns duration, streams and a few convenience fields. `run()` only
 * surfaces stderr (it's built around ffmpeg's progress/log stream), so ffprobe's stdout JSON is
 * captured with a small dedicated spawn here instead of going through it. */
export async function probe(filePath: string): Promise<ProbeResult> {
  const ffprobe = paths.bin('ffprobe');
  return runProbeCapture(ffprobe, filePath);
}

function runProbeCapture(ffprobe: string, filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-2000)}`));
        return;
      }
      try {
        const json = JSON.parse(stdout);
        const streams: ProbeStream[] = json.streams ?? [];
        const videoStream = streams.find((s) => s.codec_type === 'video');
        const audioStream = streams.find((s) => s.codec_type === 'audio');
        const formatDuration = Number(json.format?.duration ?? 0);
        resolve({
          durationMs: Math.round(formatDuration * 1000),
          streams,
          hasVideo: !!videoStream,
          hasAudio: !!audioStream,
          width: videoStream?.width,
          height: videoStream?.height,
          fps: parseFrameRate(videoStream?.r_frame_rate),
        });
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${(err as Error).message}`));
      }
    });
  });
}

export interface NormalizeAudioOptions {
  /** Trims silences longer than this from the input (docs/04 §3: "recortar silencios largos"). */
  trimSilence?: boolean;
  /** Target integrated loudness in LUFS. Default -14 (docs/04 §7). */
  targetLufs?: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/** Converts any input audio to WAV 48 kHz mono 16-bit, with optional silence trimming and
 * one-pass loudnorm to the target LUFS (two-pass loudnorm is a Fase 2+ refinement). */
export async function normalizeAudio(inPath: string, outPath: string, options: NormalizeAudioOptions = {}): Promise<void> {
  const ffmpeg = paths.bin('ffmpeg');
  mkdirSync(dirname(outPath), { recursive: true });
  const targetLufs = options.targetLufs ?? -14;

  const filters: string[] = [];
  if (options.trimSilence) {
    // Strip silences longer than 1.2s from the middle (docs/04 §7 QA threshold), and any
    // leading/trailing silence, without cutting into speech.
    filters.push(
      'silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB:' +
        'stop_periods=-1:stop_duration=1.2:stop_threshold=-45dB',
    );
  }
  filters.push(`loudnorm=I=${targetLufs}:TP=-1:LRA=11`);

  await run(
    ffmpeg,
    [
      '-y',
      '-hide_banner',
      '-i',
      inPath,
      '-af',
      filters.join(','),
      '-ar',
      '48000',
      '-ac',
      '1',
      '-sample_fmt',
      's16',
      '-progress',
      'pipe:1',
      outPath,
    ],
    { signal: options.signal, onProgress: options.onProgress, timeoutMs: 5 * 60_000 },
  );
}

export interface ConcatAudioOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/** Concatenates WAV fragments with silence gaps between them (e.g. a pause before "Amén"). */
export async function concatAudio(parts: string[], gapsMs: number[], outPath: string, options: ConcatAudioOptions = {}): Promise<void> {
  if (parts.length === 0) throw new Error('concatAudio: no parts given.');
  if (gapsMs.length !== parts.length - 1) {
    throw new Error(`concatAudio: expected ${parts.length - 1} gaps for ${parts.length} parts, got ${gapsMs.length}.`);
  }
  const ffmpeg = paths.bin('ffmpeg');
  mkdirSync(dirname(outPath), { recursive: true });

  const inputArgs: string[] = [];
  parts.forEach((p) => inputArgs.push('-i', p));

  // Build a filter_complex that interleaves each part with a generated silence of the right gap,
  // then concatenates everything into one mono 48kHz stream.
  const labels: string[] = [];
  const filterParts: string[] = [];
  parts.forEach((_, i) => {
    filterParts.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=mono[a${i}]`);
    labels.push(`[a${i}]`);
    if (i < gapsMs.length) {
      const gapLabel = `sil${i}`;
      const durationSec = Math.max(0, gapsMs[i]) / 1000;
      filterParts.push(`aevalsrc=0:d=${durationSec.toFixed(3)}:s=48000[${gapLabel}]`);
      labels.push(`[${gapLabel}]`);
    }
  });
  const concatFilter = `${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`;
  const filterComplex = [...filterParts, concatFilter].join(';');

  await run(
    ffmpeg,
    ['-y', '-hide_banner', ...inputArgs, '-filter_complex', filterComplex, '-map', '[out]', '-ar', '48000', '-ac', '1', '-progress', 'pipe:1', outPath],
    { signal: options.signal, onProgress: options.onProgress, timeoutMs: 5 * 60_000 },
  );
}

/** Runs ffmpeg's `ebur128` filter and parses the integrated loudness (LUFS) for QA. */
export async function measureLoudness(filePath: string): Promise<{ integratedLufs: number; truePeakDb?: number }> {
  const ffmpeg = paths.bin('ffmpeg');
  const lines: string[] = [];
  await run(ffmpeg, ['-hide_banner', '-nostats', '-i', filePath, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {
    onLog: (line) => lines.push(line),
    timeoutMs: 60_000,
  }).catch((err) => {
    // ebur128 always exits 0 on a valid file; if this throws, surface the real ffmpeg error.
    throw err;
  });

  const text = lines.join('\n');
  const integratedMatch = text.match(/Integrated loudness:\s*\n\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
  const peakMatch = text.match(/Peak:\s*\n\s*Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);
  if (!integratedMatch) {
    throw new Error(`Could not parse integrated loudness from ffmpeg ebur128 output:\n${text.slice(-1000)}`);
  }
  return {
    integratedLufs: Number(integratedMatch[1]),
    truePeakDb: peakMatch ? Number(peakMatch[1]) : undefined,
  };
}
