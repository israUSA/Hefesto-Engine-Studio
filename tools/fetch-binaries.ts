/**
 * Downloads the local binaries Hefesto needs (FFmpeg, whisper.cpp, a whisper model and a
 * subtitle font) from their OFFICIAL sources. Everything lands in `bin/` (gitignored) and
 * `data/fonts/` (checked in).
 *
 * Run with:
 *   npx ts-node --transpile-only tools/fetch-binaries.ts [--model <name>] [--force] [--skip-ffmpeg] [--skip-whisper] [--skip-model] [--skip-fonts]
 *
 * `--model` accepts a short alias (tiny, base, small, medium, large-v3-turbo-q5_0, ...) or a
 * full ggml file name. Default: ggml-large-v3-turbo-q5_0.bin (fits a 4 GB VRAM card).
 * On a CPU-only dev machine pass `--model small` or `--model base` instead.
 *
 * Sources (official only):
 *   - FFmpeg:      https://github.com/BtbN/FFmpeg-Builds (GitHub releases)
 *   - whisper.cpp: https://github.com/ggml-org/whisper.cpp (GitHub releases, CI "b*" builds)
 *   - models:      https://huggingface.co/ggerganov/whisper.cpp (official ggml conversions)
 *   - font:        https://github.com/google/fonts (OFL), Archivo Black
 */

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const REPO_ROOT = resolveRepoRoot();
const BIN_DIR = join(REPO_ROOT, 'bin');
const MODELS_DIR = join(BIN_DIR, 'models');
const FONTS_DIR = join(REPO_ROOT, 'data', 'fonts');

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'hefesto-fetch-binaries';

interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface GhRelease {
  tag_name: string;
  published_at: string;
  assets: GhAsset[];
}

function resolveRepoRoot(): string {
  // tools/fetch-binaries.ts -> repo root is one level up.
  return join(__dirname, '..');
}

function parseArgs(argv: string[]) {
  const args = {
    model: 'large-v3-turbo-q5_0',
    force: false,
    skip: new Set<string>(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') args.model = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--skip-ffmpeg') args.skip.add('ffmpeg');
    else if (a === '--skip-whisper') args.skip.add('whisper');
    else if (a === '--skip-model') args.skip.add('model');
    else if (a === '--skip-fonts') args.skip.add('fonts');
  }
  return args;
}

function log(msg: string) {
  console.log(`[fetch-binaries] ${msg}`);
}

async function ghJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub API ${url} -> ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Downloads a URL to a file with a simple progress bar. Resumable is not needed here (small dev tool). */
async function downloadFile(url: string, destPath: string, label: string): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed ${url} -> ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  let lastPct = -1;
  const out = createWriteStream(destPath);
  const nodeStream = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream);
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (total > 0) {
      const pct = Math.floor((received / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        process.stdout.write(`\r[fetch-binaries] ${label}: ${pct}% (${(received / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB)`);
      }
    }
  });
  nodeStream.pipe(out);
  await finished(out);
  if (total > 0) process.stdout.write('\n');
  log(`${label}: downloaded ${(received / 1e6).toFixed(1)} MB -> ${destPath}`);
}

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

function extractZip(zipPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    const psCmd = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`Expand-Archive failed for ${zipPath}`);
  } else {
    const r = spawnSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`tar -xf failed for ${zipPath}`);
  }
}

/** Finds a file recursively inside a directory by exact base name (case-insensitive). */
function findFile(root: string, name: string): string | null {
  const stack = [root];
  const lowerName = name.toLowerCase();
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === lowerName) return full;
    }
  }
  return null;
}

function findFiles(root: string, predicate: (name: string) => boolean): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (predicate(entry.name)) out.push(full);
    }
  }
  return out;
}

function detectNvidiaGpu(): boolean {
  const r = spawnSync('nvidia-smi', [], { stdio: 'ignore' });
  return r.status === 0;
}

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'hefesto-fetch-'));
  try {
    return await fn(dir);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  }
}

// ── FFmpeg ──────────────────────────────────────────────────────────────

