/**
 * Detects the best available H.264 encoder (NVENC > QSV > AMF > libx264) by running a tiny
 * 1-frame test encode, and returns the ffmpeg args + GPU-lock flag for each. Result is cached
 * for the process lifetime (or forced via env.encoder).
 */

import { env, paths } from '../config/env';
import { run } from './process';

export type EncoderName = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264';

export interface EncoderInfo {
  name: EncoderName;
  /** Extra ffmpeg output args (before `-c:v <name>` is already included). */
  args: string[];
  /** True if the encoder needs the GPU lock (NVENC/QSV/AMF share limited hardware resources). */
  usesGpu: boolean;
}

const ENCODER_ARGS: Record<EncoderName, string[]> = {
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', '10M', '-maxrate', '12M'],
  h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '22'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'vbr_peak', '-qp_i', '21', '-qp_p', '23', '-b:v', '10M', '-maxrate', '12M'],
  libx264: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'],
};

const USES_GPU: Record<EncoderName, boolean> = {
  h264_nvenc: true,
  h264_qsv: true,
  h264_amf: true,
  libx264: false,
};

const PROBE_ORDER: EncoderName[] = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];

let cached: EncoderInfo | undefined;

function toEncoderInfo(name: EncoderName): EncoderInfo {
  return { name, args: ENCODER_ARGS[name], usesGpu: USES_GPU[name] };
}

/** Runs a throwaway 1-frame encode to see if the encoder actually works on this machine
 * (installed but non-functional hardware encoders are common: no driver, wrong GPU, etc.). */
async function probeEncoder(name: EncoderName): Promise<boolean> {
  const ffmpeg = paths.bin('ffmpeg');
  try {
    await run(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x64:d=0.1',
        '-frames:v',
        '1',
        ...ENCODER_ARGS[name],
        '-f',
        'null',
        '-',
      ],
      { timeoutMs: 15_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Detects and caches the encoder to use. Pass `force: true` to bypass the cache (tests). */
export async function detectEncoder(force = false): Promise<EncoderInfo> {
  if (!force && cached) return cached;

  if (env.encoder !== 'auto') {
    const forced = env.encoder as EncoderName;
    if (!(forced in ENCODER_ARGS)) {
      throw new Error(`Unknown HEFESTO_ENCODER "${env.encoder}". Expected one of: ${PROBE_ORDER.join(', ')}, auto.`);
    }
    cached = toEncoderInfo(forced);
    return cached;
  }

  for (const candidate of PROBE_ORDER) {
    if (candidate === 'libx264') {
      cached = toEncoderInfo(candidate);
      return cached;
    }
    if (await probeEncoder(candidate)) {
      cached = toEncoderInfo(candidate);
      return cached;
    }
  }

  // Unreachable: libx264 is always in PROBE_ORDER and always returns true above.
  cached = toEncoderInfo('libx264');
  return cached;
}

/** Clears the cached encoder choice (tests only). */
export function resetEncoderCache(): void {
  cached = undefined;
}
