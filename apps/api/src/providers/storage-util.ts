import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { ProviderError } from './contracts';

/** Folder every storage provider keeps the app's files in (docs/06 · estructura). */
export const APP_FOLDER = 'Hefesto Engine Studio';

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};

export function mimeTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** Hex MD5 of a file, streamed (renders can be large). Drive reports the same hash as `md5Checksum`. */
export function md5File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Splits a remote path ("Canal (TikTok)/renders/2026-09/x.mp4") into its segments,
 * rejecting anything that could escape the app folder.
 */
export function remoteSegments(remotePath: string, adapter: string): string[] {
  const segments = remotePath.split('/').filter((s) => s.length > 0);
  if (segments.length === 0 || segments.some((s) => s === '.' || s === '..' || /[\\:*?"<>|]/.test(s))) {
    throw new ProviderError(`Ruta remota inválida: ${remotePath}`, adapter, false);
  }
  return segments;
}
