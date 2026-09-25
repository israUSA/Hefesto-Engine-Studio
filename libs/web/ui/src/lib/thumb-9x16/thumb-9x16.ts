import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon, IconName } from '../icon/icon';

/**
 * 9:16 thumbnail — the protagonist of the app. Shows the burned-in subtitle line
 * exactly as it appears in the rendered video, the mandatory "IA" content-label
 * mark, and small overlays (time, duration, platform, render progress).
 */
@Component({
  selector: 'hf-thumb-9x16',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="hf-thumb">
      @if (imageUrl()) {
        <img class="hf-thumb__img" [src]="imageUrl()" [alt]="caption1() || 'Miniatura'" loading="lazy" />
      } @else {
        <div class="hf-thumb__placeholder">
          <hf-icon name="image" [size]="20" />
        </div>
      }

      <div class="hf-thumb__top">
        @if (topLeftText()) {
          <span class="hf-thumb__badge">
            <hf-icon name="clock" [size]="10" />
            {{ topLeftText() }}
          </span>
        }
        @if (aiMark()) {
          <span class="hf-thumb__ia">IA</span>
        }
        @if (platformIcon(); as p) {
          <span class="hf-thumb__platform">
            <hf-icon [name]="p" [size]="12" />
          </span>
        }
      </div>

      @if (durationText()) {
        <span class="hf-thumb__duration">{{ durationText() }}</span>
      }

      @if (caption1() || caption2()) {
        <div class="hf-thumb__scrim">
          <p class="hf-thumb__caption">
            <span>{{ caption1() }}</span>
            @if (caption2()) {
              <span class="hf-thumb__caption--accent">{{ caption2() }}</span>
            }
          </p>
        </div>
      }

      <div class="hf-thumb__footer">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      aspect-ratio: 9 / 16;
    }
    .hf-thumb {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: var(--radius-md);
      overflow: hidden;
      background: var(--surface-2);
    }
    .hf-thumb__img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .hf-thumb__placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-3);
    }
    .hf-thumb__top {
      position: absolute;
      top: var(--space-2);
      left: var(--space-2);
      right: var(--space-2);
      display: flex;
      align-items: center;
      gap: var(--space-1);
    }
    .hf-thumb__badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      font-family: var(--font-mono);
      font-size: 10px;
    }
    .hf-thumb__ia {
      margin-left: auto;
      padding: 2px 5px;
      border-radius: var(--radius-sm);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.04em;
    }
    .hf-thumb__platform {
      display: inline-flex;
      padding: 3px;
      border-radius: var(--radius-sm);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
    }
    .hf-thumb__duration {
      position: absolute;
      bottom: var(--space-2);
      right: var(--space-2);
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      font-family: var(--font-mono);
      font-size: 10px;
    }
    .hf-thumb__scrim {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: flex-end;
      padding: var(--space-3);
      background: linear-gradient(to top, rgba(0, 0, 0, 0.75) 0%, rgba(0, 0, 0, 0) 45%);
    }
    .hf-thumb__caption {
      margin: 0;
      display: flex;
      flex-direction: column;
      font-weight: 700;
      font-size: 13px;
      line-height: 1.25;
      color: #fff;
      text-transform: uppercase;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
    }
    .hf-thumb__caption--accent {
      color: var(--sub-highlight);
    }
    .hf-thumb__footer:empty {
      display: none;
    }
    .hf-thumb__footer {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
    }
  `,
})
export class Thumb9x16 {
  readonly imageUrl = input<string | null>(null);
  readonly caption1 = input('');
  readonly caption2 = input('');
  readonly topLeftText = input('');
  readonly durationText = input('');
  readonly aiMark = input(true);
  readonly platformIcon = input<IconName | null>(null);
}
