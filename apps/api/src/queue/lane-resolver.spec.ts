import type { ProviderConfig } from '@hefesto/shared-types';
import type { EncoderService } from '../media/services/encoder.service';
import { buildWhisperManifest } from '../media/whisper/whisper.provider';
import { InMemoryBindingSource, ProviderRegistry } from '../providers';
import { fakeProviderFactory } from '../providers/adapters/fake';
import { geminiProviderFactory } from '../providers/adapters/gemini';
import { openAiCompatibleProviderFactory } from '../providers/adapters/openai-compatible';
import { ProviderLaneResolver } from './lane-resolver';

const cfg = (id: string, adapter: string, extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id,
  name: id,
  adapter,
  capabilities: ['text', 'tts', 'transcribe', 'stock'],
  params: {},
  enabled: true,
  ...extra,
});

function resolver(usesGpu: boolean) {
  const source = new InMemoryBindingSource()
    .addConfig(cfg('gemini', 'gemini', { secretRef: 'GEMINI_API_KEY' }))
    .addConfig(cfg('ollama', 'openai-compatible', { baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b' }))
    .addConfig(cfg('fake', 'fake'));
  const bind = (id: string, capability: 'text' | 'tts' | 'transcribe' | 'stock', providerConfigId: string, channelId: string | null = null, role?: 'script') =>
    source.addBinding({ id, channelId, capability, role, providerConfigId, params: {}, fallbackIds: [] });
  bind('t', 'text', 'gemini', null, 'script');
  bind('t2', 'text', 'ollama', 'local', 'script');
  bind('v', 'tts', 'gemini');
  bind('s', 'stock', 'fake');
  bind('w', 'transcribe', 'fake');
  const registry = new ProviderRegistry(source, { GEMINI_API_KEY: 'test' });
  for (const f of [fakeProviderFactory, geminiProviderFactory, openAiCompatibleProviderFactory]) registry.register(f);
  const encoder = { detect: async () => ({ name: usesGpu ? 'h264_qsv' : 'libx264', args: [], usesGpu }) } as unknown as EncoderService;
  return new ProviderLaneResolver(registry, encoder);
}

describe('ProviderLaneResolver', () => {
  it('takes the lane from the resolved provider manifest', async () => {
    const r = resolver(true);
    expect(await r.laneFor('script', { channelId: 'c' })).toBe('net'); // Gemini (cloud)
    expect(await r.laneFor('script', { channelId: 'local' })).toBe('gpu'); // Ollama on localhost
    expect(await r.laneFor('script', { channelId: 'c', scriptId: 's' })).toBe('cpu'); // approved script: local copy
    expect(await r.laneFor('voice', { channelId: 'c' })).toBe('net');
    expect(await r.laneFor('visuals', { channelId: 'c' })).toBe('cpu'); // fake provider is local cpu
    expect(await r.laneFor('transcribe', { channelId: 'c' })).toBe('cpu');
    expect(await r.laneFor('subtitles', { channelId: 'c' })).toBe('cpu');
    expect(await r.laneFor('qa', { channelId: 'c' })).toBe('cpu');
  });

  it('puts render on the GPU lane only with a hardware encoder', async () => {
    expect(await resolver(true).laneFor('render', { channelId: 'c' })).toBe('gpu');
    expect(await resolver(false).laneFor('render', { channelId: 'c' })).toBe('cpu');
  });

  it('whisper.cpp is a GPU job only with the CUDA build', () => {
    expect(buildWhisperManifest(true).resources.lane).toBe('gpu');
    expect(buildWhisperManifest(false).resources.lane).toBe('cpu');
  });

  it('falls back to a default lane when the binding cannot be resolved', async () => {
    const empty = new ProviderLaneResolver(
      new ProviderRegistry(new InMemoryBindingSource(), {}),
      { detect: async () => ({ usesGpu: false }) } as unknown as EncoderService,
    );
    expect(await empty.laneFor('voice', { channelId: 'c' })).toBe('net');
    expect(await empty.laneFor('transcribe', { channelId: 'c' })).toBe('cpu');
  });
});
