import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Lane, ProduceEstimate } from '@hefesto/shared-types';
import { Button, EmptyState, Icon, Skeleton } from '@hefesto/web-ui';

export interface LaneShare {
  lane: Lane;
  label: string;
  cssClass: string;
  jobs: number;
  pct: number;
}

export interface ChannelShare {
  channelId: string;
  name: string;
  videos: number;
  minutes: number;
  costUsd: number;
}

/** Sticky "Resumen de la tanda" aside of Producir: live estimate, lane split, blockers and the forge button. */
@Component({
  selector: 'hf-produce-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Button, EmptyState, Icon, Skeleton],
  templateUrl: './produce-summary.html',
  styleUrl: './produce-summary.css',
})
export class ProduceSummary {
  readonly selectedCount = input(0);
  readonly estimate = input<ProduceEstimate | null>(null);
  readonly estimating = input(false);
  readonly estimateError = input<string | null>(null);
  readonly laneShares = input<LaneShare[]>([]);
  readonly channelShares = input<ChannelShare[]>([]);
  readonly etaText = input('');
  readonly finishClock = input('');
  readonly startNote = input('');
  readonly canSubmit = input(false);
  readonly submitting = input(false);
  readonly forge = output<void>();
}
