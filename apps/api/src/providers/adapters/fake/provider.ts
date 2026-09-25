import { writeFileSync } from 'node:fs';
import type { HealthResult, ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from '../../adapter-core';
import type {
  CallContext,
  ImageInput,
  StockItem,
  StockQuery,
  TextInput,
  TextResult,
  TranscribeInput,
  TranscribeResult,
  TtsInput,
  TtsResult,
  Voice,
} from '../../contracts';
import { computeUsage } from '../../cost';
import { fakeManifest } from './manifest';
import { fakeGenerateText } from './text';
import { fakeSynthesize } from './tts';
import { fakeTranscribe } from './transcribe';
import { fakeSearchStock } from './stock';
import { colorFromSeed, generateSolidPng } from './png';

/**
 * Covers every capability with pure-Node, deterministic, offline output so the whole
 * pipeline (script -> voice -> transcript -> visuals) can run in tests and local dev
 * with no network and no cost.
 */
export class FakeProvider implements AdapterCore {
  readonly manifest: ProviderManifest = fakeManifest;

  constructor(readonly config: ProviderConfig) {}

  async healthCheck(): Promise<HealthResult> {
    return { ok: true, message: 'El proveedor fake siempre está disponible', latencyMs: 0 };
  }

  async generateText(input: TextInput, _ctx: CallContext): Promise<TextResult> {
    const started = Date.now();
    const { text, units } = fakeGenerateText(input);
    return {
      text,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units, unit: 'char', durationMs: Date.now() - started }),
    };
  }

  async synthesize(input: TtsInput, _ctx: CallContext): Promise<TtsResult> {
    const started = Date.now();
    const { durationMs } = fakeSynthesize(input);
    return {
      audioPath: input.outPath,
      durationMs,
      usage: computeUsage({
        manifest: this.manifest,
        config: this.config,
        units: input.text.length,
        unit: 'char',
        durationMs: Date.now() - started,
      }),
    };
  }

  async listVoices(_language: string): Promise<Voice[]> {
    return [
      { id: 'fake-1', name: 'Fake Voice 1', language: 'es', gender: 'neutral' },
      { id: 'fake-2', name: 'Fake Voice 2', language: 'en', gender: 'neutral' },
    ];
  }

  async transcribe(input: TranscribeInput, _ctx: CallContext): Promise<TranscribeResult> {
    const started = Date.now();
    const { text, words } = fakeTranscribe(input);
    return {
      text,
      words,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: 0, unit: 'second', durationMs: Date.now() - started }),
    };
  }

  async search(query: StockQuery, _ctx: CallContext): Promise<StockItem[]> {
    return fakeSearchStock(query);
  }

  async download(item: StockItem, outPath: string, _ctx: CallContext) {
    const started = Date.now();
    // The fake stock catalog only has stills; a video item still gets a placeholder frame.
    const png = generateSolidPng(item.width, item.height, colorFromSeed(item.id));
    writeFileSync(outPath, png);
    return {
      path: outPath,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: 1, unit: 'request', durationMs: Date.now() - started }),
    };
  }

  async generateImage(input: ImageInput, _ctx: CallContext) {
    const started = Date.now();
    const [width, height] = input.aspectRatio === '16:9' ? [1920, 1080] : input.aspectRatio === '1:1' ? [1080, 1080] : [1080, 1920];
    const png = generateSolidPng(width, height, colorFromSeed(input.prompt));
    writeFileSync(input.outPath, png);
    return {
      path: input.outPath,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: 1, unit: 'image', durationMs: Date.now() - started }),
    };
  }
}
