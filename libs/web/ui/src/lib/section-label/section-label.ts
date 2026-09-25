import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Mono uppercase tracked label used above lists, e.g. "TUBERÍA", "NECESITA ATENCIÓN". */
@Component({
  selector: 'hf-section-label',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content></ng-content>`,
  styles: `
    :host {
      display: inline-block;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-label);
      text-transform: uppercase;
      color: var(--text-3);
    }
  `,
})
export class SectionLabel {}
