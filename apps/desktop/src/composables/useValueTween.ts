import { onScopeDispose, type Ref, type WatchSource, watch } from "vue";
import { countableText, countFrom } from "@/utils/countUp";
import { motionAllowed } from "./useFirstReveal";

const TWEEN_MS = 450;

export interface ValueTweenOptions {
  /** View root; numbers matching `selector` inside it tween. */
  root: Ref<HTMLElement | null>;
  selector: string;
  /** The data the numbers are drawn from; each change tweens them. */
  source: WatchSource;
}

/**
 * When the data behind a view changes in place (a new filter, a reindex),
 * count each number from what it showed to what it shows now, instead of
 * swapping it. Pairs with `useFirstReveal`, which counts up from zero the
 * first time a view appears. Off with reduced motion.
 *
 * Panels can land a moment apart, so a later change leaves running counts
 * alone and only starts new ones for the numbers it actually re-rendered.
 */
export function useValueTween(options: ValueTweenOptions) {
  let shown = new Map<Element, string>();
  const finishers = new Set<() => void>();

  // Before the DOM updates: read what each number shows right now. Panels
  // landing in the same update run this again after the first render, so
  // keep the first reading of each number until the update is done.
  watch(
    options.source,
    () => {
      for (const el of options.root.value?.querySelectorAll(options.selector) ?? []) {
        const text = countableText(el);
        if (text && !shown.has(el)) shown.set(el, text);
      }
    },
    { flush: "pre" },
  );

  // After it: count the re-rendered numbers from what they showed.
  watch(
    options.source,
    () => {
      const changed = new Map(
        [...shown].filter(([el, text]) => el.isConnected && countableText(el) !== text),
      );
      shown = new Map();
      if (changed.size === 0 || !motionAllowed()) return;
      const finish = countFrom(changed, TWEEN_MS);
      finishers.add(finish);
      setTimeout(() => finishers.delete(finish), TWEEN_MS + 50);
    },
    { flush: "post" },
  );

  onScopeDispose(() => {
    for (const finish of finishers) finish();
  });
}
