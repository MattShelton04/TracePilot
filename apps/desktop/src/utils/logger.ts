import { attachConsole, debug, error, info, trace, warn } from '@tauri-apps/plugin-log';

let detach: (() => void) | null = null;

/**
 * Initialize logging — call once from main.ts AFTER mount.
 *
 * - Subscribes to Rust-side log events and forwards them to the
 *   webview devtools console (via `attachConsole`).
 * - Re-exports `info`, `warn`, `error`, `debug`, `trace` so frontend
 *   code can send structured log entries to the backend log file.
 */
export async function initLogging(): Promise<void> {
  try {
    detach = await attachConsole();
  } catch (e) {
    // Plugin may not be ready (e.g., browser-only dev mode)
    console.warn('[TracePilot] Failed to attach log console:', e);
  }
}

export function teardownLogging(): void {
  detach?.();
}

// Re-export for explicit frontend → backend logging
export { debug, error, info, trace, warn };