async function fetchFfmpeg(force: boolean): Promise<void> {
  const ffmpegExe = join(BIN_DIR, 'ffmpeg.exe');
  const ffprobeExe = join(BIN_DIR, 'ffprobe.exe');
  if (!force && existsSync(ffmpegExe) && existsSync(ffprobeExe)) {
    log('ffmpeg/ffprobe already present, skipping (use --force to redownload).');
    return;
  }
  log('Fetching FFmpeg release info from BtbN/FFmpeg-Builds...');
  const release = await ghJson<GhRelease>(`${GITHUB_API}/repos/BtbN/FFmpeg-Builds/releases/latest`);

  // Prefer a numbered, static (non-shared) GPL win64 build: it bundles libx264/libass (GPL) plus
  // nvenc/qsv/amf, and being a single static exe avoids DLL juggling. Fall back to the rolling
  // "master-latest" build if no numbered build is published.
  const numbered = release.assets
    .filter((a) => /^ffmpeg-n[\d.]+-latest-win64-gpl-[\d.]+\.zip$/.test(a.name))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  const asset = numbered[0] ?? release.assets.find((a) => a.name === 'ffmpeg-master-latest-win64-gpl.zip');
  if (!asset) throw new Error('Could not find a win64 GPL FFmpeg build in the latest release.');

  const checksumsAsset = release.assets.find((a) => a.name === 'checksums.sha256');

  await withTmpDir(async (tmp) => {
    const zipPath = join(tmp, asset.name);
    await downloadFile(asset.browser_download_url, zipPath, `FFmpeg (${asset.name})`);

    if (checksumsAsset) {
      const checksumsPath = join(tmp, 'checksums.sha256');
      await downloadFile(checksumsAsset.browser_download_url, checksumsPath, 'FFmpeg checksums');
      const content = await readFile(checksumsPath, 'utf8');
      const line = content.split('\n').find((l) => l.includes(asset.name));
      if (line) {
        const expected = line.trim().split(/\s+/)[0];
        const actual = await sha256File(zipPath);
        if (expected.toLowerCase() !== actual.toLowerCase()) {
          throw new Error(`FFmpeg zip sha256 mismatch: expected ${expected}, got ${actual}`);
        }
        log('FFmpeg zip sha256 verified.');
      } else {
        log('WARN: could not find a checksum line for the chosen asset, skipping verification.');
      }
    }

    const extractDir = join(tmp, 'extracted');
    extractZip(zipPath, extractDir);
    const ffmpegSrc = findFile(extractDir, 'ffmpeg.exe');
    const ffprobeSrc = findFile(extractDir, 'ffprobe.exe');
    if (!ffmpegSrc || !ffprobeSrc) throw new Error('ffmpeg.exe/ffprobe.exe not found inside the downloaded archive.');
    mkdirSync(BIN_DIR, { recursive: true });
    await copyFile(ffmpegSrc, ffmpegExe);
    await copyFile(ffprobeSrc, ffprobeExe);
    log(`Installed ${ffmpegExe} and ${ffprobeExe}.`);
  });
}

// ── whisper.cpp ─────────────────────────────────────────────────────────

async function fetchWhisper(force: boolean): Promise<void> {
  const whisperExe = join(BIN_DIR, 'whisper-cli.exe');
  if (!force && existsSync(whisperExe)) {
    log('whisper-cli already present, skipping (use --force to redownload).');
    return;
  }
  log('Fetching whisper.cpp release info from ggml-org/whisper.cpp...');
  const releases = await ghJson<GhRelease[]>(`${GITHUB_API}/repos/ggml-org/whisper.cpp/releases?per_page=20`);
  // Semantic "vX.Y.Z" releases are changelog-only (no assets); the CI "b<number>" tags carry the
  // actual prebuilt binaries. Pick the most recently published one that has assets.
  const withAssets = releases
    .filter((r) => /^b\d+$/.test(r.tag_name) && r.assets.length > 0)
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  const release = withAssets[0];
  if (!release) throw new Error('Could not find a whisper.cpp release with prebuilt Windows binaries.');

  const hasGpu = detectNvidiaGpu();
  log(`NVIDIA GPU detected: ${hasGpu}. Selecting ${hasGpu ? 'CUDA' : 'CPU'} whisper.cpp build.`);

  let asset: GhAsset | undefined;
  if (hasGpu) {
    const cublas = release.assets
      .filter((a) => /^whisper-cublas-[\d.]+-bin-x64\.zip$/i.test(a.name))
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    asset = cublas[0];
  }
  if (!asset) {
    asset = release.assets.find((a) => a.name.toLowerCase() === 'whisper-bin-x64.zip');
  }
  if (!asset) throw new Error(`Could not find a suitable whisper.cpp Windows x64 build in release ${release.tag_name}.`);

  await withTmpDir(async (tmp) => {
    const zipPath = join(tmp, asset!.name);
    await downloadFile(asset!.browser_download_url, zipPath, `whisper.cpp (${asset!.name})`);
    const extractDir = join(tmp, 'extracted');
    extractZip(zipPath, extractDir);

    const cliSrc = findFile(extractDir, 'whisper-cli.exe') ?? findFile(extractDir, 'main.exe');
    if (!cliSrc) throw new Error('whisper-cli.exe not found inside the downloaded archive.');
    mkdirSync(BIN_DIR, { recursive: true });
    await copyFile(cliSrc, whisperExe);

    // Copy every DLL next to whisper-cli.exe (ggml*, whisper.dll, cudart/cublas for the GPU build).
    const cliDir = dirname(cliSrc);
    const dlls = readdirSync(cliDir).filter((f) => f.toLowerCase().endsWith('.dll'));
    for (const dll of dlls) {
      await copyFile(join(cliDir, dll), join(BIN_DIR, dll));
    }
    log(`Installed ${whisperExe} and ${dlls.length} DLL(s) (build ${release.tag_name}, asset ${asset!.name}).`);
  });
}

