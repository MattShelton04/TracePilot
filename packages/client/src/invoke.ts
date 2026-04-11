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

/**
 * Call a Tauri plugin command.  Use this only when inside Tauri;
 * guard with `isTauri()` first.
 *
 * PERF: Every IPC call is timed. Calls exceeding 100 ms are logged as warnings.
 * Access the log via `getIpcPerfLog()` in the browser console.
 */
export async function invokePlugin<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  const start = performance.now();
  try {
    const result = await tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
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

export type InvokeFn = <T>(cmd: CommandName, args?: Record<string, unknown>) => Promise<T>;
type MockFallback = <T>(cmd: CommandName, args?: Record<string, unknown>) => T | Promise<T>;

/**
 * Create a typed invoke function for a client module.
 *
 * - In Tauri → delegates to `invokePlugin` (perf-instrumented).
 * - Outside Tauri with `fallback` → calls the fallback for mock data.
 * - Outside Tauri without `fallback` → throws with a descriptive error.
 */
export function createInvoke(domain: string, fallback?: MockFallback): InvokeFn {
  return async <T>(cmd: CommandName, args?: Record<string, unknown>): Promise<T> => {
    if (isTauri()) {
      return invokePlugin<T>(cmd, args);
    }
    if (fallback) {
      console.warn(`[TracePilot] Not in Tauri — returning mock data for "${cmd}"`);
      return fallback<T>(cmd, args);
    }
    console.warn(`[TracePilot] Not in Tauri — no mock for ${domain} "${cmd}"`);
    throw new Error(`No mock data for ${domain} command: ${cmd}`);
  };
}
