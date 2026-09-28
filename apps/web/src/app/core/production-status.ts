import type { ProductionSummary } from '@hefesto/shared-types';
import type { StatusTone } from '@hefesto/web-ui';

export interface ProductionStatus {
  label: string;
  tone: StatusTone;
}

/** One label per production state, shared by Biblioteca, its inspector and the channel's Videos tab. */
export function productionStatus(p: Pick<ProductionSummary, 'status' | 'qaPassed' | 'stage'>): ProductionStatus {
  if (p.status === 'failed') return { label: 'Falló', tone: 'danger' };
  if (p.status === 'running') return { label: 'Forjando', tone: 'accent' };
  if (p.qaPassed === false) return { label: 'Revisar', tone: 'warn' };
  if (p.stage === 'published') return { label: 'Publicado', tone: 'ok' };
  if (p.stage === 'scheduled') return { label: 'Programado', tone: 'steel' };
  if (p.status === 'done') return { label: 'Listo', tone: 'ok' };
  return { label: 'Pendiente', tone: 'neutral' };
}
