/**
 * Composable for turn-based navigation in timeline visualization components.
 *
 * Provides: index tracking, prev/next/jumpTo, keyboard handlers (ArrowLeft/Right),
 * and auto-reset when the turn list changes.
 */
import { type ComputedRef, computed, onBeforeUnmount, onMounted, type Ref, ref, watch } from "vue";

export interface TimelineNavigationOptions {
  /** Reactive list of turns to navigate through. */
  turns: ComputedRef<unknown[]> | Ref<unknown[]>;
  /** Optional ref to the root element — keyboard events are only handled when focus is inside it. */
  rootRef?: Ref<HTMLElement | null>;
  /** Optional callback invoked on Escape key. If not provided, Escape is ignored. */
  onEscape?: () => void;
}

export interface TimelineNavigationReturn {
  /** Current turn index (0-based). */
  turnIndex: Ref<number>;
  /** Whether the jump dropdown is open. */
  jumpOpen: Ref<boolean>;
  /** Human-readable label like "Turn 3 of 12". */
  turnLabel: ComputedRef<string>;
  /** Whether we can go backward. */
  canPrev: ComputedRef<boolean>;
  /** Whether we can go forward. */
  canNext: ComputedRef<boolean>;
  /** Navigate to the previous turn. */
  prevTurn: () => void;
  /** Navigate to the next turn. */
  nextTurn: () => void;
  /** Jump to a specific turn index (clamped to valid range). Closes the jump dropdown. */
  jumpTo: (idx: number) => void;
}

export function useTimelineNavigation(
  options: TimelineNavigationOptions,
): TimelineNavigationReturn {
  const { turns, rootRef, onEscape } = options;

  const turnIndex = ref(0);
  const jumpOpen = ref(false);

  const turnLabel = computed(() => {
    const len = turns.value.length;
    return len === 0 ? "No turns" : `Turn ${turnIndex.value + 1} of ${len}`;
  });

  const canPrev = computed(() => turnIndex.value > 0);
  const canNext = computed(() => turnIndex.value < turns.value.length - 1);

  function prevTurn() {
    if (canPrev.value) turnIndex.value--;
  }

  function nextTurn() {
    if (canNext.value) turnIndex.value++;
  }

  function jumpTo(idx: number) {
    turnIndex.value = Math.max(0, Math.min(idx, turns.value.length - 1));
    jumpOpen.value = false;
  }

  // Reset index when turns list changes
  watch(turns, () => {
    if (turnIndex.value >= turns.value.length) {
      turnIndex.value = Math.max(0, turns.value.length - 1);
    }
  });

  // Keyboard navigation
  function onKeyDown(e: KeyboardEvent) {
    // When rootRef is provided and mounted, only handle keys when focus is inside it.
    // When rootRef is not provided, allow global keyboard navigation.
    if (rootRef?.value && !rootRef.value.contains(document.activeElement)) return;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        prevTurn();
        break;
      case "ArrowRight":
        e.preventDefault();
        nextTurn();
        break;
      case "Escape":
        onEscape?.();
        break;
    }
  }

  onMounted(() => window.addEventListener("keydown", onKeyDown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown));

  return {
    turnIndex,
    jumpOpen,
    turnLabel,
    canPrev,
    canNext,
    prevTurn,
    nextTurn,
    jumpTo,
  };
}
