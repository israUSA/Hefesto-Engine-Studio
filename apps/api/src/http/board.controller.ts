import { Controller, Get, Query } from '@nestjs/common';
import type { Board, BoardCard, BoardColumnId } from '@hefesto/shared-types';
import { ChannelsRepository, IdeasRepository, ProductionsRepository, ScriptsRepository } from '../db/repositories';

const COLUMN_LABELS: Record<BoardColumnId, string> = {
  idea: 'Idea',
  script: 'Guion',
  approved: 'Aprobado',
  produced: 'Producido',
  reviewed: 'Revisado',
  published: 'Publicado',
};

@Controller('board')
export class BoardController {
  constructor(
    private readonly channels: ChannelsRepository,
    private readonly ideas: IdeasRepository,
    private readonly scripts: ScriptsRepository,
    private readonly productions: ProductionsRepository,
  ) {}

  @Get()
  get(@Query('channelId') channelId?: string): Board {
    const channelIds = channelId ? [channelId] : this.channels.list().map((c) => c.id);

    const ideaCards: BoardCard[] = [];
    const scriptCards: BoardCard[] = [];
    const approvedCards: BoardCard[] = [];
    const producedCards: BoardCard[] = [];
    const reviewedCards: BoardCard[] = [];
    const publishedCards: BoardCard[] = [];

    for (const cid of channelIds) {
      for (const idea of this.ideas.listByChannel(cid)) {
        if (idea.status === 'new' || idea.status === 'accepted') {
          ideaCards.push({
            id: idea.id,
            kind: 'idea',
            column: 'idea',
            channelId: cid,
            title: idea.title,
            subtitle: idea.angle,
            updatedAt: idea.createdAt,
          });
        }
      }

      const scripts = this.scripts.listByChannel(cid);
      const usedScriptIds = new Set(this.productions.listByChannel(cid).map((p) => p.scriptId));
      for (const script of scripts) {
        const verseRef = script.verseRefs[0];
        const card: BoardCard = {
          id: script.id,
          kind: 'script',
          column: 'script',
          channelId: cid,
          title: script.title,
          subtitle: script.hook,
          durationSec: script.estimatedDurationSec,
          verseRef: verseRef ? formatVerseRef(verseRef) : undefined,
          updatedAt: script.createdAt,
        };
        if (script.status === 'draft') scriptCards.push(card);
        else if (script.status === 'approved' && !usedScriptIds.has(script.id)) {
          approvedCards.push({ ...card, column: 'approved' });
        }
      }

      for (const prod of this.productions.listByChannel(cid)) {
        if (!['rendered', 'qa_failed', 'qa_passed', 'published'].includes(prod.stage)) continue;
        const script = this.scripts.findById(prod.scriptId);
        const column: BoardColumnId =
          prod.stage === 'qa_passed' ? 'reviewed' : prod.stage === 'published' ? 'published' : 'produced';
        const card: BoardCard = {
          id: prod.id,
          kind: 'production',
          column,
          channelId: cid,
          title: script?.title ?? prod.id,
          subtitle: prod.stage === 'qa_failed' ? 'QA con fallas' : undefined,
          durationSec: prod.durationMs ? Math.round(prod.durationMs / 1000) : undefined,
          thumbUrl: `/api/files/${prod.id}/thumb.jpg`,
          updatedAt: prod.updatedAt,
        };
        if (column === 'produced') producedCards.push(card);
        else if (column === 'reviewed') reviewedCards.push(card);
        else publishedCards.push(card);
      }
    }

    const columns: BoardColumnId[] = ['idea', 'script', 'approved', 'produced', 'reviewed', 'published'];
    const cardsByColumn: Record<BoardColumnId, BoardCard[]> = {
      idea: ideaCards,
      script: scriptCards,
      approved: approvedCards,
      produced: producedCards,
      reviewed: reviewedCards,
      published: publishedCards,
    };

    return { columns: columns.map((id) => ({ id, label: COLUMN_LABELS[id], cards: cardsByColumn[id] })) };
  }
}

function formatVerseRef(ref: { book: string; chapter: number; verseStart: number; verseEnd?: number }): string {
  const range = ref.verseEnd && ref.verseEnd !== ref.verseStart ? `${ref.verseStart}-${ref.verseEnd}` : `${ref.verseStart}`;
  return `${ref.book} ${ref.chapter}:${range}`;
}
