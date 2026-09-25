import { Injectable } from '@nestjs/common';
import { makeThumbnail, renderShort, type RenderCallbacks, type RenderInput, type RenderResult, type ThumbnailOptions } from '../render';

@Injectable()
export class RenderService {
  render(input: RenderInput, callbacks?: RenderCallbacks): Promise<RenderResult> {
    return renderShort(input, callbacks);
  }

  thumbnail(videoPath: string, outPath: string, atMs: number, options?: ThumbnailOptions): Promise<string> {
    return makeThumbnail(videoPath, outPath, atMs, options);
  }
}
