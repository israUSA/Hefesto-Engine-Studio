import { NotFoundException } from '@nestjs/common';
import { createTestDb } from '../db/test-utils';
import { ChannelsRepository, CostEntriesRepository, ProductionsRepository } from '../db/repositories';
import { InMemoryBindingSource, ProviderRegistry } from '../providers/provider-registry';
import { ChannelsController } from './channels.controller';

const CHANNEL_INPUT = {
  name: 'Canal Test',
  slug: 'canal-test',
  platform: 'tiktok' as const,
  handle: '@test',
  language: 'es',
  format: '9:16' as const,
  topic: 'pruebas',
  bible: 'Tono de prueba.',
  durationTarget: { min: 20, max: 40 },
  aiLabel: true,
  monetized: false,
  active: true,
  voice: { voiceId: 'v1', language: 'es' },
  visualStyle: { source: 'stock' as const, motion: 'kenburns' as const },
};

function buildController() {
  const { db } = createTestDb();
  const channels = new ChannelsRepository(db);
  const productions = new ProductionsRepository(db);
  const costs = new CostEntriesRepository(db);
  const registry = new ProviderRegistry(new InMemoryBindingSource(), {});
  const ffmpeg = { normalizeAudio: jest.fn() } as never;
  const controller = new ChannelsController(channels, productions, costs, ffmpeg, registry);
  return { controller, channels };
}

describe('ChannelsController', () => {
  it('creates, lists, updates and soft-deletes a channel', () => {
    const { controller } = buildController();

    const created = controller.create(CHANNEL_INPUT);
    expect(created.id).toBeTruthy();
    expect(created.slug).toBe('canal-test');

    const list = controller.list();
    expect(list).toHaveLength(1);
    expect(list[0].channel.id).toBe(created.id);
    expect(list[0].videosThisMonth).toBe(0);
    expect(list[0].costThisMonthUsd).toBe(0);

    const fetched = controller.getBySlug('canal-test');
    expect(fetched.id).toBe(created.id);

    const updated = controller.update(created.id, { name: 'Canal Renombrado' });
    expect(updated.name).toBe('Canal Renombrado');

    controller.remove(created.id);
    const afterDelete = controller.getBySlug('canal-test');
    expect(afterDelete.active).toBe(false);
  });

  it('throws 404 for an unknown channel', () => {
    const { controller } = buildController();
    expect(() => controller.getBySlug('no-existe')).toThrow(NotFoundException);
    expect(() => controller.update('no-existe', { name: 'x' })).toThrow(NotFoundException);
    expect(() => controller.remove('no-existe')).toThrow(NotFoundException);
  });
});
