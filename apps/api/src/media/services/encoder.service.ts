import { Injectable } from '@nestjs/common';
import { detectEncoder, type EncoderInfo } from '../encoder';

@Injectable()
export class EncoderService {
  detect(force = false): Promise<EncoderInfo> {
    return detectEncoder(force);
  }
}
