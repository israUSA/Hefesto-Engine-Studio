import { GoogleGenAI, Modality } from '@google/genai';
import type { HealthResult, ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from '../../adapter-core';
import type { CallContext, TextInput, TextResult, TtsInput, TtsResult, Voice } from '../../contracts';
import { ProviderError } from '../../contracts';
import { computeUsage } from '../../cost';
import { withBackoff } from '../../retry';
import { writePcmWav } from '../../wav';
import { geminiManifest } from './manifest';
import { GEMINI_TEXT_PRICING, GEMINI_TTS_PRICING } from './pricing';

/** Known Gemini TTS prebuilt voices (docs/13). Verify against the current API before shipping new ones. */
const PREBUILT_VOICES = ['Kore', 'Charon', 'Puck', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Zephyr'];

const DEFAULT_TEXT_MODEL = 'gemini-2.5-flash';
const DEFAULT_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_SAMPLE_RATE = 24000;

export class GeminiProvider implements AdapterCore {
  readonly manifest: ProviderManifest = geminiManifest;
  private readonly client: GoogleGenAI;

  constructor(readonly config: ProviderConfig, env: NodeJS.ProcessEnv) {
    const secretName = config.secretRef ?? 'GEMINI_API_KEY';
    const apiKey = env[secretName];
    if (!apiKey) {
      throw new ProviderError(`Falta el secreto: definí ${secretName} en .env`, 'gemini', false);
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async healthCheck(): Promise<HealthResult> {
    const started = Date.now();
    try {
      await this.client.models.generateContent({
        model: this.config.model ?? DEFAULT_TEXT_MODEL,
        contents: 'ping',
        config: { maxOutputTokens: 8 },
      });
      return { ok: true, message: 'Gemini responde', latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async generateText(input: TextInput, ctx: CallContext): Promise<TextResult> {
    const started = Date.now();
    const model = this.config.model ?? DEFAULT_TEXT_MODEL;
    const generationConfig: Record<string, unknown> = {
      systemInstruction: input.system,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
    };
    if (input.jsonSchema) {
      generationConfig['responseMimeType'] = 'application/json';
      generationConfig['responseJsonSchema'] = input.jsonSchema;
    }

    const response = await withBackoff(
      () =>
        this.callGemini(() =>
          this.client.models.generateContent({ model, contents: input.prompt, config: generationConfig }),
        ),
      { signal: ctx.signal },
    );

    const text = response.text ?? '';
    const totalTokens =
      response.usageMetadata?.totalTokenCount ?? Math.ceil((input.prompt.length + text.length) / 4);

    return {
      text,
      usage: computeUsage({
        manifest: { ...this.manifest, pricing: this.config.pricingOverride ?? GEMINI_TEXT_PRICING },
        config: this.config,
        units: totalTokens,
        unit: 'token',
        durationMs: Date.now() - started,
      }),
    };
  }

  async synthesize(input: TtsInput, ctx: CallContext): Promise<TtsResult> {
    const started = Date.now();
    const model = this.config.model ?? DEFAULT_TTS_MODEL;
    const contents = input.stylePrompt ? `${input.stylePrompt}\n\n${input.text}` : input.text;

    const response = await withBackoff(
      () =>
        this.callGemini(() =>
          this.client.models.generateContent({
            model,
            contents,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voiceId } } },
            },
          }),
        ),
      { signal: ctx.signal },
    );

    const audioPart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
    const base64 = audioPart?.inlineData?.data;
    if (!base64) {
      throw new ProviderError('Gemini TTS no devolvió audio en la respuesta', 'gemini', true);
    }

    const pcm = Buffer.from(base64, 'base64');
    writePcmWav(input.outPath, pcm, { sampleRate: TTS_SAMPLE_RATE });
    const durationMs = Math.round((pcm.length / 2 / TTS_SAMPLE_RATE) * 1000);

    return {
      audioPath: input.outPath,
      durationMs,
      usage: computeUsage({
        manifest: { ...this.manifest, pricing: this.config.pricingOverride ?? GEMINI_TTS_PRICING },
        config: this.config,
        units: input.text.length,
        unit: 'char',
        durationMs: Date.now() - started,
      }),
    };
  }

  async listVoices(_language: string): Promise<Voice[]> {
    return PREBUILT_VOICES.map((name) => ({ id: name, name, language: 'multi' }));
  }

  private async callGemini<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const status = extractStatus(err);
      const retryable = status !== undefined ? status === 429 || status >= 500 : true;
      throw new ProviderError(err instanceof Error ? err.message : String(err), 'gemini', retryable, err);
    }
  }
}

function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
