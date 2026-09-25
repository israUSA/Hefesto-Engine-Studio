import { Injectable } from '@nestjs/common';
import type { WordTiming } from '@hefesto/shared-types';
import { alignScriptToWhisper, type AlignmentResult } from '../align';

@Injectable()
export class AlignmentService {
  align(scriptText: string, whisperWords: WordTiming[]): AlignmentResult {
    return alignScriptToWhisper(scriptText, whisperWords);
  }
}
