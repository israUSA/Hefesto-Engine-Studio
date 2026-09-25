/**
 * Generic cancelable subprocess runner used by every FFmpeg/whisper.cpp invocation.
 * No shell is used (args are passed as an array) so paths with spaces and special
 * characters are always safe.
 */

import { spawn } from 'node:child_process';

export interface RunOptions {
  /** Working directory for the child process. Useful to pass short relative paths to filters. */
  cwd?: string;
  /** Called for every stderr line (ffmpeg/whisper.cpp log to stderr). */
  onLog?: (line: string) => void;
  /** Called with progress in [0, 1] when `parseProgress` is provided. */
  onProgress?: (fraction: number) => void;
  /** Parses a raw stdout/stderr chunk buffer of lines into a 0-1 fraction, or undefined. */
  parseProgress?: (lines: string[]) => number | undefined;
  /** Aborts and kills the process tree when triggered. */
  signal?: AbortSignal;
  /** Milliseconds before the process is killed for taking too long. */
  timeoutMs?: number;
  /** How many trailing stderr lines to keep for the error message. Default 20. */
  errorTailLines?: number;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly signalName: NodeJS.Signals | null,
    readonly stderrTail: string[],
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

export class ProcessTimeoutError extends ProcessError {
  constructor(stderrTail: string[]) {
    super('Process timed out', null, null, stderrTail);
    this.name = 'ProcessTimeoutError';
  }
}

export class ProcessCanceledError extends ProcessError {
  constructor(stderrTail: string[]) {
    super('Process was canceled', null, null, stderrTail);
    this.name = 'ProcessCanceledError';
  }
}

/** Kills a process and its children. On Windows, `taskkill /T` is required or ffmpeg's
 * children (rare, but some builds spawn helpers) survive the parent. */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
  }
}

/**
 * Runs `command args` and resolves when it exits with code 0.
 * Rejects with a `ProcessError` (or a subclass) otherwise.
 */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    const stderrTail: string[] = [];
    const tailLimit = options.errorTailLines ?? 20;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let stdoutBuf = '';
    let stderrBuf = '';

    const pushTail = (line: string) => {
      stderrTail.push(line);
      if (stderrTail.length > tailLimit) stderrTail.shift();
    };

    const handleChunk = (buf: string, fromStderr: boolean) => {
      const lines = buf.split(/\r?\n/);
      for (const line of lines) {
        if (!line) continue;
        if (fromStderr) {
          pushTail(line);
          options.onLog?.(line);
        }
      }
      if (options.parseProgress) {
        const fraction = options.parseProgress(lines);
        if (fraction !== undefined) options.onProgress?.(fraction);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      const parts = stdoutBuf.split(/\r?\n/);
      stdoutBuf = parts.pop() ?? '';
      handleChunk(parts.join('\n'), false);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      const parts = stderrBuf.split(/\r?\n/);
      stderrBuf = parts.pop() ?? '';
      handleChunk(parts.join('\n'), true);
    });

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (settled || child.pid === undefined) return;
      killTree(child.pid);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        // Kill as soon as the process actually has a pid.
        child.once('spawn', onAbort);
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    if (options.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        if (settled || child.pid === undefined) return;
        killTree(child.pid);
        settled = true;
        cleanup();
        reject(new ProcessTimeoutError([...stderrTail]));
      }, options.timeoutMs);
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProcessError(`Failed to start ${command}: ${err.message}`, null, null, [...stderrTail]));
    });

    child.on('close', (code, signalName) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (options.signal?.aborted) {
        reject(new ProcessCanceledError([...stderrTail]));
      } else if (code === 0) {
        resolve();
      } else {
        reject(
          new ProcessError(
            `${command} exited with code ${code}${signalName ? ` (signal ${signalName})` : ''}\n${stderrTail.join('\n')}`,
            code,
            signalName,
            [...stderrTail],
          ),
        );
      }
    });
  });
}

/**
 * Parses ffmpeg `-progress pipe:1` key=value lines into a 0-1 fraction, given the total
 * expected duration in milliseconds. Returns a stateful parser closure.
 */
export function makeFfmpegProgressParser(totalDurationMs: number): (lines: string[]) => number | undefined {
  let lastFraction: number | undefined;
  return (lines: string[]) => {
    for (const line of lines) {
      const [key, value] = line.split('=');
      if (key === 'out_time_ms' || key === 'out_time_us') {
        // ffmpeg has used both keys across versions; both are microseconds despite the name.
        const micros = Number(value);
        if (!Number.isNaN(micros) && totalDurationMs > 0) {
          lastFraction = Math.min(1, Math.max(0, micros / 1000 / totalDurationMs));
        }
      } else if (key === 'progress' && value === 'end') {
        lastFraction = 1;
      }
    }
    return lastFraction;
  };
}
