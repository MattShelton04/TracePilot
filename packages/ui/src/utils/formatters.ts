/**
 * Unified formatting utilities for TracePilot UI.
 * Replaces per-component formatting functions to ensure consistency.
 */

/** Format milliseconds into a human-readable duration string. */
export function formatDuration(ms?: number | null): string {
  if (ms == null || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Format an ISO date string to locale date+time. */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

/** Format an ISO date string to locale time only (HH:MM:SS). */
export function formatTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Format an ISO date string to a relative time string (e.g. "3m ago"). */
export function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Abbreviate large numbers (1200 → "1.2K", 1500000 → "1.5M"). */
export function formatNumber(n?: number | null): string {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/** Format a cost value as USD. */
export function formatCost(cost?: number | null): string {
  if (cost == null) return "$0.00";
  return `$${cost.toFixed(4)}`;
}

/** Truncate a string to a max length, appending ellipsis. */
export function truncateText(text: string, maxLen = 1000): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}
