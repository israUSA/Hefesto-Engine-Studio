import { createHash } from 'node:crypto';

/** Deterministic seed bytes from any string, used to make fake outputs reproducible. */
export function hashSeed(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}
