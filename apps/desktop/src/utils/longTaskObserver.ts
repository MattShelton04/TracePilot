/**
 * Long Task Observer — detects >50ms main-thread blocks in development.
 *
 * Uses the W3C Long Tasks API (PerformanceObserver with type "longtask").
 * Enabled only in dev mode to avoid noise in production builds.
 *
 * Usage: call `startLongTaskObserver()` once from main.ts after app mount.
 */

let observer: PerformanceObserver | null = null;

export function startLongTaskObserver(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  if (observer) return;

  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          console.warn(
            `[perf] Long task: ${entry.duration.toFixed(1)}ms ` +
              `(${entry.name}, at ${entry.startTime.toFixed(0)}ms)`,
          );
        }
      }
    });

    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    // PerformanceObserver 'longtask' not supported in this WebView
  }
}

export function stopLongTaskObserver(): void {
  observer?.disconnect();
  observer = null;
}
