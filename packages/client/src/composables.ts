/**
 * Composables and utilities — Renderer hooks and performance instrumentation.
 *
 * IPC-level utilities for tracking call times, managing performance logs,
 * and environment detection (Tauri vs. non-Tauri).
 */

export type { InvokeFn, InvokeOptions, IpcPerfHook } from "./invoke.js";

// IPC performance instrumentation utilities
export {
  clearIpcPerfLog,
  disablePerfTracing,
  enablePerfTracing,
  getIpcPerfLog,
  isTauri,
} from "./invoke.js";
