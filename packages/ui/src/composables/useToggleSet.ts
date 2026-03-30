import type { Ref } from "vue";
import { ref } from "vue";

/**
 * Composable for managing toggle sets (e.g. expanded sections).
 * Replaces repeated add/delete Set logic.
 */
export function useToggleSet<T = string>(): {
  set: Ref<Set<T>>;
  toggle: (key: T) => void;
  has: (key: T) => boolean;
  clear: () => void;
} {
  const set = ref<Set<T>>(new Set()) as Ref<Set<T>>;

  function toggle(key: T) {
    if (set.value.has(key)) {
      set.value.delete(key);
    } else {
      set.value.add(key);
    }
  }

  function has(key: T) {
    return set.value.has(key);
  }

  function clear() {
    set.value.clear();
  }

  return { set, toggle, has, clear };
}
