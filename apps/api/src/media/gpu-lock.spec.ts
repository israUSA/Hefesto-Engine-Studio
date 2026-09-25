import { gpuLock } from './gpu-lock';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('gpuLock', () => {
  it('runs a single task immediately', async () => {
    const result = await gpuLock.withLock(async () => 42);
    expect(result).toBe(42);
    expect(gpuLock.isLocked).toBe(false);
  });

  it('serializes concurrent tasks: only one runs at a time', async () => {
    const order: string[] = [];
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const task = (name: string, ms: number) =>
      gpuLock.withLock(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        order.push(`start-${name}`);
        await delay(ms);
        order.push(`end-${name}`);
        concurrentCount--;
      });

    await Promise.all([task('whisper', 30), task('render', 10), task('render2', 5)]);

    expect(maxConcurrent).toBe(1); // rule #2: only one GPU task at a time
    // Tasks run strictly in FIFO order: each one fully finishes before the next starts.
    expect(order).toEqual(['start-whisper', 'end-whisper', 'start-render', 'end-render', 'start-render2', 'end-render2']);
  });

  it('releases the lock even if the task throws', async () => {
    await expect(
      gpuLock.withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // Lock must be free again for the next task.
    const result = await gpuLock.withLock(async () => 'ok');
    expect(result).toBe('ok');
  });
});
