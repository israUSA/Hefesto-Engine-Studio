/** Formats a millisecond duration as compact Spanish text, e.g. "36 min", "1 h 12 min", "<1 min". */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0 min';
  }
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) {
    return '<1 min';
  }
  if (totalMin < 60) {
    return `${totalMin} min`;
  }
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min > 0 ? `${hours} h ${min} min` : `${hours} h`;
}

/** Formats a point in time as a 24h HH:MM clock, e.g. "19:24". */
export function formatClockTime(at: number | Date): string {
  const date = typeof at === 'number' ? new Date(at) : at;
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Formats a short mm:ss countdown, e.g. "01:48", for an in-progress job. */
export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
