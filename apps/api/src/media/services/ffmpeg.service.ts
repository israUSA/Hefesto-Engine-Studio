import { Injectable } from '@nestjs/common';
import { concatAudio, measureLoudness, normalizeAudio, probe, type ConcatAudioOptions, type NormalizeAudioOptions, type ProbeResult } from '../ffmpeg';

@Injectable()
export class FfmpegService {
  probe(filePath: string): Promise<ProbeResult> {
    return probe(filePath);
  }

  normalizeAudio(inPath: string, outPath: string, options?: NormalizeAudioOptions): Promise<void> {
    return normalizeAudio(inPath, outPath, options);
  }

  concatAudio(parts: string[], gapsMs: number[], outPath: string, options?: ConcatAudioOptions): Promise<void> {
    return concatAudio(parts, gapsMs, outPath, options);
  }

  measureLoudness(filePath: string): Promise<{ integratedLufs: number; truePeakDb?: number }> {
    return measureLoudness(filePath);
  }
}
