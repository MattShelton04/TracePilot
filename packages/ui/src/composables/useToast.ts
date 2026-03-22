import { ref } from "vue";
import type { Ref } from "vue";

export interface ToastOptions {
  message: string;
  title?: string;
  description?: string;
  type?: "success" | "error" | "warning" | "info";
  /** Auto-dismiss delay in ms. Default 3000. Use 0 for persistent toasts. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface Toast extends Required<Pick<ToastOptions, "message" | "type">> {
  id: string;
  title?: string;
  description?: string;
  duration: number;
  action?: { label: string; onClick: () => void };
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/*  Module-level singleton state                                       */
/* ------------------------------------------------------------------ */

const toasts = ref<Toast[]>([]);
let counter = 0;

const MAX_VISIBLE = 5;
const DEFAULT_DURATION = 3000;

interface TimerEntry {
  handle: ReturnType<typeof setTimeout>;
  remaining: number;
  startedAt: number;
}

const timers = new Map<string, TimerEntry>();

function scheduleRemoval(id: string, delay: number) {
  const handle = setTimeout(() => {
    timers.delete(id);
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, delay);
  timers.set(id, { handle, remaining: delay, startedAt: Date.now() });
}

function removeToast(id: string) {
  const entry = timers.get(id);
  if (entry) {
    clearTimeout(entry.handle);
    timers.delete(id);
  }
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/**
 * Pause the auto-dismiss timer for a toast (e.g. on hover).
 */
function pauseTimer(id: string) {
  const entry = timers.get(id);
  if (!entry) return;
  clearTimeout(entry.handle);
  entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.startedAt));
}

/**
 * Resume a previously paused auto-dismiss timer.
 */
function resumeTimer(id: string) {
  const entry = timers.get(id);
  if (!entry || entry.remaining <= 0) return;
  entry.startedAt = Date.now();
  entry.handle = setTimeout(() => {
    timers.delete(id);
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, entry.remaining);
}

/* ------------------------------------------------------------------ */
/*  Composable                                                         */
/* ------------------------------------------------------------------ */

/**
 * Composable for managing toast notifications.
 *
 * Uses a module-level singleton so all callers share the same toast stack.
 * Mount `<ToastContainer />` once in your root layout to render them.
 */
export function useToast(): {
  toasts: Readonly<Ref<Toast[]>>;
  toast: (options: ToastOptions | string) => string;
  success: (message: string, options?: Partial<ToastOptions>) => string;
  error: (message: string, options?: Partial<ToastOptions>) => string;
  warning: (message: string, options?: Partial<ToastOptions>) => string;
  info: (message: string, options?: Partial<ToastOptions>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
  pauseTimer: (id: string) => void;
  resumeTimer: (id: string) => void;
} {
  function addToast(options: ToastOptions): string {
    const id = `toast-${++counter}`;
    const t: Toast = {
      id,
      message: options.message,
      type: options.type ?? "info",
      duration: options.duration ?? DEFAULT_DURATION,
      createdAt: Date.now(),
      title: options.title,
      description: options.description,
      action: options.action,
    };

    toasts.value = [...toasts.value, t];

    // Enforce max visible — drop oldest first
    while (toasts.value.length > MAX_VISIBLE) {
      removeToast(toasts.value[0].id);
    }

    if (t.duration > 0) {
      scheduleRemoval(id, t.duration);
    }

    return id;
  }

  function toast(options: ToastOptions | string): string {
    if (typeof options === "string") {
      return addToast({ message: options });
    }
    return addToast(options);
  }

  function success(message: string, options?: Partial<ToastOptions>): string {
    return addToast({ ...options, message, type: "success" });
  }

  function error(message: string, options?: Partial<ToastOptions>): string {
    return addToast({ ...options, message, type: "error" });
  }

  function warning(message: string, options?: Partial<ToastOptions>): string {
    return addToast({ ...options, message, type: "warning" });
  }

  function info(message: string, options?: Partial<ToastOptions>): string {
    return addToast({ ...options, message, type: "info" });
  }

  function dismiss(id: string) {
    removeToast(id);
  }

  function clear() {
    for (const t of toasts.value) {
      const entry = timers.get(t.id);
      if (entry) clearTimeout(entry.handle);
      timers.delete(t.id);
    }
    toasts.value = [];
  }

  return {
    toasts: toasts as Readonly<Ref<Toast[]>>,
    toast,
    success,
    error,
    warning,
    info,
    dismiss,
    clear,
    pauseTimer,
    resumeTimer,
  };
}
