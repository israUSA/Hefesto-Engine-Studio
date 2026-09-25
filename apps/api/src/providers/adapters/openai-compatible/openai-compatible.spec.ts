import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '@hefesto/shared-types';
import { expectValidManifest, expectValidUsage, testCallContext } from '../../contract.spec-helper';
import { openAiCompatibleManifest } from './manifest';
import { OpenAiCompatibleProvider } from './provider';

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'oa-1',
    name: 'OpenAI-compatible',
    adapter: 'openai-compatible',
    capabilities: ['text', 'embedding', 'tts', 'transcribe'],
    baseUrl: 'https://api.example.com/v1',
    secretRef: 'OA_API_KEY',
    params: {},
    enabled: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('OpenAiCompatibleProvider', () => {
  let dir: string;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hefesto-oa-'));
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('declares a valid generic manifest', () => {
    expectValidManifest(openAiCompatibleManifest);
  });

  it('reports kind local and lane gpu by default for a localhost baseUrl (Ollama)', () => {
    const provider = new OpenAiCompatibleProvider(config({ baseUrl: 'http://localhost:11434/v1', secretRef: undefined }), {});
    expect(provider.manifest.kind).toBe('local');
    expect(provider.manifest.resources.lane).toBe('gpu');
  });

  it('respects an explicit lane override for a local instance', () => {
    const provider = new OpenAiCompatibleProvider(
      config({ baseUrl: 'http://127.0.0.1:11434/v1', secretRef: undefined, params: { lane: 'cpu' } }),
      {},
    );
    expect(provider.manifest.resources.lane).toBe('cpu');
  });

  it('reports kind cloud and lane net for a remote baseUrl', () => {
    const provider = new OpenAiCompatibleProvider(config(), { OA_API_KEY: 'k' });
    expect(provider.manifest.kind).toBe('cloud');
    expect(provider.manifest.resources.lane).toBe('net');
  });

  it('generates text via /chat/completions with a bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'hola' } }], usage: { total_tokens: 10 } }));
    const provider = new OpenAiCompatibleProvider(config(), { OA_API_KEY: 'secret-key' });

    const result = await provider.generateText!({ prompt: 'hola', system: 'sé breve' }, testCallContext());
    expect(result.text).toBe('hola');
    expect(result.usage.units).toBe(10);
    expectValidUsage(result.usage);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.example.com/v1/chat/completions');
    expect(init.headers['authorization']).toBe('Bearer secret-key');
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sé breve' });
  });

  it('sends response_format json_schema when jsonSchema is requested', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{}' } }] }));
    const provider = new OpenAiCompatibleProvider(config(), { OA_API_KEY: 'k' });

    await provider.generateText!({ prompt: 'hola', jsonSchema: { type: 'object' } }, testCallContext());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema).toEqual({ type: 'object' });
  });

  it('works against Ollama with no API key (no authorization header)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'hola' } }] }));
    const provider = new OpenAiCompatibleProvider(config({ baseUrl: 'http://localhost:11434/v1', secretRef: undefined }), {});

    await provider.generateText!({ prompt: 'hola' }, testCallContext());
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['authorization']).toBeUndefined();
  });

  it('reports $0 cost for a local instance regardless of manifest pricing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'hola' } }], usage: { total_tokens: 999 } }));
    const provider = new OpenAiCompatibleProvider(config({ baseUrl: 'http://localhost:11434/v1', secretRef: undefined }), {});

    const result = await provider.generateText!({ prompt: 'hola' }, testCallContext());
    expect(result.usage.costUsd).toBe(0);
  });

  it('embeds texts via /embeddings', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ embedding: [1, 2, 3] }], usage: { total_tokens: 4 } }));
    const provider = new OpenAiCompatibleProvider(config(), { OA_API_KEY: 'k' });

    const result = await provider.embed!(['hola'], testCallContext());
    expect(result.vectors).toEqual([[1, 2, 3]]);
    expectValidUsage(result.usage);
  });

  it('synthesizes tts by writing the raw response body to outPath', async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValue(new Response(audioBytes, { status: 200 }));
    const provider = new OpenAiCompatibleProvider(config(), { OA_API_KEY: 'k' });

    const outPath = join(dir, 'voice.mp3');
    const result = await provider.synthesize!({ text: 'una dos', voiceId: 'alloy', language: 'es', outPath }, testCallContext());
    expect(readFileSync(outPath)).toEqual(Buffer.from(audioBytes));
    expectValidUsage(result.usage);
  });

  it('transcribes with word timestamps via /audio/transcriptions', async () => {
    const audioPath = join(dir, 'in.wav');
    writeFileSync(audioPath, Buffer.from('fake audio bytes'));
    fetchMock.mockResolvedValue(
      jsonResponse({ text: 'hola mundo', words: [{ word: 'hola', start: 0, end: 0.5 }, { word: 'mundo', start: 0.5, end: 1 }] }),
    );
    const provider = new OpenAiCompatibleProvider(config(), { OA_API_KEY: 'k' });

    const result = await provider.transcribe!({ audioPath, language: 'es' }, testCallContext());
    expect(result.text).toBe('hola mundo');
    expect(result.words).toEqual([
      { word: 'hola', startMs: 0, endMs: 500 },
      { word: 'mundo', startMs: 500, endMs: 1000 },
    ]);
  });

  it('retries a 429 and eventually succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const provider = new OpenAiCompatibleProvider(config(), { OA_API_KEY: 'k' });

    const result = await provider.generateText!({ prompt: 'hola' }, testCallContext());
    expect(result.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 and throws', async () => {
    fetchMock.mockResolvedValue(new Response('bad request', { status: 400 }));
    const provider = new OpenAiCompatibleProvider(config(), { OA_API_KEY: 'k' });

    await expect(provider.generateText!({ prompt: 'hola' }, testCallContext())).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('healthCheck lists model ids', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'gpt-4o-mini' }] }));
    const provider = new OpenAiCompatibleProvider(config(), { OA_API_KEY: 'k' });
    const result = await provider.healthCheck();
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['gpt-4o-mini']);
  });
});
