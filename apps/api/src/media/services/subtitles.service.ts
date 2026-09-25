import { Injectable } from '@nestjs/common';
import { buildAss, type SubtitleOptions } from '../subtitles';
import type { AlignedWord } from '../align';

@Injectable()
export class SubtitlesService {
  build(words: AlignedWord[], options: SubtitleOptions): string {
    return buildAss(words, options);
  }
}
