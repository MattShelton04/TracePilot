/**
 * useConversationDeepLinkScroll — scroll a turn (or a specific tool-call event
 * inside a turn) into view and apply a transient highlight when the user
 * arrives via a search deep-link.
 *
 * Owns:
 *   - The IntersectionObserver that waits for the target to actually be on
 *     screen before flashing it.
 *   - The activeTimers list that backs the highlight removal + observer
 *     fallback timeouts.
 *   - The DOM mutation that adds/removes the `.turn-highlight` class. (The
 *     style rule for that class lives in `ConversationTurnList.vue`'s scoped
 *     <style>, so it matches the scope of the DOM nodes that actually receive
 *     the class — see B2-D2 / Finding B2.)
 *
 * The composable is intentionally minimal: it exposes a `scrollToTurn`
 * imperative action and a `currentDeepLinkTarget` ref that records the last
 * key successfully targeted (`"<turnIndex>-<eventIndex|null>"`). Route-query
 * watching and chat-view delegation stay in the caller — they need access to
 * the live `activeView`, the `chatViewRef.revealEvent` exposure, and the
 * tool-detail expansion logic, which are caller concerns rather than scroll
 * concerns.
 */
import { onScopeDispose, type Ref, readonly, ref } from "vue";

export interface UseConversationDeepLinkScrollReturn {
  /**
   * Scroll the DOM node tagged with `data-turn-idx={turnIndex}` (or, when
   * `eventIndex != null`, `data-event-idx={eventIndex}`) into view inside
   * `rootRef.value` and flash it. No-op if `rootRef.value` is null or the
   * target node cannot be found.
   */
  scrollToTurn: (turnIndex: number, eventIndex: number | null) => void;
  /**
   * The last key that was actually scrolled to, in the form
   * `"<turnIndex>-<eventIndex|null>"`. Useful for telling the caller whether
   * a deep-link request landed on something or not.
   */
  currentDeepLinkTarget: Readonly<Ref<string | null>>;
}

const HIGHLIGHT_CLASS = "turn-highlight";
const HIGHLIGHT_DURATION_MS = 4000;
const OBSERVER_FALLBACK_MS = 10000;
const VISIBILITY_THRESHOLD = 0.3;

export function useConversationDeepLinkScroll(
  rootRef: Ref<HTMLElement | null>,
): UseConversationDeepLinkScrollReturn {
  const currentDeepLinkTarget = ref<string | null>(null);

  const activeTimers: ReturnType<typeof setTimeout>[] = [];
  let activeObserver: IntersectionObserver | null = null;

  function scrollAndHighlight(el: HTMLElement) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    activeObserver?.disconnect();
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          if (activeObserver === observer) activeObserver = null;
          el.classList.add(HIGHLIGHT_CLASS);
          const t = setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_DURATION_MS);
          activeTimers.push(t);
        }
      },
      { threshold: VISIBILITY_THRESHOLD },
    );
    activeObserver = observer;
    observer.observe(el);
    const fallback = setTimeout(() => observer.disconnect(), OBSERVER_FALLBACK_MS);
    activeTimers.push(fallback);
  }

  function scrollToTurn(turnIndex: number, eventIndex: number | null) {
    const root = rootRef.value;
    if (!root) return;

    if (eventIndex != null) {
      const eventEl = root.querySelector<HTMLElement>(`[data-event-idx="${eventIndex}"]`);
      if (eventEl) {
        scrollAndHighlight(eventEl);
        currentDeepLinkTarget.value = `${turnIndex}-${eventIndex}`;
        return;
      }
    }
    const turnEl = root.querySelector<HTMLElement>(`[data-turn-idx="${turnIndex}"]`);
    if (turnEl) {
      scrollAndHighlight(turnEl);
      currentDeepLinkTarget.value = `${turnIndex}-null`;
    }
  }

  onScopeDispose(() => {
    activeObserver?.disconnect();
    activeObserver = null;
    for (const t of activeTimers) clearTimeout(t);
    activeTimers.length = 0;
  });

  return {
    scrollToTurn,
    currentDeepLinkTarget: readonly(currentDeepLinkTarget),
  };
}