// ── Whisper model ───────────────────────────────────────────────────────

const MODEL_ALIASES: Record<string, string> = {
  tiny: 'ggml-tiny.bin',
  'tiny.en': 'ggml-tiny.en.bin',
  base: 'ggml-base.bin',
  'base.en': 'ggml-base.en.bin',
  small: 'ggml-small.bin',
  'small.en': 'ggml-small.en.bin',
  medium: 'ggml-medium.bin',
  'medium.en': 'ggml-medium.en.bin',
  'large-v3': 'ggml-large-v3.bin',
  'large-v3-turbo': 'ggml-large-v3-turbo.bin',
  'large-v3-turbo-q5_0': 'ggml-large-v3-turbo-q5_0.bin',
  'large-v3-q5_0': 'ggml-large-v3-q5_0.bin',
};

function resolveModelFileName(model: string): string {
  if (MODEL_ALIASES[model]) return MODEL_ALIASES[model];
  if (model.endsWith('.bin')) return model.startsWith('ggml-') ? model : `ggml-${model}`;
  return `ggml-${model}.bin`;
}

async function fetchModel(model: string, force: boolean): Promise<void> {
  const fileName = resolveModelFileName(model);
  const dest = join(MODELS_DIR, fileName);
  if (!force && existsSync(dest) && statSync(dest).size > 1_000_000) {
    log(`Model ${fileName} already present, skipping (use --force to redownload).`);
    return;
  }
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName}`;
  log(`Fetching whisper model ${fileName} from Hugging Face (ggerganov/whisper.cpp)...`);
  await downloadFile(url, dest, `model ${fileName}`);
  if (statSync(dest).size < 1_000_000) {
    throw new Error(`Downloaded model ${fileName} looks too small; check the model name.`);
  }
}

// ── Subtitle font ───────────────────────────────────────────────────────

async function fetchFonts(force: boolean): Promise<void> {
  const fontDest = join(FONTS_DIR, 'ArchivoBlack-Regular.ttf');
  const licenseDest = join(FONTS_DIR, 'OFL.txt');
  if (!force && existsSync(fontDest) && existsSync(licenseDest)) {
    log('Subtitle font already present, skipping (use --force to redownload).');
    return;
  }
  // Archivo Black: single-weight OFL display face (Google Fonts), ideal for karaoke subtitles.
  // Not a variable font, so libass/GDI picks the right weight without extra named-instance setup.
  const base = 'https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack';
  log('Fetching Archivo Black (OFL) from google/fonts...');
  await downloadFile(`${base}/ArchivoBlack-Regular.ttf`, fontDest, 'Archivo Black font');
  await downloadFile(`${base}/OFL.txt`, licenseDest, 'Archivo Black license');
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(BIN_DIR, { recursive: true });
  mkdirSync(MODELS_DIR, { recursive: true });
  mkdirSync(FONTS_DIR, { recursive: true });

  if (!args.skip.has('ffmpeg')) await fetchFfmpeg(args.force);
  else log('Skipping FFmpeg (--skip-ffmpeg).');

  if (!args.skip.has('whisper')) await fetchWhisper(args.force);
  else log('Skipping whisper.cpp (--skip-whisper).');

  if (!args.skip.has('model')) await fetchModel(args.model, args.force);
  else log('Skipping model download (--skip-model).');

  if (!args.skip.has('fonts')) await fetchFonts(args.force);
  else log('Skipping fonts (--skip-fonts).');

  log('Done.');
}

main().catch((err) => {
  console.error('[fetch-binaries] FAILED:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
