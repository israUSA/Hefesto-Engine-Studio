import { Injectable } from '@nestjs/common';
import type { SystemInfo } from '@hefesto/shared-types';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env, paths } from '../config/env';
import { EncoderService } from '../media/services/encoder.service';
import { isCudaBuild } from '../media/whisper';

const execFileAsync = promisify(execFile);
/** Bumped by hand; reading package.json here would break once webpack bundles dist/. */
const APP_VERSION = '0.2.0-fase2';

/** Static-ish system info (encoder, whisper, ffmpeg): cached after the first read. */
@Injectable()
export class SystemInfoService {
  private cached?: SystemInfo;

  constructor(private readonly encoder: EncoderService) {}

  async get(): Promise<SystemInfo> {
    if (this.cached) return this.cached;

    const [encoderInfo, ffmpegVersion] = await Promise.all([this.encoder.detect(), this.ffmpegVersion()]);
    const cuda = isCudaBuild();

    this.cached = {
      version: APP_VERSION,
      home: env.home,
      encoder: { name: encoderInfo.name, usesGpu: encoderInfo.name !== 'libx264' },
      whisper: { model: env.whisperModel, cuda },
      ffmpeg: ffmpegVersion,
      platform: `${process.platform} ${process.arch}`,
    };
    return this.cached;
  }

  private async ffmpegVersion(): Promise<string> {
    try {
      const { stdout } = await execFileAsync(paths.bin('ffmpeg'), ['-version'], { timeout: 3000 });
      return stdout.split('\n')[0]?.trim() ?? 'ffmpeg';
    } catch {
      return 'no encontrado';
    }
  }
}
