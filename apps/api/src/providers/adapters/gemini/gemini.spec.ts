import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '@hefesto/shared-types';
import { expectValidManifest, expectValidUsage, testCallContext } from '../../contract.spec-helper';
import { ProviderError } from '../../contracts';
import { readWavDurationMs } from '../../wav';

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
  Modality: { AUDIO: 'AUDIO', TEXT: 'TEXT' },
}));

// Imported after the mock so the class picks up the mocked constructor.
import { GeminiProvider } from './provider';
import { geminiManifest } from './manifest';

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'gemini-1',
    name: 'Gemini',
    adapter: 'gemini',
    capabilities: ['text', 'tts'],
    secretRef: 'GEMINI_API_KEY',
    params: {},
    enabled: true,
    ...overrides,
  };
}

describe('GeminiProvider', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hefesto-gemini-'));
    mockGenerateContent.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('declares a valid manifest', () => {
    expectValidManifest(geminiManifest);
    expect(geminiManifest.capabilities).toEqual(expect.arrayContaining(['text', 'tts']));
  });

  it('throws a clear error naming the secret when the API key is missing', () => {
    expect(() => new GeminiProvider(config(), {})).toThrow(/GEMINI_API_KEY/);
  });

  it('generates text and reports token usage from usageMetadata', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'hola mundo', usageMetadata: { totalTokenCount: 42 } });
    const provider = new GeminiProvider(config(), { GEMINI_API_KEY: 'test-key' });

    const result = await provider.generateText!({ prompt: 'hola' }, testCallContext());
    expect(result.text).toBe('hola mundo');
    expect(result.usage.units).toBe(42);
    expectValidUsage(result.usage);
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.any(String), contents: 'hola' }),
    );
  });

  it('requests structured output when jsonSchema is provided', async () => {
    mockGenerateContent.mockResolvedValue({ text: '{}', usageMetadata: { totalTokenCount: 5 } });
    const provider = new GeminiProvider(config(), { GEMINI_API_KEY: 'test-key' });

    await provider.generateText!({ prompt: 'hola', jsonSchema: { type: 'object' } }, testCallContext());
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.responseMimeType).toBe('application/json');
    expect(call.config.responseJsonSchema).toEqual({ type: 'object' });
  });

  it('synthesizes TTS by decoding base64 PCM into a WAV file', async () => {
    const pcm = Buffer.alloc(24000 * 2); // 1 second of silence at 24kHz/16-bit
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString('base64'), mimeType: 'audio/L16' } }] } }],
    });
    const provider = new GeminiProvider(config(), { GEMINI_API_KEY: 'test-key' });

    const outPath = join(dir, 'voice.wav');
    const result = await provider.synthesize!({ text: 'hola', voiceId: 'Kore', language: 'es', outPath }, testCallContext());

    const buf = readFileSync(outPath);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(readWavDurationMs(buf)).toBeCloseTo(1000, -1);
    expect(result.durationMs).toBeCloseTo(1000, -1);
    expectValidUsage(result.usage);
  });

  it('applies stylePrompt as a natural-language instruction before the text', async () => {
    const pcm = Buffer.alloc(100);
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString('base64') } }] } }],
    });
    const provider = new GeminiProvider(config(), { GEMINI_API_KEY: 'test-key' });

    await provider.synthesize!(
      { text: 'hola', voiceId: 'Kore', language: 'es', stylePrompt: 'hablá con calma', outPath: join(dir, 'v.wav') },
      testCallContext(),
    );
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.contents).toContain('hablá con calma');
    expect(call.contents).toContain('hola');
    expect(call.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });

  it('throws a retryable ProviderError when Gemini TTS returns no audio', async () => {
    mockGenerateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'oops' }] } }] });
    const provider = new GeminiProvider(config(), { GEMINI_API_KEY: 'test-key' });

    await expect(
      provider.synthesize!({ text: 'hola', voiceId: 'Kore', language: 'es', outPath: join(dir, 'v.wav') }, testCallContext()),
    ).rejects.toThrow(ProviderError);
  });

  it('lists the known prebuilt voices', async () => {
    const provider = new GeminiProvider(config(), { GEMINI_API_KEY: 'test-key' });
    const voices = await provider.listVoices!('es');
    expect(voices.map((v) => v.id)).toEqual(expect.arrayContaining(['Kore', 'Puck', 'Zephyr']));
  });

  it('healthCheck reports failure without throwing', async () => {
    mockGenerateContent.mockRejectedValue(new Error('network down'));
    const provider = new GeminiProvider(config(), { GEMINI_API_KEY: 'test-key' });
    const result = await provider.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/network down/);
  });
});
