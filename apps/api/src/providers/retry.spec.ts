import { ProviderError } from './contracts';
import { httpStatusToProviderError, withBackoff } from './retry';

describe('withBackoff', () => {
  it('retries a retryable ProviderError and eventually succeeds', async () => {
    let attempts = 0;
    const result = await withBackoff(
      async () => {
        attempts++;
        if (attempts < 3) throw new ProviderError('temporal', 'stub', true);
        return 'ok';
      },
      { baseDelayMs: 1, maxDelayMs: 2 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry a non-retryable ProviderError', async () => {
    let attempts = 0;
    await expect(
      withBackoff(
        async () => {
          attempts++;
          throw new ProviderError('fatal', 'stub', false);
        },
        { baseDelayMs: 1 },
      ),
    ).rejects.toThrow('fatal');
    expect(attempts).toBe(1);
  });

  it('does not retry a plain (non-ProviderError) error', async () => {
    let attempts = 0;
    await expect(
      withBackoff(
        async () => {
          attempts++;
          throw new Error('boom');
        },
        { baseDelayMs: 1 },
      ),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(1);
  });

  it('gives up after maxAttempts', async () => {
    let attempts = 0;
    await expect(
      withBackoff(
        async () => {
          attempts++;
          throw new ProviderError('siempre falla', 'stub', true);
        },
        { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
      ),
    ).rejects.toThrow('siempre falla');
    expect(attempts).toBe(3);
  });

  it('respects an already-aborted signal and never calls fn', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelado'));
    const fn = jest.fn();
    await expect(withBackoff(fn, { signal: controller.signal })).rejects.toThrow('cancelado');
    expect(fn).not.toHaveBeenCalled();
  });

  it('aborts mid-backoff without waiting the full delay', async () => {
    const controller = new AbortController();
    let attempts = 0;
    const promise = withBackoff(
      async () => {
        attempts++;
        throw new ProviderError('temporal', 'stub', true);
      },
      { baseDelayMs: 5000, maxAttempts: 5, signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error('cancelado a mitad de camino')), 10);
    await expect(promise).rejects.toThrow('cancelado a mitad de camino');
    expect(attempts).toBe(1);
  });
});

describe('httpStatusToProviderError', () => {
  it('marks 429 and 5xx as retryable', () => {
    expect(httpStatusToProviderError(429, 'stub', 'rate limited').retryable).toBe(true);
    expect(httpStatusToProviderError(500, 'stub', 'server error').retryable).toBe(true);
    expect(httpStatusToProviderError(503, 'stub', 'unavailable').retryable).toBe(true);
  });

  it('marks other 4xx as not retryable', () => {
    expect(httpStatusToProviderError(400, 'stub', 'bad request').retryable).toBe(false);
    expect(httpStatusToProviderError(401, 'stub', 'unauthorized').retryable).toBe(false);
    expect(httpStatusToProviderError(404, 'stub', 'not found').retryable).toBe(false);
  });
});
