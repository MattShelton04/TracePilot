import { getCurrentScope, onScopeDispose } from "vue";

/** Keyboard event handler signature used by {@link useShortcut} / {@link useKeydown}. */
export type KeyHandler = (e: KeyboardEvent) => void;

/** DOM target for key listeners. Defaults to `window`. */
export type KeyTarget = Window | Document | HTMLElement;

/** Options shared by {@link useShortcut} and {@link useKeydown}. */
export interface UseKeyboardOptions {
  /** Target to attach the listener to. Defaults to `window`. */
  target?: KeyTarget;
  /** Use capture-phase listener. Defaults to `false`. */
  capture?: boolean;
}

/** Options accepted by {@link useShortcut}. */
export interface UseShortcutOptions extends UseKeyboardOptions {
  /** Call `event.preventDefault()` when the combo matches. Defaults to `true`. */
  preventDefault?: boolean;
  /**
   * Skip the handler when the event originates from an editable element
   * (inputs, textareas, selects, contenteditable). Defaults to `true`.
   */
  ignoreEditable?: boolean;
  /** Optional gate — handler only runs when this returns truthy. */
  when?: () => boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  // Guard: window / document targets have no tagName or closest().
  if (typeof (el as { tagName?: unknown }).tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") return (el as HTMLInputElement).type !== "hidden";
  if (tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest !== "function") return false;
  return el.closest('[contenteditable="true"]') !== null;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || "");
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  return: "enter",
  plus: "+",
};

function normaliseKey(key: string): string {
  const k = key.toLowerCase();
  return KEY_ALIASES[k] ?? k;
}

/**
 * Test whether a `KeyboardEvent` matches a combo string such as `"Mod+K"`,
 * `"Escape"`, `"Shift+Enter"`, or `"Ctrl+ArrowUp"`.
 *
 * Supported modifiers: `Mod` (⌘ on macOS / Ctrl elsewhere), `Ctrl`, `Meta`,
 * `Shift`, `Alt`. Modifiers only constrain the match when listed — so
 * `"Mod+K"` matches both `Cmd+K` and `Cmd+Shift+K` (matching existing
 * app behaviour around `shouldIgnoreGlobalShortcut`).
 */
export function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  const rawKey = parts.pop();
  if (!rawKey) return false;
  const targetKey = normaliseKey(rawKey);
  const mods = new Set(parts.map((p) => p.toLowerCase()));

  if (mods.has("mod")) {
    const modActive = isMacPlatform() ? event.metaKey : event.ctrlKey;
    if (!modActive) return false;
  }
  if (mods.has("ctrl") && !event.ctrlKey) return false;
  if (mods.has("meta") && !event.metaKey) return false;
  if (mods.has("shift") && !event.shiftKey) return false;
  if (mods.has("alt") && !event.altKey) return false;

  return event.key.toLowerCase() === targetKey;
}

function resolveTarget(target: KeyTarget | undefined): EventTarget | null {
  if (target) return target;
  if (typeof window === "undefined") return null;
  return window;
}

/**
 * Register a `keydown` listener scoped to the current effect scope. The
 * listener is attached synchronously and removed via {@link onScopeDispose},
 * so there is no await between registration and cleanup wiring.
 */
export function useKeydown(handler: KeyHandler, options: UseKeyboardOptions = {}): void {
  const target = resolveTarget(options.target);
  if (!target) return;
  const capture = options.capture ?? false;
  target.addEventListener("keydown", handler as EventListener, capture);
  if (getCurrentScope()) {
    onScopeDispose(() => {
      target.removeEventListener("keydown", handler as EventListener, capture);
    });
  }
}

/**
 * Bind a keyboard shortcut scoped to the current effect scope.
 *
 * Accepts a single combo string or an array of combos — any match triggers
 * `handler`. By default, events from editable form elements are ignored and
 * `preventDefault()` is called on match, which matches the repository's
 * existing shortcut conventions.
 *
 * @example
 * ```ts
 * useShortcut("Mod+K", () => openPalette());
 * useShortcut(["Escape", "Mod+Escape"], () => close());
 * ```
 */
export function useShortcut(
  combo: string | readonly string[],
  handler: KeyHandler,
  options: UseShortcutOptions = {},
): void {
  const combos = Array.isArray(combo) ? combo : [combo as string];
  const ignoreEditable = options.ignoreEditable ?? true;
  const preventDefault = options.preventDefault ?? true;

  const onKeydown: KeyHandler = (event) => {
    if (event.defaultPrevented) return;
    if (ignoreEditable && isEditableTarget(event.target)) return;
    if (options.when && !options.when()) return;
    for (const c of combos) {
      if (matchesCombo(event, c)) {
        if (preventDefault) event.preventDefault();
        handler(event);
        return;
      }
    }
  };

  useKeydown(onKeydown, { target: options.target, capture: options.capture });
}
