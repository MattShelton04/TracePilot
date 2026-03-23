/**
 * Unified formatting utilities for TracePilot UI.
 * Replaces per-component formatting functions to ensure consistency.
 */

/** Format milliseconds into a human-readable duration string. */
export function formatDuration(ms?: number | null): string {
  if (ms == null || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms * 100) / 100}ms`;
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${Math.floor(seconds)}s`;
  // Show one decimal for sub-minute durations (e.g. "2.1s")
  return seconds % 1 === 0 ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

/** Format an ISO date string to locale date+time. */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString();
}

/** Format an ISO date string to locale time only (HH:MM:SS). */
export function formatTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Format a date to a relative time string (e.g. "3m ago").
 *  Accepts an ISO date string or a Unix timestamp in **seconds**. */
export function formatRelativeTime(value?: string | number | null): string {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  const ms = typeof value === 'number'
    ? value * 1000
    : new Date(value).getTime();
  if (Number.isNaN(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Abbreviate large numbers (1200 → "1.2K", 1500000 → "1.5M"). */
export function formatNumber(n?: number | null): string {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/** Format a cost value as USD with comma separators. */
export function formatCost(cost?: number | null): string {
  if (cost == null) return '$0.00';
  return `$${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Truncate a string to a max length, appending ellipsis. */
export function truncateText(text: string, maxLen = 1000): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

/** Format a live duration (in-progress timer) as clean whole seconds.
 *  Floors to nearest second to avoid fractional ticking. */
export function formatLiveDuration(ms?: number | null): string {
  if (ms == null || ms < 0) return '';
  // Floor to whole seconds for clean second-by-second ticking
  const floored = Math.floor(ms / 1000) * 1000;
  return formatDuration(floored);
}

/** Format a rate (0–1) as a percentage string (e.g. 0.95 → "95.0%"). */
export function formatRate(rate?: number | null): string {
  if (rate == null) return '0.0%';
  return `${(rate * 100).toFixed(1)}%`;
}

/** Format a percentage value (0–100) as a string (e.g. 95.1 → "95.1%"). */
export function formatPercent(value?: number | null): string {
  if (value == null) return '0.0%';
  return `${value.toFixed(1)}%`;
}

/** Format an ISO date as a short M/D string (e.g. "3/19"). Uses UTC. */
export function formatDateShort(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** Format a date as "Mar 19, 2026". Uses UTC.
 *  Accepts an ISO date string or a Unix timestamp in **seconds**. */
export function formatDateMedium(value?: string | number | null): string {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  const d = typeof value === 'number'
    ? new Date(value * 1000)
    : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Format a number with locale thousand separators (e.g. 1234 → "1,234"). */
export function formatNumberFull(n?: number | null): string {
  if (n == null) return '0';
  return n.toLocaleString('en-US');
}

/** Format a byte count as a human-readable string (e.g. 1536 → "1.5 KB"). */
export function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
