import { Injectable, OnDestroy, signal } from '@angular/core';
import type { JobDto, LogEntry, ProductionSummary, QueueState, ServerEvent, Telemetry } from '@hefesto/shared-types';

const LOG_RING_SIZE = 2000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15000;

/**
 * WebSocket client for /ws. Reconnects with exponential backoff and keeps
 * the latest server state in signals so components can just read them.
 */
@Injectable({ providedIn: 'root' })
export class LiveEvents implements OnDestroy {
  readonly connected = signal(false);
  readonly queueState = signal<QueueState | null>(null);
  readonly jobsById = signal<Record<string, JobDto>>({});
  readonly logs = signal<LogEntry[]>([]);
  readonly telemetry = signal<Telemetry | null>(null);
  readonly productions = signal<Record<string, ProductionSummary>>({});

  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;

  constructor() {
    this.connect();
  }

  private connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;
    try {
      this.socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener('open', () => {
      this.connected.set(true);
      this.reconnectAttempt = 0;
    });

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });

    this.socket.addEventListener('close', () => {
      this.connected.set(false);
      if (!this.closedByUs) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener('error', () => {
      this.socket?.close();
    });
  }

  private handleMessage(raw: string): void {
    let event: ServerEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    switch (event.type) {
      case 'queue':
        this.queueState.set(event.state);
        break;
      case 'job':
        this.jobsById.update((byId) => ({ ...byId, [event.job.id]: event.job }));
        break;
      case 'progress':
        this.jobsById.update((byId) => {
          const existing = byId[event.jobId];
          if (!existing) {
            return byId;
          }
          return { ...byId, [event.jobId]: { ...existing, progress: event.value } };
        });
        break;
      case 'production':
        this.productions.update((byId) => ({ ...byId, [event.production.id]: event.production }));
        break;
      case 'log':
        this.logs.update((list) => {
          const next = [...list, event.entry];
          return next.length > LOG_RING_SIZE ? next.slice(next.length - LOG_RING_SIZE) : next;
        });
        break;
      case 'telemetry':
        this.telemetry.set(event.telemetry);
        break;
    }
  }

  /**
   * Merges a historical page (from GET /api/logs) into the live ring buffer,
   * de-duplicated by id. Used once on mount by screens that show log history.
   */
  seedLogs(entries: LogEntry[]): void {
    if (entries.length === 0) {
      return;
    }
    this.logs.update((list) => {
      const byId = new Map(list.map((entry) => [entry.id, entry]));
      for (const entry of entries) {
        byId.set(entry.id, entry);
      }
      const merged = [...byId.values()].sort((a, b) => a.id - b.id);
      return merged.length > LOG_RING_SIZE ? merged.slice(merged.length - LOG_RING_SIZE) : merged;
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  ngOnDestroy(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
  }
}
