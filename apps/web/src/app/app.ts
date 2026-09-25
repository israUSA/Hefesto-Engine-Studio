import { Component } from '@angular/core';
import { Shell } from './shell/shell';

@Component({
  imports: [Shell],
  selector: 'hf-root',
  template: '<hf-shell />',
})
export class App {}
