/**
 * useWindowRole — Detect the current window's role from its Tauri webview label.
 *
 * In a multi-window setup, the "main" window owns bootstrap, SDK connection,
 * and global state. Child windows (viewers, monitors) are lightweight and must
 * not duplicate those responsibilities.
 *
 * Role is determined from `getCurrentWebviewWindow().label`:
 *   - "main"            → WindowRole.Main
 *   - "viewer-<id>"     → WindowRole.Viewer
 *   - "monitor"         → WindowRole.Monitor
 *   - anything else     → WindowRole.Main (safe fallback)
 */
import { ref } from "vue";

export type WindowRole = "main" | "viewer" | "monitor";

const role = ref<WindowRole>("main");
const windowLabel = ref("main");
/** For viewer windows: the short session ID extracted from the label */
const viewerSessionId = ref<string | null>(null);
let resolved = false;

/**
 * Resolve the window role from the Tauri webview label.
 * Safe to call multiple times — only resolves once.
 * In browser dev mode (no Tauri API), defaults to "main".
 */
export async function resolveWindowRole(): Promise<void> {
  if (resolved) return;
  resolved = true;

  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = getCurrentWebviewWindow();
    windowLabel.value = win.label;

    if (win.label.startsWith("viewer-")) {
      role.value = "viewer";
      // Prefer full session ID from URL query param (set by Rust open_session_window),
      // fall back to short ID extracted from label
      const params = new URLSearchParams(window.location.search);
      viewerSessionId.value = params.get("sessionId") ?? win.label.replace("viewer-", "");
    } else if (win.label === "monitor") {
      role.value = "monitor";
    } else {
      role.value = "main";
    }
  } catch {
    // Browser dev mode or Tauri API not available — default to main
    role.value = "main";
    windowLabel.value = "main";
  }
}

export function useWindowRole() {
  return {
    /** Current window role (reactive) */
    role,
    /** Raw Tauri webview label (reactive) */
    windowLabel,
    /** For viewer windows: the short session ID from the label */
    viewerSessionId,
    /** Whether this window is the main (primary) window */
    isMain: () => role.value === "main",
    /** Whether this window is a child (viewer or monitor) */
    isChild: () => role.value !== "main",
    /** Whether this window is a viewer */
    isViewer: () => role.value === "viewer",
  };
}
