import { getCurrentInstance, onMounted } from "vue";

// ---------------------------------------------------------------------------
// Render-budget composable — Wave 122
// ---------------------------------------------------------------------------
//
// Measures the delta between `onMounted` and the *next committed paint*
// (approximated by a double `requestAnimationFrame`). If the delta exceeds
// the caller-supplied budget, emits a dev-only `console.warn` with the
// budget key, actual, and budget.
//
// Design notes:
//   - Instrumentation is gated behind `import.meta.env.DEV` so that
//     production builds tree-shake the entire measurement path down to a
//     no-op (Vite rewrites `import.meta.env.DEV` to `false`, and the
//     conditional body becomes dead code eliminated by esbuild/rollup).
//   - An additional runtime escape hatch `window.__tracepilot_perf` is
//     honoured in non-DEV builds so QA can flip measurement on in a shipped
//     binary via devtools without a rebuild.
//   - No dependencies, no store, no ring-buffer — this is pure observation.
//     If you want history, use `usePerfMonitor` which is the richer cousin.

export interface RenderBudgetOptions {
  /** Stable identifier from `perf-budget.json` `render.*` (e.g. "render.sessionListViewMs"). */
  key: string;
  /** Budget ceiling in milliseconds. Exceeding this triggers a dev warning. */
  budgetMs: number;
  /**
   * Optional human-readable label for the warning. Defaults to the current
   * component's `__name` or the key.
   */
  label?: string;
}

interface PerfWindow {
  __tracepilot_perf?: boolean;
}

function isInstrumentationEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as PerfWindow).__tracepilot_perf);
}

/**
 * Record render-time against a named budget. No-op in production unless
 * `window.__tracepilot_perf` is truthy.
 *
 * Timing strategy:
 *   1. `onMounted` fires after the component's VNodes have been patched
 *      into the DOM but before the browser paints.
 *   2. A single `requestAnimationFrame` callback runs *before* the next
 *      paint — measuring here captures layout cost but not paint.
 *   3. The second nested `rAF` callback runs *after* the paint has been
 *      committed — this is the earliest signal that the user actually
 *      sees pixels, and it is the value we compare against the budget.
 */
export function useRenderBudget(options: RenderBudgetOptions): void {
  if (!isInstrumentationEnabled()) return;

  const instance = getCurrentInstance();
  const label = options.label ?? instance?.type.__name ?? options.key;

  onMounted(() => {
    const mountedAt = performance.now();

    // Double-rAF: first callback runs before paint, second runs after.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const actual = performance.now() - mountedAt;
        if (actual > options.budgetMs) {
          // eslint-disable-next-line no-console
          console.warn(
            `[render-budget] ${label} exceeded budget: ${actual.toFixed(1)}ms > ${options.budgetMs}ms (key=${options.key})`,
          );
        }
      });
    });
  });
}
