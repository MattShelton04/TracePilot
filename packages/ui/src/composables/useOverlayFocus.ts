import { type MaybeRefOrGetter, nextTick, onScopeDispose, type Ref, toValue, watch } from "vue";

export interface UseOverlayFocusOptions {
  active: MaybeRefOrGetter<boolean>;
  panel: Ref<HTMLElement | null>;
  onEscape: () => void;
  /** Non-modal panels retain normal page tab order. */
  modal?: MaybeRefOrGetter<boolean>;
  initialFocus?: () => HTMLElement | null;
}

interface OverlayEntry {
  options: UseOverlayFocusOptions;
  returnTo: HTMLElement | SVGElement | null;
}

// Shared by every overlay in this webview, regardless of its CSS class or
// whether it is teleported. The most recently opened modal retains ownership
// while non-modal surfaces (such as Alerts) open alongside it.
const overlays: OverlayEntry[] = [];
const focusableSelector =
  'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable="true"], [tabindex]';

function topOverlay(): OverlayEntry | undefined {
  for (let index = overlays.length - 1; index >= 0; index--) {
    if (isModal(overlays[index])) return overlays[index];
  }
  return overlays[overlays.length - 1];
}

function isModal(entry: OverlayEntry): boolean {
  return toValue(entry.options.modal ?? true);
}

function isAvailable(element: Element): boolean {
  if (
    !element.isConnected ||
    element.matches(":disabled") ||
    element.closest("[hidden], [inert]")
  ) {
    return false;
  }
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (ancestor.tagName === "DETAILS" && !ancestor.hasAttribute("open")) {
      const summary = ancestor.querySelector(":scope > summary");
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

function tabbableElements(panel: HTMLElement): HTMLElement[] {
  const candidates = [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => element.tabIndex >= 0 && isAvailable(element),
  );
  return candidates
    .filter((element) => {
      if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name) {
        return true;
      }
      const group = candidates.filter(
        (other): other is HTMLInputElement =>
          other instanceof HTMLInputElement &&
          other.type === "radio" &&
          other.name === element.name &&
          other.form === element.form,
      );
      return element === (group.find((radio) => radio.checked) ?? group[0]);
    })
    .sort((a, b) => {
      // Positive tab indices precede ordinary document order, as in the browser.
      const aIndex = a.tabIndex > 0 ? a.tabIndex : Number.MAX_SAFE_INTEGER;
      const bIndex = b.tabIndex > 0 ? b.tabIndex : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
}

function focusInside(entry: OverlayEntry, last = false): void {
  const panel = entry.options.panel.value;
  if (!panel?.isConnected) return;
  const preferred = entry.options.initialFocus?.();
  const tabbable = tabbableElements(panel);
  const target = last
    ? tabbable[tabbable.length - 1]
    : preferred && panel.contains(preferred) && isAvailable(preferred)
      ? preferred
      : tabbable[0];
  (target ?? panel).focus({ preventScroll: true });
}

function onKeydown(event: KeyboardEvent): void {
  const entry = topOverlay();
  const panel = entry?.options.panel.value;
  if (!entry || !panel || event.defaultPrevented || event.isComposing) return;
  const modal = isModal(entry);
  // A non-modal drawer must not take keys from the rest of the page.
  if (!modal && !panel.contains(event.target as Node | null)) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    entry.options.onEscape();
    return;
  }
  if (event.key !== "Tab" || !modal) return;

  const tabbable = tabbableElements(panel);
  const active = document.activeElement;
  const first = tabbable[0];
  const last = tabbable[tabbable.length - 1];
  if (
    !first ||
    !panel.contains(active) ||
    active === panel ||
    (event.shiftKey ? active === first : active === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus({ preventScroll: true });
    if (!first) panel.focus({ preventScroll: true });
  }
}

function onFocusIn(event: FocusEvent): void {
  const entry = topOverlay();
  const panel = entry?.options.panel.value;
  if (entry && panel && isModal(entry) && !panel.contains(event.target as Node | null)) {
    focusInside(entry);
  }
}

function register(entry: OverlayEntry): void {
  if (overlays.length === 0) {
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("focusin", onFocusIn);
  }
  overlays.push(entry);
}

function unregister(entry: OverlayEntry): void {
  const index = overlays.indexOf(entry);
  if (index < 0) return;
  const wasTop = topOverlay() === entry;
  const hadFocus = entry.options.panel.value?.contains(document.activeElement);
  overlays.splice(index, 1);
  if (overlays.length === 0) {
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("focusin", onFocusIn);
  }
  if (!wasTop || (!isModal(entry) && !hadFocus)) return;

  nextTick(() => {
    const current = topOverlay();
    if (current && isModal(current) && !current.options.panel.value?.contains(entry.returnTo)) {
      focusInside(current);
    } else if (entry.returnTo && isAvailable(entry.returnTo)) {
      entry.returnTo.focus({ preventScroll: true });
    }
  });
}

/**
 * Own initial focus, modal Tab containment, topmost Escape, and focus return.
 * The panel must have tabindex="-1" so empty dialogs remain focusable.
 * Child controls can consume Escape first (for example a combobox popup).
 */
export function useOverlayFocus(options: UseOverlayFocusOptions): void {
  let entry: OverlayEntry | null = null;
  let generation = 0;

  function deactivate() {
    generation++;
    if (entry) unregister(entry);
    entry = null;
  }

  watch(
    () => toValue(options.active),
    (active) => {
      deactivate();
      if (!active || typeof document === "undefined") return;
      const focused = document.activeElement;
      const returnTo =
        focused instanceof HTMLElement || focused instanceof SVGElement ? focused : null;
      const activation = generation;
      nextTick(() => {
        if (activation !== generation || !options.panel.value?.isConnected) return;
        entry = { options, returnTo };
        register(entry);
        if (topOverlay() !== entry) return;
        // Apply explicit initial focus after registering ownership, so an
        // underlying modal cannot pull it back into its own panel. Otherwise
        // retain a consumer's existing focus (e.g. the palette search input).
        if (options.initialFocus?.() || !options.panel.value.contains(document.activeElement)) {
          focusInside(entry);
        }
      });
    },
    { immediate: true },
  );

  onScopeDispose(deactivate);
}
