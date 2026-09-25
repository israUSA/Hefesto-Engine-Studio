import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '@hefesto/shared-types';
import { expectValidManifest, expectValidUsage, testCallContext } from '../../contract.spec-helper';
import { scriptDraftSchema } from '../../json-repair';
import { readWavDurationMs } from '../../wav';
import { FakeProvider } from './provider';
import { fakeManifest } from './manifest';

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'fake-1',
    name: 'Fake',
    adapter: 'fake',
    capabilities: ['text', 'tts', 'transcribe', 'stock', 'image'],
    params: {},
    enabled: true,
    ...overrides,
  };
}

describe('FakeProvider', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hefesto-fake-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('declares a valid manifest', () => {
    expectValidManifest(fakeManifest);
    expect(fakeManifest.license.commercial).toBe(true);
    expect(fakeManifest.kind).toBe('local');
  });

  it('generates plain deterministic text without a schema', async () => {
    const provider = new FakeProvider(config());
    const a = await provider.generateText!({ prompt: 'hola mundo' }, testCallContext());
    const b = await provider.generateText!({ prompt: 'hola mundo' }, testCallContext());
    expect(a.text).toEqual(b.text);
    expectValidUsage(a.usage);
    expect(a.usage.costUsd).toBe(0); // local adapter
  });

  it('generates a valid ScriptDraft JSON when jsonSchema is requested', async () => {
    const provider = new FakeProvider(config());
    const result = await provider.generateText!(
      { prompt: 'un versiculo sobre esperanza', jsonSchema: { type: 'object' } },
      testCallContext(),
    );
    const parsed = scriptDraftSchema.parse(JSON.parse(result.text));
    expect(parsed.scenes.length).toBeGreaterThanOrEqual(3);
    expect(parsed.scenes.length).toBeLessThanOrEqual(12);
    for (const scene of parsed.scenes) {
      expect(scene.keywords.length).toBeGreaterThanOrEqual(1);
      expect(scene.keywords.length).toBeLessThanOrEqual(4);
    }
  });

  it('is deterministic from the prompt hash', async () => {
    const provider = new FakeProvider(config());
    const r1 = await provider.generateText!({ prompt: 'x', jsonSchema: { type: 'object' } }, testCallContext());
    const r2 = await provider.generateText!({ prompt: 'x', jsonSchema: { type: 'object' } }, testCallContext());
    const r3 = await provider.generateText!({ prompt: 'y', jsonSchema: { type: 'object' } }, testCallContext());
    expect(r1.text).toEqual(r2.text);
    expect(r1.text).not.toEqual(r3.text);
  });

  it('writes a valid WAV file for tts with duration proportional to word count', async () => {
    const provider = new FakeProvider(config());
    const outPath = join(dir, 'voice.wav');
    const result = await provider.synthesize!(
      { text: 'una dos tres cuatro cinco', voiceId: 'fake-1', language: 'es', outPath },
      testCallContext(),
    );
    const buf = readFileSync(outPath);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    const durationMs = readWavDurationMs(buf);
    expect(durationMs).toBeCloseTo(result.durationMs, -1);
    expectValidUsage(result.usage);
  });

  it('transcribes evenly spaced words from the known script text', async () => {
    const provider = new FakeProvider(config());
    const outPath = join(dir, 'voice2.wav');
    await provider.synthesize!({ text: 'palabra uno dos tres', voiceId: 'fake-1', language: 'es', outPath }, testCallContext());
    const result = await provider.transcribe!({ audioPath: outPath, language: 'es', prompt: 'palabra uno dos tres' }, testCallContext());
    expect(result.words.map((w) => w.word)).toEqual(['palabra', 'uno', 'dos', 'tres']);
    expect(result.words[0].startMs).toBe(0);
    for (let i = 1; i < result.words.length; i++) {
      expect(result.words[i].startMs).toBeGreaterThanOrEqual(result.words[i - 1].endMs);
    }
  });

  it('searches fake stock items matching the requested orientation', async () => {
    const provider = new FakeProvider(config());
    const items = await provider.search!({ keywords: ['faith'], mediaType: 'photo', orientation: 'portrait', perPage: 3 }, testCallContext());
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.width).toBe(1080);
      expect(item.height).toBe(1920);
      expect(item.provider).toBe('fake');
    }
  });

  it('downloads a valid PNG for a stock item', async () => {
    const provider = new FakeProvider(config());
    const [item] = await provider.search!({ keywords: ['faith'], mediaType: 'photo', orientation: 'portrait', perPage: 1 }, testCallContext());
    const outPath = join(dir, 'stock.png');
    const { usage } = await provider.download!(item, outPath, testCallContext());
    const buf = readFileSync(outPath);
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expectValidUsage(usage);
  });

  it('generates a valid PNG image sized for the requested aspect ratio', async () => {
    const provider = new FakeProvider(config());
    const outPath = join(dir, 'image.png');
    const { usage } = await provider.generateImage!({ prompt: 'faith and hope', aspectRatio: '9:16', outPath }, testCallContext());
    const buf = readFileSync(outPath);
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(1080);
    expect(height).toBe(1920);
    expectValidUsage(usage);
  });

  it('healthCheck always succeeds', async () => {
    const provider = new FakeProvider(config());
    const result = await provider.healthCheck();
    expect(result.ok).toBe(true);
  });
});
