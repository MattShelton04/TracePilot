import { computed, getCurrentScope, onScopeDispose, ref, watch } from "vue";

export interface UseProgressiveListOptions {
  /** Items rendered straight away: enough to fill the largest viewport. */
  initial?: number;
  /** Items added on each following frame until the whole list is rendered. */
  step?: number;
}

const DEFAULT_INITIAL = 60;
const DEFAULT_STEP = 60;

function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

/**
 * Render a long list in frame-sized chunks so a view paints its first screen
 * at once instead of building every item before the first paint. Mounting
 * hundreds of rich cards in one go blocks navigation for hundreds of
 * milliseconds; this spreads the same work over the next few frames.
 *
 * When the list changes (a search, a filter, a refresh) the rendered count
 * drops back to `initial` only if the new list is shorter than what is
 * already rendered, so keyed items that stay are reused rather than remounted.
 */
export function useProgressiveList<T>(
  source: () => readonly T[],
  { initial = DEFAULT_INITIAL, step = DEFAULT_STEP }: UseProgressiveListOptions = {},
) {
  const limit = ref(initial);
  let cancel: (() => void) | null = null;

  const visible = computed(() => {
    const items = source();
    return items.length <= limit.value ? items : items.slice(0, limit.value);
  });
  /** True once every item is rendered (for work that needs the full list in the DOM). */
  const complete = computed(() => limit.value >= source().length);

  function grow() {
    if (cancel || complete.value) return;
    cancel = nextFrame(() => {
      cancel = null;
      limit.value += step;
      grow();
    });
  }

  watch(
    source,
    (items) => {
      limit.value = Math.min(limit.value, Math.max(initial, items.length));
      grow();
    },
    { immediate: true },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      cancel?.();
      cancel = null;
    });
  }

  return { visible, complete };
}
