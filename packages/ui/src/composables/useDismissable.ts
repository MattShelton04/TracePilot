import { ref } from "vue";

/**
 * Reusable composable for persisting dismiss state in localStorage.
 * Useful for banners, warnings, and one-time popups.
 *
 * @param key - Unique identifier (stored as `tracepilot-dismissed-{key}`)
 */
export function useDismissable(key: string) {
  const storageKey = `tracepilot-dismissed-${key}`;
  const isDismissed = ref(localStorage.getItem(storageKey) === "true");

  function dismiss() {
    localStorage.setItem(storageKey, "true");
    isDismissed.value = true;
  }

  function reset() {
    localStorage.removeItem(storageKey);
    isDismissed.value = false;
  }

  return { isDismissed, dismiss, reset };
}
