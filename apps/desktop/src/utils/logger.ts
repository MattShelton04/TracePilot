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
  if (log) await log.debug(msg);
  else console.debug(msg);
}
export async function info(msg: string): Promise<void> {
  const log = await ensureLog();
  if (log) await log.info(msg);
  else console.info(msg);
}
export async function warn(msg: string): Promise<void> {
  const log = await ensureLog();
  if (log) await log.warn(msg);
  else console.warn(msg);
}
export async function error(msg: string): Promise<void> {
  const log = await ensureLog();
  if (log) await log.error(msg);
  else console.error(msg);
}
export async function trace(msg: string): Promise<void> {
  const log = await ensureLog();
  if (log) await log.trace(msg);
  else console.debug(msg);
}
