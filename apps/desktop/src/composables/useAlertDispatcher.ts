// ─── Alert Dispatcher ─────────────────────────────────────────────
// Routes alert events to the appropriate delivery channels based on
// user preferences: in-app toast, taskbar flash, native OS
// notifications, and sound. Respects per-session cooldown to prevent spam.

import type { AlertEvent, AlertSeverity, AlertType } from "@/stores/alerts";
import { useAlertsStore } from "@/stores/alerts";
import { usePreferencesStore } from "@/stores/preferences";
import { useToastStore } from "@/stores/toast";
import { logError, logInfo, logWarn } from "@/utils/logger";

// ── Cooldown tracking ────────────────────────────────────────────
// Maps "sessionId:alertType" → last-fired timestamp to enforce cooldown.
const cooldownMap = new Map<string, number>();
const PRUNE_INTERVAL = 5 * 60 * 1000; // 5 min
let lastPrune = Date.now();

/** Remove cooldown entries older than 10 minutes to prevent unbounded growth */
function pruneCooldownMap(maxAge = 10 * 60 * 1000) {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL) return;
  lastPrune = now;
  for (const [key, ts] of cooldownMap) {
    if (now - ts > maxAge) cooldownMap.delete(key);
  }
}

function isCoolingDown(sessionId: string, type: AlertType, cooldownSeconds: number): boolean {
  pruneCooldownMap();
  const key = `${sessionId}:${type}`;
  const lastFired = cooldownMap.get(key);
  if (!lastFired) return false;
  return Date.now() - lastFired < cooldownSeconds * 1000;
}

function recordCooldown(sessionId: string, type: AlertType) {
  cooldownMap.set(`${sessionId}:${type}`, Date.now());
}

// ── Severity mapping ─────────────────────────────────────────────
function severityForType(type: AlertType): AlertSeverity {
  switch (type) {
    case "ask-user":
      return "warning";
    case "session-error":
      return "error";
    case "test":
      return "info";
  }
}

// ── Channel: Taskbar flash ───────────────────────────────────────
async function flashTaskbar(severity: AlertSeverity) {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    // UserAttentionType: Critical=1 (flashes until clicked), Informational=2 (brief flash)
    const attentionType = severity === "error" ? 1 : 2;
    await win.requestUserAttention(attentionType);
  } catch {
    // Not in Tauri environment or window API unavailable
  }
}

// ── Channel: Native notification ─────────────────────────────────
// Uses @tauri-apps/plugin-notification for reliable OS notifications.
// Note: In dev mode, Windows may show the terminal icon (PowerShell/WT)
// instead of the TracePilot icon. Production builds use the correct icon.
async function sendNativeNotification(title: string, body: string) {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import("@tauri-apps/plugin-notification");

    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    if (granted) {
      sendNotification({ title, body, sound: "default", actionTypeId: "tracepilot-alert" });
    }
  } catch (e) {
    logWarn("[alerts] Native notification failed:", e);
  }
}

// ── Channel: Sound ───────────────────────────────────────────────
// Synthesizes a brief notification chime using Web Audio API.
let audioCtx: AudioContext | null = null;

function playAlertSound(severity: AlertSeverity) {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;

    // WebView2 may suspend AudioContext created outside a user gesture.
    // Resume it so background alerts can actually produce sound.
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    // Two-tone chime: frequency varies by severity
    const freqs = severity === "error" ? [440, 330] : severity === "warning" ? [660, 550] : [880, 660];
    const now = ctx.currentTime;

    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freqs[i];
      gain.gain.setValueAtTime(0.15, now + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.35);
    }
  } catch {
    // Web Audio API not available
  }
}

// ── Channel: In-app toast ────────────────────────────────────────
function showToast(title: string, body: string, severity: AlertSeverity) {
  const toast = useToastStore();
  const message = `${title}: ${body}`;
  switch (severity) {
    case "error":
      toast.error(message, { duration: 8000 });
      break;
    case "warning":
      toast.warning(message, { duration: 6000 });
      break;
    default:
      toast.info(message, { duration: 5000 });
      break;
  }
}

// ── Focus window on notification click ───────────────────────────
let notificationListenerRegistered = false;

/**
 * Register action types and a click listener for native notifications.
 * Must be called once at startup so that `onAction` fires when the user
 * clicks a TracePilot notification.
 */
export async function registerNotificationClickHandler() {
  if (notificationListenerRegistered) return;

  try {
    const { onAction, registerActionTypes } = await import("@tauri-apps/plugin-notification");

    // Register an action type so Windows routes clicks back to the app
    await registerActionTypes([
      {
        id: "tracepilot-alert",
        actions: [{ id: "focus", title: "Open TracePilot" }],
      },
    ]);

    await onAction(async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await win.unminimize();
        await win.setFocus();
      } catch {
        // Focus attempt failed — not critical
      }
    });

    // Only mark as registered after everything succeeded
    notificationListenerRegistered = true;
    logInfo("[alerts] Notification click handler registered");
  } catch (e) {
    logWarn("[alerts] Failed to register notification click handler:", e);
  }
}

