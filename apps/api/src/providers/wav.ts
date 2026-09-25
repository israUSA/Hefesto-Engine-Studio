import { writeFileSync } from 'node:fs';

export interface PcmToWavOptions {
  sampleRate: number;
  channels?: number;
  bitsPerSample?: number;
}

/** Wraps raw 16-bit PCM samples (mono by default) into a WAV file on disk. Pure Node, no ffmpeg. */
export function writePcmWav(outPath: string, pcm: Buffer, opts: PcmToWavOptions): void {
  const channels = opts.channels ?? 1;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const byteRate = (opts.sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(opts.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  writeFileSync(outPath, Buffer.concat([header, pcm]));
}

/** Reads a WAV file's duration in ms from its header, without decoding samples. Returns undefined if not a WAV. */
export function readWavDurationMs(buf: Buffer): number | undefined {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return undefined;
  }
  // Walk the chunks: FFmpeg writes a LIST chunk before `data`, so offsets aren't fixed.
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= buf.length; ) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(offset + 16);
    if (id === 'data') return byteRate ? Math.round((size / byteRate) * 1000) : undefined;
    offset += 8 + size + (size % 2);
  }
  return undefined;
}

/**
 * Generates 16-bit PCM samples: a low-amplitude sine tone when `frequencyHz > 0`,
 * or pure silence when it's 0.
 */
export function generateTonePcm(durationMs: number, sampleRate: number, frequencyHz = 0, amplitude = 0): Buffer {
  const numSamples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const pcm = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const sample = frequencyHz > 0 ? Math.round(amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate)) : 0;
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}
