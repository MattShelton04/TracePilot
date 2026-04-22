/**
 * Central browser / test fallback layer for non-Tauri contexts.
 *
 * In the real Tauri runtime every helper defers to the corresponding Tauri
 * plugin. In browser dev mode, Storybook, or vitest we short-circuit to a
 * safe no-op or a `prompt()`-based shim. Heavy `@tauri-apps/*` imports stay
 * behind the `isTauri()` gate so they tree-shake out of non-Tauri bundles
 * (and, conversely, the mock branches below are `undefined`-ish at runtime
 * in Tauri and compile down to dead code once the guard evaluates true).
 *
 * IPC command mocking lives in `@tracepilot/client` (see
 * `packages/client/src/internal/mockData.ts` — exposed through the auto
 * `createInvoke` fallback). This module covers the non-command plugin
 * surface (dialog, opener, event, log, webviewWindow, app version) that
 * previously had per-call-site `"__TAURI_INTERNALS__" in window` checks.
 *
 * Usage pattern:
 *
 *   import { isTauri, maybeMock, promptForPath } from "@/lib/mocks";
 *
 *   return maybeMock(
 *     () => promptForPath("Select file:"),
 *     async () => {
 *       const { open } = await import("@tauri-apps/plugin-dialog");
 *       return (await open({ title: "Select file" })) ?? null;
 *     },
 *   );
 */

/**
 * Detect whether we are running inside Tauri's webview.
 *
 * Checks for the `__TAURI_INTERNALS__` global that the Tauri runtime
 * injects before user code runs. This mirrors `@tracepilot/client`'s
 * `isTauri()` but lives here so the desktop shim layer has zero
 * dependency on the IPC client package (keeps test mocks simpler).
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Branch between a browser-side mock and the real Tauri plugin call.
 *
 * `mockValue` may be an eager value or a lazy producer — prefer the lazy
 * form when the mock needs to touch `window` (prompt/localStorage), so it
 * never executes in SSR-ish environments.
 */
export async function maybeMock<T>(
  mockValue: T | (() => T | Promise<T>),
  tauriFn: () => Promise<T>,
): Promise<T> {
  if (isTauri()) {
    return tauriFn();
  }
  return typeof mockValue === "function"
    ? await (mockValue as () => T | Promise<T>)()
    : mockValue;
}

/**
 * Prompt-based fallback for the Tauri dialog plugin (`open` / `save`).
 *
 * Strips null bytes and ASCII control characters, trims whitespace.
 * Returns `null` if the user cancels or provides an empty string.
 */
export function promptForPath(title: string, defaultPath = ""): string | null {
  if (typeof window === "undefined" || typeof window.prompt !== "function") {
    return null;
  }
  const raw = window.prompt(title, defaultPath);
  if (raw === null) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars for path sanitization
  const cleaned = raw.replace(/[\x00-\x1f]/g, "").trim();
  return cleaned || null;
}
