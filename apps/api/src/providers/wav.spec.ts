import { generateTonePcm, readWavDurationMs, writePcmWav } from './wav';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('wav', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hefesto-wav-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a well-formed WAV header for mono 16-bit PCM', () => {
    const outPath = join(dir, 'out.wav');
    const pcm = generateTonePcm(1000, 24000, 440, 3000);
    writePcmWav(outPath, pcm, { sampleRate: 24000 });

    const buf = readFileSync(outPath);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.toString('ascii', 12, 16)).toBe('fmt ');
    expect(buf.readUInt16LE(20)).toBe(1); // PCM
    expect(buf.readUInt16LE(22)).toBe(1); // mono
    expect(buf.readUInt32LE(24)).toBe(24000); // sample rate
    expect(buf.readUInt16LE(34)).toBe(16); // bits per sample
    expect(buf.toString('ascii', 36, 40)).toBe('data');
    expect(buf.readUInt32LE(40)).toBe(pcm.length);
    expect(buf.length).toBe(44 + pcm.length);
  });

  it('round-trips duration through readWavDurationMs', () => {
    const outPath = join(dir, 'out2.wav');
    const pcm = generateTonePcm(2000, 24000, 0, 0);
    writePcmWav(outPath, pcm, { sampleRate: 24000 });
    const buf = readFileSync(outPath);
    expect(readWavDurationMs(buf)).toBeCloseTo(2000, -1);
  });

  it('returns undefined for a non-WAV buffer', () => {
    expect(readWavDurationMs(Buffer.from('not a wav file at all, too short'))).toBeUndefined();
  });

  it('generates silence when frequencyHz is 0', () => {
    const pcm = generateTonePcm(100, 8000, 0, 0);
    expect(pcm.every((byte) => byte === 0)).toBe(true);
  });

  it('generates a non-silent tone when frequencyHz > 0', () => {
    const pcm = generateTonePcm(100, 8000, 440, 3000);
    expect(pcm.some((byte) => byte !== 0)).toBe(true);
  });
});
