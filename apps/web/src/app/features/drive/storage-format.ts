const decimal = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });

/** "318 GB", "1,6 TB", "820 MB": sizes as the Drive view shows them. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit >= 3 ? decimal.format(value) : Math.round(value)} ${units[unit]}`;
}

/** "hace 4 min", "hace 2 h", "hace 3 días". */
export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`;
  const days = Math.round(s / 86_400);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}
