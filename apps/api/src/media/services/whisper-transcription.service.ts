import { Injectable } from '@nestjs/common';
import type { ProviderConfig } from '@hefesto/shared-types';
import type { CallContext, TranscribeInput, TranscribeResult } from '../../providers/contracts';
import { whisperCppFactory } from '../whisper';

const DEFAULT_CONFIG: ProviderConfig = {
  id: 'whisper-cpp-local',
  name: 'whisper.cpp (local)',
  adapter: 'whisper-cpp',
  capabilities: ['transcribe'],
  params: {},
  enabled: true,
};

/** Thin Nest wrapper around the whisper.cpp `TranscriptionProvider` (see media/whisper). The
 * registry other agents are building can supply a different `ProviderConfig`; this default lets
 * pipeline stages transcribe without waiting on that wiring. */
@Injectable()
export class WhisperTranscriptionService {
  private readonly provider = whisperCppFactory.create(DEFAULT_CONFIG, process.env);

  transcribe(input: TranscribeInput, ctx: CallContext): Promise<TranscribeResult> {
    if (!('transcribe' in this.provider)) throw new Error('whisper-cpp factory did not return a TranscriptionProvider.');
    return (this.provider as unknown as { transcribe: (i: TranscribeInput, c: CallContext) => Promise<TranscribeResult> }).transcribe(input, ctx);
  }

  healthCheck() {
    return this.provider.healthCheck();
  }
}
