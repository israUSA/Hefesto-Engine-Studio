import type { ResolvableCapability } from './contracts';
import { ProviderError } from './contracts';
import type { ProviderRegistry, ResolveOptions, ResolvedProvider } from './provider-registry';

export interface FallbackServedBy {
  configId: string;
  adapter: string;
  name: string;
  /** 0 = the primary binding served the call; >0 = that fallback index did. */
  fallbackIndex: number;
}

export interface FallbackResult<T> {
  result: T;
  servedBy: FallbackServedBy;
}

/**
 * Runs `fn` against the channel's bound provider for `capability`, falling back to
 * `binding.fallbackIds` in order when the primary (or an earlier fallback) throws a
 * retryable `ProviderError` or is missing its secret.
 *
 * Per docs/13 §7: **voice never falls back automatically** — changing voice mid-catalog
 * breaks channel identity — unless the binding's `params.allowFallback === true`.
 */
export async function callWithFallback<C extends ResolvableCapability, T>(
  registry: ProviderRegistry,
  capability: C,
  opts: ResolveOptions,
  fn: (resolved: ResolvedProvider<C>) => Promise<T>,
): Promise<FallbackResult<T>> {
  const primary = registry.resolve(capability, opts);
  const allowFallback = capability !== 'tts' || primary.binding?.params?.['allowFallback'] === true;
  const fallbackIds = allowFallback ? primary.binding?.fallbackIds ?? [] : [];

  const attempts: Array<() => ResolvedProvider<C>> = [
    () => primary,
    ...fallbackIds.map((id) => () => registry.resolveConfig(capability, id, opts)),
  ];

  let lastError: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const isLast = i === attempts.length - 1;
    let resolved: ResolvedProvider<C>;
    try {
      resolved = attempts[i]();
    } catch (err) {
      lastError = err;
      if (!isLast && isRetryableResolutionError(err)) continue;
      throw err;
    }
    try {
      const result = await fn(resolved);
      return {
        result,
        servedBy: {
          configId: resolved.config.id,
          adapter: resolved.config.adapter,
          name: resolved.config.name,
          fallbackIndex: i,
        },
      };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ProviderError ? err.retryable : false;
      if (!isLast && retryable) continue;
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('callWithFallback: sin intentos');
}

/** A missing secret is a resolution-time (not call-time) failure, but should still fall through. */
function isRetryableResolutionError(err: unknown): boolean {
  return err instanceof ProviderError && /Falta el secreto/.test(err.message);
}
