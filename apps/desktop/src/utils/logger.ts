const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let tauriLog: typeof import('@tauri-apps/plugin-log') | null = null;

async function ensureLog() {
  if (!isTauri) return null;
  if (!tauriLog) tauriLog = await import('@tauri-apps/plugin-log');
  return tauriLog;
}

let detach: (() => void) | null = null;

/**
 * Initialize logging — call once from main.ts AFTER mount.
 *
 * - Subscribes to Rust-side log events and forwards them to the
 *   webview devtools console (via `attachConsole`).
 */
export async function initLogging(): Promise<void> {
  try {
    const log = await ensureLog();
    if (log) detach = await log.attachConsole();
  } catch (e) {
    // Plugin may not be ready (e.g., browser-only dev mode)
    console.warn('[TracePilot] Failed to attach log console:', e);
  }
}

export function teardownLogging(): void {
  detach?.();
}

// Browser-safe re-exports: no-op in browser, write to backend log file in Tauri
export async function debug(msg: string): Promise<void> {
  const log = await ensureLog();
  if (log) await log.debug(msg); else console.debug(msg);
}
export async function info(msg: string): Promise<void> {
  const log = await ensureLog();
  if (log) await log.info(msg); else console.info(msg);
}
export async function warn(msg: string): Promise<void> {
  const log = await ensureLog();
  if (log) await log.warn(msg); else console.warn(msg);
}
export async function error(msg: string): Promise<void> {
  const log = await ensureLog();
  if (log) await log.error(msg); else console.error(msg);
}
export async function trace(msg: string): Promise<void> {
  const log = await ensureLog();
  if (log) await log.trace(msg); else console.debug(msg);
}

// ── Synchronous logging facades ─────────────────────────────────
// Drop-in replacements for console.{debug,info,warn,error}.
//
// 1. Always forward to the original console method so devtools
//    experience (stack traces, object inspection) is fully preserved.
// 2. In Tauri, fire-and-forget the message to the backend log file.
//    In non-Tauri (browser-only), skip the async path to avoid
//    double-logging (the async wrappers above fall back to console.*).

/** Serialize extra arguments for the backend log (string-only). */
export function stringifyExtra(v: unknown): string {
  if (v instanceof Error) return v.stack ?? v.message;
  if (typeof v === 'string') return v;
  if (v === undefined) return 'undefined';
  try {
    const json = JSON.stringify(v);
    // JSON.stringify returns undefined for top-level symbols, functions,
    // and undefined values — fall back to String() for those.
    return json !== undefined ? json : String(v);
  } catch {
    try { return String(v); } catch { return '[unserializable]'; }
  }
}

function buildLogMessage(msg: string, extra: unknown[]): string {
  return extra.length
    ? `${msg} ${extra.map(stringifyExtra).join(' ')}`
    : msg;
}

export function logDebug(msg: string, ...extra: unknown[]): void {
  console.debug(msg, ...extra);
  if (!isTauri) return;
  void debug(buildLogMessage(msg, extra)).catch(() => {});
}

export function logInfo(msg: string, ...extra: unknown[]): void {
  console.info(msg, ...extra);
  if (!isTauri) return;
  void info(buildLogMessage(msg, extra)).catch(() => {});
}

export function logWarn(msg: string, ...extra: unknown[]): void {
  console.warn(msg, ...extra);
  if (!isTauri) return;
  void warn(buildLogMessage(msg, extra)).catch(() => {});
}

export function logError(msg: string, ...extra: unknown[]): void {
  console.error(msg, ...extra);
  if (!isTauri) return;
  void error(buildLogMessage(msg, extra)).catch(() => {});
}
