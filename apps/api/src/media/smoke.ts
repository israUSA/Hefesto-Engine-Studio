/**
 * End-to-end integration check using the REAL downloaded binaries (no mocks): synthesizes a
 * short Spanish phrase with Windows SAPI, transcribes it with whisper.cpp, aligns the
 * transcription to the known script, builds karaoke subtitles, renders a 9:16 video from 3
 * generated gradient/solid images, and prints timings + the chosen encoder.
 *
 * Run with:
 *   npx ts-node --project tools/tsconfig.json --transpile-only apps/api/src/media/smoke.ts
 *
 * Requires `bin/ffmpeg.exe`, `bin/whisper-cli.exe` and a model in `bin/models/` — run
 * `tools/fetch-binaries.ts` first (see that file's header for flags, e.g. `--model base`
 * on a CPU-only dev machine).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { env, paths } from '../config/env';
import { probe, normalizeAudio } from './ffmpeg';
import { WhisperCppProvider, isCudaBuild } from './whisper/whisper.provider';
import { alignScriptToWhisper } from './align';
import { buildAss } from './subtitles';
import { renderShort } from './render';
import { detectEncoder } from './encoder';
import { run } from './process';

const SCRIPT_TEXT = 'Porque de tal manera amó Dios al mundo, que dio a su hijo unigénito.';

function log(msg: string) {
  console.log(`[smoke] ${msg}`);
}

function synthesizeVoiceWithSapi(outWavPath: string, text: string): void {
  const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile('${outWavPath.replace(/'/g, "''")}')
$synth.Rate = -1
$synth.Speak('${text.replace(/'/g, "''")}')
$synth.Dispose()
`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('PowerShell SAPI synthesis failed (Windows only).');
}

async function generateSceneImage(outPath: string, colorFrom: string, colorTo: string, width: number, height: number): Promise<void> {
  // A simple vertical gradient using ffmpeg's lavfi `gradients` source (falls back to a solid
  // color source if the build lacks the gradients filter).
  try {
    await run(paths.bin('ffmpeg'), [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `gradients=s=${width}x${height}:c0=${colorFrom}:c1=${colorTo}:x0=0:y0=0:x1=0:y1=${height}`,
      '-frames:v', '1', outPath,
    ], { timeoutMs: 15_000 });
  } catch {
    await run(paths.bin('ffmpeg'), [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${colorFrom}:s=${width}x${height}`,
      '-frames:v', '1', outPath,
    ], { timeoutMs: 15_000 });
  }
}

async function main() {
  const workDir = join(tmpdir(), 'hefesto-smoke');
  mkdirSync(workDir, { recursive: true });
  log(`Work dir: ${workDir}`);

  for (const bin of ['ffmpeg', 'ffprobe', 'whisper-cli']) {
    if (!existsSync(paths.bin(bin))) {
      throw new Error(`${bin} not found at ${paths.bin(bin)}. Run: npx ts-node --transpile-only tools/fetch-binaries.ts`);
    }
  }
  const modelPath = paths.model(env.whisperModel);
  if (!existsSync(modelPath)) {
    throw new Error(`Whisper model not found at ${modelPath}. Run tools/fetch-binaries.ts --model <name> (e.g. base for a CPU dev machine).`);
  }

  // 1. Synthesize voice.
  const rawVoicePath = join(workDir, 'voice-raw.wav');
  log('Synthesizing Spanish voice with Windows SAPI...');
  synthesizeVoiceWithSapi(rawVoicePath, SCRIPT_TEXT);

  const voicePath = join(workDir, 'voice.wav');
  await normalizeAudio(rawVoicePath, voicePath, { targetLufs: -14 });
  const voiceProbe = await probe(voicePath);
  log(`Voice duration: ${voiceProbe.durationMs} ms`);

  // 2. Transcribe.
  const cuda = isCudaBuild();
  log(`whisper.cpp build: ${cuda ? 'CUDA' : 'CPU'} (model ${env.whisperModel})`);
  const provider = new WhisperCppProvider({ id: 'smoke', name: 'smoke', adapter: 'whisper-cpp', capabilities: ['transcribe'], params: {}, enabled: true }, cuda);
  const whisperStarted = Date.now();
  const transcript = await provider.transcribe({ audioPath: voicePath, language: 'es', prompt: SCRIPT_TEXT }, { channelId: 'smoke' });
  const whisperMs = Date.now() - whisperStarted;
  log(`Whisper transcribed in ${whisperMs} ms: "${transcript.text.trim()}"`);
  log(`Whisper word count: ${transcript.words.length}`);

  // 3. Align to the known script.
  const { words: aligned, wer } = alignScriptToWhisper(SCRIPT_TEXT, transcript.words);
  log(`Alignment WER: ${wer.toFixed(1)}% (docs/04 §7 threshold: 8%)`);
  log(`Aligned words: ${aligned.map((w) => `${w.word}[${w.startMs}-${w.endMs}${w.fromWhisper ? '' : '~'}]`).join(' ')}`);

  // 4. Build subtitles.
  const subsPath = join(workDir, 'subs.ass');
  const ass = buildAss(aligned, {
    width: 1080,
    height: 1920,
    style: {
      fontName: 'Archivo Black',
      fontSizePx: 92,
      primaryColor: '#FFFFFF',
      highlightColor: '#FFD23F',
      outlineColor: '#000000',
      uppercase: true,
      keywords: ['dios'],
      keywordColor: '#8FD3FF',
    },
  });
  writeFileSync(subsPath, ass, 'utf8');
  log(`Subtitles written to ${subsPath}`);

  // 5. Generate 3 scene images and split the voice duration across them.
  const sceneCount = 3;
  const sceneDuration = Math.floor(voiceProbe.durationMs / sceneCount);
  const palettes: Array<[string, string]> = [
    ['0x1B1035', '0x4A2E7A'],
    ['0x0F2B46', '0x1E6091'],
    ['0x2B1B0E', '0x8A5A2B'],
  ];
  const scenes = [];
  for (let i = 0; i < sceneCount; i++) {
    const imgPath = join(workDir, `scene${i}.png`);
    await generateSceneImage(imgPath, palettes[i][0], palettes[i][1], 1080, 1920);
    const startMs = i * sceneDuration;
    const endMs = i === sceneCount - 1 ? voiceProbe.durationMs : startMs + sceneDuration;
    scenes.push({ path: imgPath, kind: 'image' as const, startMs, endMs });
  }
  log(`Generated ${sceneCount} scene images.`);

  // 6. Render.
  const outPath = join(workDir, 'short.mp4');
  const renderStarted = Date.now();
  const result = await renderShort(
    { scenes, voicePath, subsPath, format: '9:16', outPath, fps: 30 },
    { onProgress: (f) => process.stdout.write(`\r[smoke] rendering: ${(f * 100).toFixed(0)}%`) },
  );
  process.stdout.write('\n');
  const renderMs = Date.now() - renderStarted;

  const encoder = await detectEncoder();
  const outProbe = await probe(outPath);

  log('--- Summary ---');
  log(`Encoder used: ${result.encoder} (usesGpu=${encoder.usesGpu})`);
  log(`Whisper time: ${whisperMs} ms`);
  log(`Render time: ${renderMs} ms (reported ${result.renderTimeMs} ms)`);
  log(`Alignment WER: ${wer.toFixed(1)}%`);
  log(`Output: ${outPath} (${outProbe.width}x${outProbe.height}, ${outProbe.durationMs} ms, fps=${outProbe.fps})`);
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
