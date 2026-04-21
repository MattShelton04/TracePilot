/**
 * Shared Tauri invoke helper — single source of truth for calling the
 * `plugin:tracepilot|*` Tauri plugin commands with automatic mock fallback
 * when running outside the Tauri webview (dev/test mode).
 */

/** Detect whether we are running inside Tauri's webview. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ---------------------------------------------------------------------------
// IPC performance instrumentation
// ---------------------------------------------------------------------------

interface IpcPerfEntry {
  cmd: string;
  duration: number;
  timestamp: number;
  failed: boolean;
}

const IPC_SLOW_THRESHOLD_MS = 100;
const IPC_MAX_LOG = 500;
const ipcPerfLog: IpcPerfEntry[] = [];

function recordIpcTiming(cmd: string, startTime: number, failed = false): void {
  const duration = performance.now() - startTime;
  ipcPerfLog.push({ cmd, duration, timestamp: Date.now(), failed });

  // Keep the log bounded to avoid memory growth
  if (ipcPerfLog.length > IPC_MAX_LOG) {
    ipcPerfLog.splice(0, IPC_MAX_LOG / 2);
  }

  if (duration > IPC_SLOW_THRESHOLD_MS) {
    const prefix = failed ? "[ipc:FAIL]" : "[ipc:SLOW]";
    console.warn(`${prefix} ${cmd} took ${duration.toFixed(1)}ms`);
  }
}

/** Retrieve the IPC performance log (for dev tools / debugging). */
export function getIpcPerfLog(): readonly IpcPerfEntry[] {
  return ipcPerfLog;
}

/** Clear the IPC performance log. */
export function clearIpcPerfLog(): void {
  ipcPerfLog.length = 0;
}

// Expose on window for automation / skill access (mirrors __TRACEPILOT_PERF__)
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__TRACEPILOT_IPC_PERF__ = {
    getIpcPerfLog,
    clearIpcPerfLog,
  };
}

// ---------------------------------------------------------------------------
// Cancellation / timeout support
// ---------------------------------------------------------------------------

/**
 * Optional per-call controls for `createInvoke` / `invokePlugin`.
 *
 * NOTE: Tauri core exposes no cancellation API, so `signal` / `timeoutMs`
 * short-circuit the **JS-side await only**. The underlying Rust work
 * continues to completion; its result (or error) is discarded once the
 * outer promise has settled.
 */
export type InvokeOptions = { signal?: AbortSignal; timeoutMs?: number };

function abortReason(signal: AbortSignal): unknown {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  if (reason !== undefined) return reason;
  return new DOMException("The operation was aborted.", "AbortError");
}

function resolveSignal(options?: InvokeOptions): AbortSignal | undefined {
  if (!options) return undefined;
  const { signal, timeoutMs } = options;
  if (timeoutMs === undefined) return signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  return AbortSignal.any([signal, timeoutSignal]);
}

/**
 * Race `promise` against `signal`. If the signal is (or becomes) aborted, the
 * returned promise rejects with the abort reason — but the original promise
 * is left running (its resolution is simply ignored on the JS side).
 *
 * When `timeoutMs` is supplied and the abort is due to the timeout signal, we
 * surface a `TimeoutError` DOMException instead of the raw internal reason
 * to give callers a clear, stable failure mode.
 */
function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timeoutMs !== undefined) {
        reject(new DOMException(`IPC timeout after ${timeoutMs}ms`, "TimeoutError"));
      } else {
        reject(abortReason(signal));
      }
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Call a Tauri plugin command.  Use this only when inside Tauri;
 * guard with `isTauri()` first.
 *
 * PERF: Every IPC call is timed. Calls exceeding 100 ms are logged as warnings.
 * Access the log via `getIpcPerfLog()` in the browser console.
 */
export async function invokePlugin<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<T> {
  const start = performance.now();

  // Fast-path: honour already-aborted signals without importing Tauri.
  if (options?.signal?.aborted) {
    recordIpcTiming(cmd, start, true);
    throw abortReason(options.signal);
  }

  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  const signal = resolveSignal(options);

  try {
    const call = tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
    // NOTE: Tauri core has no cancel API — on abort we short-circuit the
    // JS-side await only; the Rust command still runs and its result is
    // discarded. Keep this in mind when commands have side-effects.
    const result = signal ? await raceWithSignal(call, signal, options?.timeoutMs) : await call;
    recordIpcTiming(cmd, start);
    return result;
  } catch (error) {
    recordIpcTiming(cmd, start, true);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Invoke factory — eliminates per-module boilerplate
// ---------------------------------------------------------------------------

import type { CommandName } from "./commands.js";

export type InvokeFn = <T>(
  cmd: CommandName,
  args?: Record<string, unknown>,
  options?: InvokeOptions,
) => Promise<T>;
type MockFallback = <T>(cmd: CommandName, args?: Record<string, unknown>) => T | Promise<T>;

/**
 * Create a typed invoke function for a client module.
 *
 * - In Tauri → delegates to `invokePlugin` (perf-instrumented).
 * - Outside Tauri with `fallback` → calls the fallback for mock data.
 * - Outside Tauri without `fallback` → throws with a descriptive error.
 *
 * Cancellation: pass `options.signal` and/or `options.timeoutMs` to abort
 * the outer await. See `InvokeOptions` for caveats.
 */
export function createInvoke(domain: string, fallback?: MockFallback): InvokeFn {
  return async <T>(
    cmd: CommandName,
    args?: Record<string, unknown>,
    options?: InvokeOptions,
  ): Promise<T> => {
    if (isTauri()) {
      return invokePlugin<T>(cmd, args, options);
    }
    // Mocks are synchronous/instant, so we only honour pre-aborted signals
    // and skip the timeout race entirely. Revisit if mocks become async.
    if (options?.signal?.aborted) {
      throw abortReason(options.signal);
    }
    if (fallback) {
      console.warn(`[TracePilot] Not in Tauri — returning mock data for "${cmd}"`);
      return fallback<T>(cmd, args);
    }
    console.warn(`[TracePilot] Not in Tauri — no mock for ${domain} "${cmd}"`);
    throw new Error(`No mock data for ${domain} command: ${cmd}`);
  };
}
