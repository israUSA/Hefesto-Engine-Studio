/**
 * Process-wide mutex so only one GPU task runs at a time (rule #2 in CLAUDE.md): whisper.cpp
 * CUDA transcription and NVENC/QSV/AMF rendering share a single 4 GB VRAM budget and must never
 * run concurrently. Plain async FIFO queue, no external dependency needed.
 */

type QueueEntry = { run: () => void };

class GpuLock {
  private locked = false;
  private queue: QueueEntry[] = [];

  /** Number of tasks currently waiting for the lock (does not include the one holding it). */
  get pending(): number {
    return this.queue.length;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      const tryRun = () => {
        this.locked = true;
        resolve();
      };
      if (!this.locked) {
        tryRun();
      } else {
        this.queue.push({ run: tryRun });
      }
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next.run();
    } else {
      this.locked = false;
    }
  }

  /** Runs `fn` once the lock is free, releasing it afterwards regardless of success/failure. */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** Single process-wide instance: every caller (Whisper adapter, render service) shares it. */
export const gpuLock = new GpuLock();
