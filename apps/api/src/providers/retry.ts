import { ProviderError } from './contracts';

export interface BackoffOptions {
  /** Total attempts including the first try. Default 4. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * Retries `fn` with exponential backoff and jitter while it throws a retryable
 * `ProviderError` (429/5xx/timeouts). Non-retryable errors and non-`ProviderError`
 * throws propagate immediately. Aborts early via `signal`.
 */
export async function withBackoff<T>(fn: (attempt: number) => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const maxDelayMs = opts.maxDelayMs ?? 8000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error('Operación cancelada');
    }
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ProviderError ? err.retryable : false;
      if (!retryable || attempt === maxAttempts) throw err;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.random() * delay * 0.3;
      await sleep(delay + jitter, opts.signal);
    }
  }
  // Unreachable: the loop always returns or throws.
  throw lastError instanceof Error ? lastError : new Error('withBackoff: sin intentos');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    function onAbort(): void {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Operación cancelada'));
    }
    function cleanup(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort);
  });
}

/** Maps an HTTP status from a network adapter into a `ProviderError` with the right `retryable` flag. */
export function httpStatusToProviderError(status: number, adapter: string, message: string): ProviderError {
  const retryable = status === 429 || status >= 500;
  return new ProviderError(message, adapter, retryable);
}