// ── Focus detection ──────────────────────────────────────────────
// Returns true if the TracePilot window is currently focused.
// Defaults to false on error so that notifications are still sent in
// test/browser environments where the Tauri API is unavailable.
async function isWindowFocused(): Promise<boolean> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return await getCurrentWindow().isFocused();
  } catch {
    logWarn("[alerts] isFocused check failed — assuming unfocused");
    return false;
  }
}

// ── Main dispatch function ───────────────────────────────────────

export interface DispatchAlertOptions {
  type: AlertType;
  sessionId: string;
  sessionSummary?: string;
  title: string;
  body: string;
}

/**
 * Dispatch an alert through all enabled channels.
 * Always records in alert history. Respects per-session cooldown for
 * notification channels (toast, sound, taskbar flash, native notification).
 * External channels (taskbar flash, native notification) are additionally
 * suppressed when the app window is focused.
 * Returns the created AlertEvent (always), or null if the master switch or
 * type-specific toggle is off.
 */
export function dispatchAlert(options: DispatchAlertOptions): AlertEvent | null {
  const prefs = usePreferencesStore();

  // Master switch
  if (!prefs.alertsEnabled) return null;

  // Check type-specific toggle
  switch (options.type) {
    case "ask-user":
      if (!prefs.alertsOnAskUser) return null;
      break;
    case "session-error":
      if (!prefs.alertsOnSessionError) return null;
      break;
    case "test":
      // Test alerts always pass the type toggle
      break;
  }

  const severity = severityForType(options.type);
  const alertsStore = useAlertsStore();

  // Bug E fix: always record in alert history regardless of cooldown.
  // Cooldown only gates notification channels (toast, sound, flash, native).
  const alert = alertsStore.push({
    type: options.type,
    severity,
    sessionId: options.sessionId,
    sessionSummary: options.sessionSummary,
    title: options.title,
    body: options.body,
  });

  // Bug G fix: ask-user bypasses cooldown entirely — per-callKey dedup in
  // the watcher is the definitive guard. Cooldown still protects session-error
  // against notification spam from rapidly oscillating error counts.
  const bypassCooldown = options.type === "ask-user" || options.type === "test";
  const isOnCooldown =
    !bypassCooldown &&
    isCoolingDown(options.sessionId, options.type, prefs.alertsCooldownSeconds);

  if (!isOnCooldown) {
    recordCooldown(options.sessionId, options.type);
  }

  logInfo(`[alerts] Dispatching ${options.type} alert for session ${options.sessionId}`);

  if (!isOnCooldown) {
    // In-app toast — shows when not on cooldown (internal, not focus-gated)
    showToast(options.title, options.body, severity);

    // Sound — always plays when enabled, not focus-gated (user preference)
    if (prefs.alertsSoundEnabled) {
      playAlertSound(severity);
    }

    // Bug F fix: external channels (taskbar flash, native notification) are
    // suppressed when the app window is focused — the user is already present.
    void (async () => {
      const focused = await isWindowFocused();
      if (!focused) {
        if (prefs.alertsTaskbarFlash) {
          flashTaskbar(severity).catch((e) => logWarn("[alerts] Taskbar flash failed:", e));
        }
        if (prefs.alertsNativeNotifications) {
          sendNativeNotification(options.title, options.body).catch((e) =>
            logError("[alerts] Native notification failed:", e),
          );
        }
      }
    })();
  }

  return alert;
}

/**
 * Send a test alert to verify notification channels are working.
 * Staggers each channel with a delay so the user can confirm each one.
 * Bypasses cooldown and type-specific toggles.
 */
export function dispatchTestAlert(): AlertEvent {
  const prefs = usePreferencesStore();
  const alertsStore = useAlertsStore();

  const alert = alertsStore.push({
    type: "test",
    severity: "info",
    sessionId: "test",
    sessionSummary: "Test Session",
    title: "Test Alert",
    body: "This is a test alert from TracePilot.",
  });

  // 1. In-app toast — immediate
  showToast("Test Alert", "✓ In-app toast is working!", "info");

  // 2. Sound — after 1.5s
  if (prefs.alertsSoundEnabled) {
    setTimeout(() => {
      playAlertSound("info");
      showToast("Test Alert", "✓ Sound played!", "info");
    }, 1500);
  }

  // 3. Taskbar flash — after 3s
  if (prefs.alertsTaskbarFlash) {
    setTimeout(() => {
      flashTaskbar("warning").catch(() => {});
      showToast("Test Alert", "✓ Taskbar flash sent!", "info");
    }, 3000);
  }

  // 4. Native notification — after 5s
  if (prefs.alertsNativeNotifications) {
    setTimeout(() => {
      sendNativeNotification(
        "TracePilot — Test Alert",
        "If you see this, native notifications are working!",
      ).catch(() => {});
      showToast("Test Alert", "✓ Native notification sent!", "info");
    }, 5000);
  }

  return alert;
}
