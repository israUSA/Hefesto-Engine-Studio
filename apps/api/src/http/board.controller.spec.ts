import { createTestDb } from '../db/test-utils';
import {
  ChannelsRepository,
  IdeasRepository,
  ProductionsRepository,
  ScriptsRepository,
} from '../db/repositories';
import { BoardController } from './board.controller';

function buildChannel(channels: ChannelsRepository) {
  return channels.create({
    name: 'Canal',
    slug: 'canal',
    platform: 'tiktok',
    handle: '@c',
    language: 'es',
    format: '9:16',
    topic: 't',
    bible: 'b',
    durationTarget: { min: 20, max: 40 },
    aiLabel: true,
    monetized: false,
    active: true,
    voice: { voiceId: 'v', language: 'es' },
    visualStyle: { source: 'stock', motion: 'kenburns' },
  });
}

describe('BoardController', () => {
  it('maps ideas, scripts and productions to the right columns', () => {
    const { db } = createTestDb();
    const channels = new ChannelsRepository(db);
    const ideas = new IdeasRepository(db);
    const scripts = new ScriptsRepository(db);
    const productions = new ProductionsRepository(db);
    const controller = new BoardController(channels, ideas, scripts, productions);

    const channel = buildChannel(channels);
    ideas.create({ channelId: channel.id, title: 'Idea A', angle: 'ángulo', source: 'ai' });

    const draftScript = scripts.create({
      channelId: channel.id,
      title: 'Guion borrador',
      hook: 'hook',
      body: 'body',
      cta: 'cta',
      fullText: 'hook body cta',
      verseRefs: [],
      metadata: {},
      scenes: [{ order: 0, text: 'hook body cta', visualPrompt: 'vp' }],
      status: 'draft',
    });

    const approvedScript = scripts.create({
      channelId: channel.id,
      title: 'Guion aprobado',
      hook: 'hook2',
      body: 'body2',
      cta: 'cta2',
      fullText: 'hook2 body2 cta2',
      verseRefs: [],
      metadata: {},
      scenes: [{ order: 0, text: 'hook2 body2 cta2', visualPrompt: 'vp' }],
      status: 'approved',
    });

    const producedProduction = productions.create({ scriptId: approvedScript.id, channelId: channel.id });
    productions.updateStage(producedProduction.id, 'rendered', {}, 'done');

    const reviewedScript = scripts.create({
      channelId: channel.id,
      title: 'Guion revisado',
      hook: 'h3',
      body: 'b3',
      cta: 'c3',
      fullText: 'h3 b3 c3',
      verseRefs: [],
      metadata: {},
      scenes: [{ order: 0, text: 'h3 b3 c3', visualPrompt: 'vp' }],
      status: 'approved',
    });
    const reviewedProduction = productions.create({ scriptId: reviewedScript.id, channelId: channel.id });
    productions.updateStage(reviewedProduction.id, 'qa_passed', {}, 'done');

    const board = controller.get(channel.id);
    const byId = Object.fromEntries(board.columns.map((c) => [c.id, c]));

    expect(byId['idea'].cards).toHaveLength(1);
    expect(byId['idea'].cards[0].title).toBe('Idea A');

    expect(byId['script'].cards).toHaveLength(1);
    expect(byId['script'].cards[0].title).toBe('Guion borrador');

    // approvedScript is used by a production, so it must NOT show up as a bare "approved" card.
    expect(byId['approved'].cards).toHaveLength(0);

    expect(byId['produced'].cards).toHaveLength(1);
    expect(byId['produced'].cards[0].id).toBe(producedProduction.id);

    expect(byId['reviewed'].cards).toHaveLength(1);
    expect(byId['reviewed'].cards[0].id).toBe(reviewedProduction.id);

    expect(byId['published'].cards).toHaveLength(0);
    void draftScript;
  });
});
