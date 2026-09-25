/**
 * Renders the final 9:16 (or 16:9) short: Ken Burns over images, trimmed/looped video scenes,
 * burned-in ASS subtitles, music ducked under the voice, optional watermark. Docs/04 §6.
 *
 * The ffmpeg filter graph is built by a pure function (`buildFilterGraph`) so it can be unit
 * tested without spawning ffmpeg; `renderShort` wires it to the real encoder/process/GPU lock.
 */

import { mkdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { env, paths } from '../config/env';
import { detectEncoder } from './encoder';
import { gpuLock } from './gpu-lock';
import { makeFfmpegProgressParser, run } from './process';
import { probe } from './ffmpeg';

export type SceneKind = 'image' | 'video';

export interface Scene {
  path: string;
  kind: SceneKind;
  startMs: number;
  endMs: number;
}

export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface Watermark {
  path: string;
  position?: WatermarkPosition;
  opacity?: number;
  marginPx?: number;
}

export interface RenderInput {
  scenes: Scene[];
  voicePath: string;
  /** Path to a `.ass` file. Passed to ffmpeg's `ass` filter (relative + matching cwd avoids
   * Windows path-escaping headaches with `:` and `\`). */
  subsPath?: string;
  musicPath?: string;
  /** 0..1, applied before ducking. Default 0.25. */
  musicVolume?: number;
  watermark?: Watermark;
  format: '9:16' | '16:9';
  outPath: string;
  fps?: number;
}

export interface RenderCallbacks {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const FORMAT_DIMENSIONS: Record<RenderInput['format'], { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};

export interface FilterGraphResult {
  /** ffmpeg args for every `-i` input, in the same order as `inputPaths`. */
  inputArgs: string[];
  /** Paths for every input, same order/count as the `-i` occurrences in `inputArgs`. */
  inputPaths: string[];
  filterComplex: string;
  /** Final video label to `-map`, e.g. "[vout]". */
  videoLabel: string;
  /** Final audio label to `-map`, e.g. "[aout]". */
  audioLabel: string;
}

function sceneDurationSec(scene: Scene): number {
  return Math.max(0.05, (scene.endMs - scene.startMs) / 1000);
}

function watermarkOverlayPosition(position: WatermarkPosition, marginPx: number): string {
  switch (position) {
    case 'top-left':
      return `${marginPx}:${marginPx}`;
    case 'top-right':
      return `W-w-${marginPx}:${marginPx}`;
    case 'bottom-left':
      return `${marginPx}:H-h-${marginPx}`;
    case 'bottom-right':
    default:
      return `W-w-${marginPx}:H-h-${marginPx}`;
  }
}

/**
 * Builds the full ffmpeg input list + `-filter_complex` graph. Pure and side-effect free so it
 * can be unit tested without ffmpeg installed.
 */
export function buildFilterGraph(input: RenderInput, fps: number, fontsDir?: string): FilterGraphResult {
  if (input.scenes.length === 0) throw new Error('buildFilterGraph: at least one scene is required.');
  const { width: W, height: H } = FORMAT_DIMENSIONS[input.format];

  const inputArgs: string[] = [];
  const inputPaths: string[] = [];
  const sceneLabels: string[] = [];
  const filters: string[] = [];

  input.scenes.forEach((scene, i) => {
    const durationSec = sceneDurationSec(scene);
    const label = `v${i}`;
    if (scene.kind === 'image') {
      // A single still frame: zoompan emits `d` frames per input frame, so looping the
      // image would multiply the scene length.
      inputArgs.push('-i', scene.path);
      inputPaths.push(scene.path);
      // Ken Burns: pre-scale 15% larger than target so the pan/zoom never reveals empty edges,
      // then zoompan crops back down to WxH. Alternate zoom-in/zoom-out by scene index.
      const overW = Math.round(W * 1.15);
      const overH = Math.round(H * 1.15);
      const frames = Math.max(1, Math.round(durationSec * fps));
      const zoomingIn = i % 2 === 0;
      const zoomExpr = zoomingIn ? "min(zoom+0.0012,1.15)" : "if(eq(on,1),1.15,max(zoom-0.0012,1.0))";
      filters.push(
        `[${i}:v]scale=${overW}:${overH}:force_original_aspect_ratio=increase,` +
          `crop=${overW}:${overH},` +
          `zoompan=z='${zoomExpr}':d=${frames}:s=${W}x${H}:fps=${fps},` +
          `setsar=1[${label}]`,
      );
    } else {
      // Loop short clips so they always cover their scene duration; trim exactly to it.
      inputArgs.push('-stream_loop', '-1', '-t', durationSec.toFixed(3), '-i', scene.path);
      inputPaths.push(scene.path);
      filters.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
          `crop=${W}:${H},setpts=PTS-STARTPTS,fps=${fps},setsar=1[${label}]`,
      );
    }
    sceneLabels.push(`[${label}]`);
  });

  // Plain concat (no xfade): guarantees the visual timeline matches the voice timeline exactly,
  // which docs/04 §6 calls out as the priority over transition polish.
  filters.push(`${sceneLabels.join('')}concat=n=${sceneLabels.length}:v=1:a=0[vconcat]`);
  let videoLabel = '[vconcat]';

  const nextInputIndex = () => inputPaths.length;

  if (input.subsPath) {
    // `ass` filter reads the file itself; the caller runs ffmpeg with cwd set to the file's
    // directory and passes a bare filename to sidestep Windows `:`/`\` escaping in filter args.
    // `fontsdir` lets libass find data/fonts/*.ttf (Archivo Black) without installing them. A
    // drive-letter path (e.g. "C:/Users/...") breaks ffmpeg's filter-option parsing (":" is the
    // option separator even inside quotes), so callers should pass a path RELATIVE to `cwd`
    // whenever ffmpeg is run with one (see renderShort's cwd trick for the same reason on subsPath).
    const subsArg = escapeFilterPath(input.subsPath);
    const fontsDirArg = escapeFilterPath(fontsDir ?? join(env.dataDir, 'fonts'));
    filters.push(`${videoLabel}ass='${subsArg}':fontsdir='${fontsDirArg}'[vsubbed]`);
    videoLabel = '[vsubbed]';
  }

  let watermarkInputIndex: number | undefined;
  if (input.watermark) {
    watermarkInputIndex = nextInputIndex();
    inputArgs.push('-i', input.watermark.path);
    inputPaths.push(input.watermark.path);
    const opacity = input.watermark.opacity ?? 1;
    const margin = input.watermark.marginPx ?? 24;
    const position = input.watermark.position ?? 'bottom-right';
    if (opacity < 1) {
      filters.push(`[${watermarkInputIndex}:v]format=rgba,colorchannelmixer=aa=${opacity}[wm]`);
    } else {
      filters.push(`[${watermarkInputIndex}:v]format=rgba[wm]`);
    }
    filters.push(`${videoLabel}[wm]overlay=${watermarkOverlayPosition(position, margin)}[vout]`);
    videoLabel = '[vout]';
  } else {
    filters.push(`${videoLabel}null[vout]`);
    videoLabel = '[vout]';
  }

  // Audio: voice is always input index = scenes.length (added by the caller as `-i voicePath`).
  const voiceIndex = input.scenes.length;
  inputArgs.push('-i', input.voicePath);
  inputPaths.push(input.voicePath);

  // Always route audio through an explicit filter label (even with no music) so `-map` only
  // ever deals with filter-graph output pads, never a mix of raw stream specifiers and labels.
  filters.push(`[${voiceIndex}:a]anull[voiceOut]`);
  let audioLabel = '[voiceOut]';
  if (input.musicPath) {
    const musicIndex = nextInputIndex();
    inputArgs.push('-i', input.musicPath);
    inputPaths.push(input.musicPath);
    const volume = input.musicVolume ?? 0.25;
    filters.push(`[${musicIndex}:a]volume=${volume}[musicVol]`);
    // Duck the music under the voice (sidechaincompress: main=music, sidechain=voice).
    filters.push(`[musicVol][${voiceIndex}:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[musicDucked]`);
    filters.push(`[musicDucked][${voiceIndex}:a]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
    audioLabel = '[aout]';
  }

  return { inputArgs, inputPaths, filterComplex: filters.join(';'), videoLabel, audioLabel };
}

/** Escapes a path for use inside a `'...'`-quoted ffmpeg filter argument (still needed even for
 * relative filenames if they ever contain a quote or backslash). */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/'/g, "\\'");
}

export interface RenderResult {
  outPath: string;
  encoder: string;
  durationMs: number;
  renderTimeMs: number;
}

export async function renderShort(input: RenderInput, callbacks: RenderCallbacks = {}): Promise<RenderResult> {
  const started = Date.now();
  const fps = input.fps ?? 30;
  const { width, height } = FORMAT_DIMENSIONS[input.format];
  mkdirSync(dirname(input.outPath), { recursive: true });

  // Run ffmpeg with cwd = the subs file's directory so a bare relative filename can be passed to
  // the `ass` filter (Windows path escaping for `:`/`\` inside filter args is otherwise painful).
  const cwd = input.subsPath ? dirname(input.subsPath) : undefined;
  const graphInput: RenderInput = input.subsPath ? { ...input, subsPath: basename(input.subsPath) } : input;
  // Scene/watermark/voice/music paths must be resolved relative to that cwd too, if we changed it.
  const resolvedInput = cwd ? relativizePaths(graphInput, cwd) : graphInput;

  const fontsDir = join(env.dataDir, 'fonts');
  const fontsDirForGraph = cwd ? relative(cwd, fontsDir).replace(/\\/g, '/') : fontsDir;
  const graph = buildFilterGraph(resolvedInput, fps, fontsDirForGraph);
  const encoderInfo = await detectEncoder();

  const totalDurationMs = input.scenes.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  const progressParser = makeFfmpegProgressParser(totalDurationMs);

  const args = [
    '-y',
    '-hide_banner',
    ...graph.inputArgs,
    '-filter_complex',
    graph.filterComplex,
    '-map',
    graph.videoLabel,
    '-map',
    graph.audioLabel,
    ...encoderInfo.args,
    '-r',
    String(fps),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-t',
    (totalDurationMs / 1000).toFixed(3),
    '-progress',
    'pipe:1',
    cwd ? basename(input.outPath) : input.outPath,
  ];
  // If cwd changed, the output must be written relative to it too (or use an absolute path,
  // which also works fine with ffmpeg regardless of cwd).
  if (cwd) args[args.length - 1] = input.outPath;

  const doRender = () =>
    run(paths.bin('ffmpeg'), args, {
      cwd,
      signal: callbacks.signal,
      onProgress: callbacks.onProgress,
      parseProgress: progressParser,
      timeoutMs: 30 * 60_000,
    });

  if (encoderInfo.usesGpu) {
    await gpuLock.withLock(doRender);
  } else {
    await doRender();
  }

  return {
    outPath: input.outPath,
    encoder: encoderInfo.name,
    durationMs: totalDurationMs,
    renderTimeMs: Date.now() - started,
  };
}

/** Rewrites every path in a RenderInput to be relative to `cwd`, for the ffmpeg-cwd-trick above. */
function relativizePaths(input: RenderInput, cwd: string): RenderInput {
  const rel = (p: string) => relative(cwd, p).replace(/\\/g, '/');
  return {
    ...input,
    scenes: input.scenes.map((s) => ({ ...s, path: rel(s.path) })),
    voicePath: rel(input.voicePath),
    musicPath: input.musicPath ? rel(input.musicPath) : undefined,
    watermark: input.watermark ? { ...input.watermark, path: rel(input.watermark.path) } : undefined,
  };
}

export interface ThumbnailOptions {
  signal?: AbortSignal;
}

/** Extracts a single frame at `atMs` as a JPEG thumbnail. */
export async function makeThumbnail(videoPath: string, outPath: string, atMs: number, options: ThumbnailOptions = {}): Promise<string> {
  mkdirSync(dirname(outPath), { recursive: true });
  const info = await probe(videoPath);
  const safeMs = Math.min(Math.max(0, atMs), Math.max(0, info.durationMs - 50));
  await run(
    paths.bin('ffmpeg'),
    ['-y', '-hide_banner', '-ss', (safeMs / 1000).toFixed(3), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath],
    { signal: options.signal, timeoutMs: 30_000 },
  );
  return outPath;
}
