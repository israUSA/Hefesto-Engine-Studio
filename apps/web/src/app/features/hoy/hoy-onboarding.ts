import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button, Icon } from '@hefesto/web-ui';

/** First-run guide shown on Hoy while the install has no channels (Hefesto ships empty). */
@Component({
  selector: 'hf-hoy-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Button, Icon],
  templateUrl: './hoy-onboarding.html',
  styleUrl: './hoy-onboarding.css',
})
export class HoyOnboarding {
  readonly missingSecrets = input(false);
}
