import { getCurrentInstance, onMounted } from "vue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PerfEntry {
  name: string;
  duration: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Internal log (bounded ring buffer)
// ---------------------------------------------------------------------------

const MAX_LOG_SIZE = 1000;
const SLOW_MOUNT_THRESHOLD_MS = 50;
const perfLog: PerfEntry[] = [];

function record(name: string, duration: number): void {
  perfLog.push({ name, duration, timestamp: Date.now() });
  if (perfLog.length > MAX_LOG_SIZE) {
    perfLog.splice(0, MAX_LOG_SIZE / 2);
  }
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Lightweight component performance monitor.
 *
 * Records mount duration automatically, and exposes `mark`, `measure`, and
 * `timeAsync` helpers that write to the Performance API AND the internal
 * perf log (accessible via `getPerfLog()` / `dumpPerfSummary()` in the
 * browser console).
 *
 * Dev-only: the log is in-memory and never persisted.
 */
export function usePerfMonitor(label?: string) {
  const instance = getCurrentInstance();
  const componentName = label ?? instance?.type.__name ?? "Unknown";
  const mountStart = performance.now();

  onMounted(() => {
    const duration = performance.now() - mountStart;
    record(`${componentName}:mount`, duration);

    if (import.meta.env.DEV && duration > SLOW_MOUNT_THRESHOLD_MS) {
      console.warn(`[perf] Slow mount: ${componentName} took ${duration.toFixed(1)}ms`);
    }
  });

  /** Place a Performance API mark. */
  function mark(name: string): void {
    performance.mark(`${componentName}:${name}`);
  }

  /** Measure between a previous `mark` and now. */
  function measure(name: string, startMark: string): number {
    try {
      const m = performance.measure(`${componentName}:${name}`, `${componentName}:${startMark}`);
      record(`${componentName}:${name}`, m.duration);
      return m.duration;
    } catch {
      return -1;
    }
  }

  /** Time an async operation and record the duration. */
  async function timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      record(`${componentName}:${name}`, performance.now() - start);
      return result;
    } catch (error) {
      record(`${componentName}:${name}:error`, performance.now() - start);
      throw error;
    }
  }

  return { mark, measure, timeAsync };
}

// ---------------------------------------------------------------------------
// Console-accessible helpers (window.__TRACEPILOT_PERF__)
// ---------------------------------------------------------------------------

/** Retrieve the raw performance log. */
export function getPerfLog(): readonly PerfEntry[] {
  return perfLog;
}

/** Return only entries slower than `thresholdMs`. */
export function getSlowEntries(thresholdMs = 50): PerfEntry[] {
  return perfLog.filter((e) => e.duration > thresholdMs);
}

/** Clear the log. */
export function clearPerfLog(): void {
  perfLog.length = 0;
}

/** Print a grouped summary table to the console. */
export function dumpPerfSummary(): void {
  const grouped = new Map<string, number[]>();
  for (const entry of perfLog) {
    const key = entry.name.split(":").slice(0, 2).join(":");
    const durations = grouped.get(key) ?? [];
    durations.push(entry.duration);
    grouped.set(key, durations);
  }

  const summary = [...grouped.entries()].map(([name, durations]) => ({
    name,
    count: durations.length,
    avg: +(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1),
    max: +Math.max(...durations).toFixed(1),
    min: +Math.min(...durations).toFixed(1),
  }));

  console.table(summary.sort((a, b) => b.avg - a.avg));
}

// Expose on window for easy console access during development
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__TRACEPILOT_PERF__ = {
    getPerfLog,
    getSlowEntries,
    clearPerfLog,
    dumpPerfSummary,
  };
}
