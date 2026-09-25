import { readFileSync, writeFileSync } from 'node:fs';
import type { HealthResult, Lane, ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from '../../adapter-core';
import type {
  CallContext,
  TextInput,
  TextResult,
  TranscribeInput,
  TranscribeResult,
  TtsInput,
  TtsResult,
  Voice,
} from '../../contracts';
import { computeUsage } from '../../cost';
import { httpStatusToProviderError, withBackoff } from '../../retry';
import { openAiCompatibleManifest } from './manifest';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens?: number };
}

interface EmbeddingsResponse {
  data?: Array<{ embedding: number[] }>;
  usage?: { total_tokens?: number };
}

interface TranscriptionResponse {
  text?: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

interface ModelsResponse {
  data?: Array<{ id: string }>;
}

function isLocalBaseUrl(baseUrl: string | undefined): boolean {
  return Boolean(baseUrl && /localhost|127\.0\.0\.1/i.test(baseUrl));
}

/**
 * Covers OpenAI, Ollama, LM Studio, llama.cpp, vLLM, OpenRouter, Groq, DeepSeek,
 * Together... — anything speaking the OpenAI HTTP surface. Only `baseUrl`, `model` and
 * the key change between instances (docs/13).
 */
export class OpenAiCompatibleProvider implements AdapterCore {
  readonly manifest: ProviderManifest;

  constructor(
    readonly config: ProviderConfig,
    private readonly env: NodeJS.ProcessEnv,
  ) {
    const local = isLocalBaseUrl(config.baseUrl);
    // Ollama runs text generation on the GPU; a local embeddings-only instance would want 'cpu',
    // set that explicitly via config.params.lane.
    const lane = (local ? (config.params?.['lane'] as Lane | undefined) ?? 'gpu' : 'net') as Lane;
    this.manifest = {
      ...openAiCompatibleManifest,
      kind: local ? 'local' : 'cloud',
      resources: { lane },
      pricing: local ? undefined : openAiCompatibleManifest.pricing,
    };
  }

  private baseUrl(): string {
    return (this.config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  private apiKey(): string | undefined {
    return this.config.secretRef ? this.env[this.config.secretRef] : undefined;
  }

  private jsonHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const key = this.apiKey();
    if (key) headers['authorization'] = `Bearer ${key}`;
    return headers;
  }

  async healthCheck(): Promise<HealthResult> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl()}/models`, { headers: this.jsonHeaders() });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const body = (await res.json()) as ModelsResponse;
      return { ok: true, message: 'OK', latencyMs: Date.now() - started, models: body.data?.map((m) => m.id) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async generateText(input: TextInput, ctx: CallContext): Promise<TextResult> {
    const started = Date.now();
    const messages = [
      ...(input.system ? [{ role: 'system', content: input.system }] : []),
      { role: 'user', content: this.withJsonInstructions(input) },
    ];
    const body: Record<string, unknown> = {
      model: this.config.model ?? 'gpt-4o-mini',
      messages,
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens,
    };
    if (this.config.params?.['keep_alive'] !== undefined) {
      body['keep_alive'] = this.config.params['keep_alive'];
    }
    if (input.jsonSchema) {
      body['response_format'] = { type: 'json_schema', json_schema: { name: 'response', schema: input.jsonSchema, strict: true } };
    }

    const json = await this.postJson<ChatCompletionResponse>('/chat/completions', body, ctx.signal);
    const text = json.choices?.[0]?.message?.content ?? '';
    const totalTokens = json.usage?.total_tokens ?? Math.ceil((JSON.stringify(messages).length + text.length) / 4);

    return {
      text,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: totalTokens, unit: 'token', durationMs: Date.now() - started }),
    };
  }

  private withJsonInstructions(input: TextInput): string {
    if (!input.jsonSchema) return input.prompt;
    return [
      input.prompt,
      '',
      'Devolvé ÚNICAMENTE un JSON válido que cumpla este esquema, sin texto adicional ni bloques de código:',
      JSON.stringify(input.jsonSchema),
    ].join('\n');
  }

  async embed(texts: string[], ctx: CallContext): Promise<{ vectors: number[][]; usage: import('@hefesto/shared-types').Usage }> {
    const started = Date.now();
    const json = await this.postJson<EmbeddingsResponse>(
      '/embeddings',
      { model: this.config.model ?? 'text-embedding-3-small', input: texts },
      ctx.signal,
    );
    const vectors = (json.data ?? []).map((d) => d.embedding);
    const units = json.usage?.total_tokens ?? texts.join(' ').length;
    return {
      vectors,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units, unit: 'token', durationMs: Date.now() - started }),
    };
  }

  async synthesize(input: TtsInput, ctx: CallContext): Promise<TtsResult> {
    const started = Date.now();
    const res = await this.request('/audio/speech', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ model: this.config.model ?? 'tts-1', voice: input.voiceId, input: input.text, speed: input.speed }),
      signal: ctx.signal,
    });
    const arrayBuffer = await res.arrayBuffer();
    writeFileSync(input.outPath, Buffer.from(arrayBuffer));

    const words = input.text.trim().split(/\s+/).filter(Boolean).length || 1;
    const durationMs = Math.round((words / 2.5) * 1000);

    return {
      audioPath: input.outPath,
      durationMs,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: input.text.length, unit: 'char', durationMs: Date.now() - started }),
    };
  }

  async listVoices(_language: string): Promise<Voice[]> {
    const configured = this.config.params?.['voices'];
    const ids = Array.isArray(configured) ? (configured as string[]) : ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
    return ids.map((id) => ({ id, name: id, language: 'multi' }));
  }

  async transcribe(input: TranscribeInput, ctx: CallContext): Promise<TranscribeResult> {
    const started = Date.now();
    const audio = readFileSync(input.audioPath);
    const form = new FormData();
    form.append('file', new Blob([audio]), 'audio.wav');
    form.append('model', this.config.model ?? 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    if (input.prompt) form.append('prompt', input.prompt);

    const key = this.apiKey();
    const res = await this.request('/audio/transcriptions', {
      method: 'POST',
      headers: key ? { authorization: `Bearer ${key}` } : {},
      body: form,
      signal: ctx.signal,
    });
    const json = (await res.json()) as TranscriptionResponse;
    const words = (json.words ?? []).map((w) => ({
      word: w.word,
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
    }));

    return {
      text: json.text ?? '',
      words,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: 0, unit: 'second', durationMs: Date.now() - started }),
    };
  }

  private async postJson<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const res = await this.request(path, { method: 'POST', headers: this.jsonHeaders(), body: JSON.stringify(body), signal });
    return (await res.json()) as T;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    return withBackoff(async () => {
      const res = await fetch(`${this.baseUrl()}${path}`, init);
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw httpStatusToProviderError(res.status, 'openai-compatible', `HTTP ${res.status} ${bodyText}`.trim());
      }
      return res;
    }, { signal: init.signal ?? undefined });
  }
}
