import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type TagTone = 'neutral' | 'accent' | 'steel';

/** Small mono badge for platform names, model ids, ".env" markers, etc. */
@Component({
  selector: 'hf-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="hf-tag" [class]="'hf-tag--' + tone()">
      <ng-content></ng-content>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .hf-tag {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      height: 20px;
      padding: 0 var(--space-2);
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: var(--tracking-label);
      text-transform: uppercase;
      color: var(--text-3);
      background: var(--surface-2);
      white-space: nowrap;
    }
    .hf-tag--accent {
      color: var(--accent);
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .hf-tag--steel {
      color: var(--steel);
      border-color: var(--steel);
      background: var(--steel-soft);
    }
  `,
})
export class Tag {
  readonly tone = input<TagTone>('neutral');
}
