import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Loading placeholder block. Use for thumbnails, rows and text lines while data loads. */
@Component({
  selector: 'hf-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: var(--radius-md);
      background: var(--surface-2);
      background-image: linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 50%, var(--surface-2) 100%);
      background-size: 200% 100%;
      animation: hf-skeleton-sweep 1.4s ease-in-out infinite;
    }
    @keyframes hf-skeleton-sweep {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }
  `,
  host: {
    '[style.width]': 'width()',
    '[style.height]': 'height()',
    '[style.border-radius]': 'radius()',
  },
})
export class Skeleton {
  readonly width = input('100%');
  readonly height = input('100%');
  readonly radius = input('var(--radius-md)');
}
