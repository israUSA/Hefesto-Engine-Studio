import { Injectable } from '@nestjs/common';
import type { Channel, WordTiming } from '@hefesto/shared-types';
import { writeFile } from 'node:fs/promises';
import { AlignmentService } from '../../media/services/alignment.service';
import { FfmpegService } from '../../media/services/ffmpeg.service';
import { RenderService } from '../../media/services/render.service';
import { SubtitlesService } from '../../media/services/subtitles.service';
import type { MediaTools, SceneClip, SubtitleStyle } from '../ports';

const FRAME: Record<Channel['format'], { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};

@Injectable()
export class LocalMediaTools implements MediaTools {
  constructor(
    private readonly ffmpeg: FfmpegService,
    private readonly alignment: AlignmentService,
    private readonly subtitles: SubtitlesService,
    private readonly renderer: RenderService,
  ) {}

  async normalizeVoice(inPath: string, outPath: string): Promise<{ durationMs: number }> {
    await this.ffmpeg.normalizeAudio(inPath, outPath, { trimSilence: true, targetLufs: -14 });
    return { durationMs: await this.probeDurationMs(outPath) };
  }

  async measureLoudness(path: string): Promise<number> {
    return (await this.ffmpeg.measureLoudness(path)).integratedLufs;
  }

  async probeDurationMs(path: string): Promise<number> {
    return (await this.ffmpeg.probe(path)).durationMs;
  }

  align(scriptText: string, transcript: WordTiming[]): { words: WordTiming[]; wer: number } {
    const { words, wer } = this.alignment.align(scriptText, transcript);
    return { words, wer: wer / 100 };
  }

  async writeSubtitles(
    words: WordTiming[],
    style: SubtitleStyle,
    format: Channel['format'],
    outPath: string,
  ): Promise<void> {
    const ass = this.subtitles.build(
      words.map((w) => ({ ...w, fromWhisper: true })),
      {
        ...FRAME[format],
        style: {
          fontName: style.fontName,
          fontSizePx: style.fontSize,
          primaryColor: style.primaryColor,
          highlightColor: style.highlightColor,
          uppercase: style.uppercase,
        },
      },
    );
    await writeFile(outPath, ass, 'utf8');
  }

  async render(
    input: { scenes: SceneClip[]; voicePath: string; subsPath: string; format: Channel['format']; outPath: string },
    opts: { onProgress?: (p: number) => void; signal?: AbortSignal },
  ): Promise<{ encoder: string; durationMs: number }> {
    const { encoder, durationMs } = await this.renderer.render(input, opts);
    return { encoder, durationMs };
  }

  async thumbnail(videoPath: string, outPath: string, atMs: number): Promise<void> {
    await this.renderer.thumbnail(videoPath, outPath, atMs);
  }
}
