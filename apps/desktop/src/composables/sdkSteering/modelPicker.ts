import type { ComponentPublicInstance, CSSProperties, Ref } from "vue";
import { onUnmounted, ref, watch } from "vue";

/**
 * useModelPicker — ref-based dropdown positioning for the model picker.
 *
 * Previously `modelPickerStyle` was a `computed` that called
 * `document.querySelector(".cb-model-pick-btn")` on every read. That
 * broke reactivity (the computed had no Vue dependencies, so it stayed
 * cached at `{}` after first read) and tied the composable to a
 * specific CSS selector.
 *
 * The new design:
 *   1. Consumer template wires the trigger via
 *      `:ref="ctx.setModelPickerTrigger"`.
 *   2. `modelPickerStyle` is a plain `ref<CSSProperties>` that we
 *      recompute on open and on window resize — both naturally
 *      reactive triggers.
 *   3. The outside-click + resize listeners are mounted ONLY while the
 *      picker is open; teardown is paired via the same `watch` callback
 *      plus an `onUnmounted` safety net.
 */

export interface UseModelPickerReturn {
  triggerRef: Ref<HTMLElement | null>;
  modelPickerStyle: Ref<CSSProperties>;
  setModelPickerTrigger: (el: Element | ComponentPublicInstance | null) => void;
  toggleModelPicker: () => void;
}

const MAX_DROPDOWN_HEIGHT = 240;
const TRIGGER_GAP = 6;

function computeStyle(btn: HTMLElement | null): CSSProperties {
  if (!btn) return {};
  const rect = btn.getBoundingClientRect();
  const spaceAbove = rect.top - TRIGGER_GAP;
  if (spaceAbove >= MAX_DROPDOWN_HEIGHT) {
    return {
      position: "fixed",
      left: `${rect.left}px`,
      bottom: `${window.innerHeight - rect.top + TRIGGER_GAP}px`,
      minWidth: "220px",
      maxHeight: `${MAX_DROPDOWN_HEIGHT}px`,
      zIndex: 9999,
    };
  }
  return {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.bottom + TRIGGER_GAP}px`,
    minWidth: "220px",
    maxHeight: `${Math.min(MAX_DROPDOWN_HEIGHT, window.innerHeight - rect.bottom - TRIGGER_GAP - 8)}px`,
    zIndex: 9999,
  };
}

export function useModelPicker(showModelPicker: Ref<boolean>): UseModelPickerReturn {
  const triggerRef = ref<HTMLElement | null>(null);
  const modelPickerStyle = ref<CSSProperties>({});

  function setModelPickerTrigger(el: Element | ComponentPublicInstance | null) {
    if (el && "$el" in (el as object)) {
      triggerRef.value = (el as ComponentPublicInstance).$el as HTMLElement;
    } else {
      triggerRef.value = el as HTMLElement | null;
    }
  }

  function refreshStyle() {
    modelPickerStyle.value = computeStyle(triggerRef.value);
  }

  function toggleModelPicker() {
    const next = !showModelPicker.value;
    if (next) refreshStyle();
    showModelPicker.value = next;
  }

  function onOutsideClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (!target.closest(".cb-model-pick-btn") && !target.closest(".cb-model-dropdown-portal")) {
      showModelPicker.value = false;
    }
  }

  function onWindowResize() {
    if (showModelPicker.value) refreshStyle();
  }

  let listenersAttached = false;
  function attachListeners() {
    if (listenersAttached || typeof document === "undefined") return;
    document.addEventListener("click", onOutsideClick);
    window.addEventListener("resize", onWindowResize);
    listenersAttached = true;
  }
  function detachListeners() {
    if (!listenersAttached || typeof document === "undefined") return;
    document.removeEventListener("click", onOutsideClick);
    window.removeEventListener("resize", onWindowResize);
    listenersAttached = false;
  }

  // Listeners "move with the picker" — they are only registered while the
  // dropdown is visible, and torn down both on close and on unmount.
  watch(showModelPicker, (open) => {
    if (open) {
      refreshStyle();
      attachListeners();
    } else {
      detachListeners();
    }
  });

  onUnmounted(detachListeners);

  return {
    triggerRef,
    modelPickerStyle,
    setModelPickerTrigger,
    toggleModelPicker,
  };
}
