/**
 * Nest module exposing every media service to the rest of the pipeline. Each service is a thin
 * injectable wrapper around the plain functions in this folder (kept as plain functions so they
 * stay easy to unit test without a Nest testing module).
 */

import { Module } from '@nestjs/common';
import { FfmpegService } from './services/ffmpeg.service';
import { EncoderService } from './services/encoder.service';
import { WhisperTranscriptionService } from './services/whisper-transcription.service';
import { AlignmentService } from './services/alignment.service';
import { SubtitlesService } from './services/subtitles.service';
import { RenderService } from './services/render.service';

@Module({
  providers: [FfmpegService, EncoderService, WhisperTranscriptionService, AlignmentService, SubtitlesService, RenderService],
  exports: [FfmpegService, EncoderService, WhisperTranscriptionService, AlignmentService, SubtitlesService, RenderService],
})
export class MediaModule {}
