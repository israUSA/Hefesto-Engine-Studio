import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EmptyState } from '@hefesto/web-ui';

export interface PlaceholderData {
  title: string;
  detail?: string;
}

/** Tidy stand-in for a screen this wave doesn't build yet. */
@Component({
  selector: 'hf-placeholder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState],
  template: `
    <hf-empty-state icon="sparkles" [title]="title" [detail]="detail || 'Llega en la próxima entrega.'" />
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
})
export class PlaceholderPage {
  private readonly data = inject(ActivatedRoute).snapshot.data as PlaceholderData;
  readonly title = this.data.title ?? 'Próximamente';
  readonly detail = this.data.detail;
}
