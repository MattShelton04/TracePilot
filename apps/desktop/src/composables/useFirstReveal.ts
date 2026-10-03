import {
  type MaybeRefOrGetter,
  nextTick,
  onScopeDispose,
  type Ref,
  ref,
  toValue,
  watch,
} from "vue";
import { countUp } from "@/utils/countUp";

/**
 * How long the `chart-reveal` class stays on the view: long enough for the
 * CSS reveals in styles/animations.css (and panels that mount a moment after
 * the data) to play, short enough that later re-renders never replay them.
 */
const REVEAL_WINDOW_MS = 900;
const COUNT_UP_MS = 600;

// Keys already revealed in this app run. Returning to a view, refreshing it
// or switching its filters keeps the charts still.
const revealed = new Set<string>();

/** False with reduced motion, and where the preference cannot be read. */
function motionAllowed(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface FirstRevealOptions {
  /** Identifies what is being revealed, e.g. `metrics:<sessionId>`. */
  key: MaybeRefOrGetter<string | null | undefined>;
  /** True once the data is rendered. */
  ready: MaybeRefOrGetter<boolean>;
  /** View root; numbers matching `countUpSelector` inside it count up. */
  root?: Ref<HTMLElement | null>;
  countUpSelector?: string;
}

/**
 * Plays first-appearance chart animations once per key per app run. Bind
 * `revealing` to a `chart-reveal` class on the view root; chart parts opt
 * in with `data-reveal` attributes.
 */
export function useFirstReveal(options: FirstRevealOptions) {
  const revealing = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishCount: (() => void) | undefined;

  watch(
    () => [toValue(options.key), toValue(options.ready)] as const,
    async ([key, ready]) => {
      if (!key || !ready || revealed.has(key)) return;
      revealed.add(key);
      if (!motionAllowed()) return;
      revealing.value = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        revealing.value = false;
      }, REVEAL_WINDOW_MS);
      if (options.countUpSelector) {
        await nextTick();
        const els = options.root?.value?.querySelectorAll(options.countUpSelector) ?? [];
        finishCount = countUp(els, COUNT_UP_MS);
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    clearTimeout(timer);
    finishCount?.();
  });

  return { revealing };
}
