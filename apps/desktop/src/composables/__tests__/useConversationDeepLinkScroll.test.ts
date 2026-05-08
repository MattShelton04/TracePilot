import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EffectScope, effectScope, ref } from "vue";
import { useConversationDeepLinkScroll } from "../useConversationDeepLinkScroll";

class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  static instances: FakeIntersectionObserver[] = [];
  observed: Element[] = [];
  disconnected = false;

  constructor(cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {
    this.callback = cb;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

describe("useConversationDeepLinkScroll", () => {
  let root: HTMLElement;
  let scrollSpy: ReturnType<typeof vi.fn>;
  let scope: EffectScope;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeIntersectionObserver.instances = [];
    (
      globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }
    ).IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;

    root = document.createElement("div");
    document.body.appendChild(root);
    scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
    document.body.removeChild(root);
    vi.useRealTimers();
  });

  function inScope<T>(fn: () => T): T {
    return scope.run(fn) as T;
  }

  function makeTurn(turnIdx: number, eventIdxs: number[] = []): HTMLElement {
    const turn = document.createElement("div");
    turn.setAttribute("data-turn-idx", String(turnIdx));
    for (const ev of eventIdxs) {
      const evEl = document.createElement("button");
      evEl.setAttribute("data-event-idx", String(ev));
      turn.appendChild(evEl);
    }
    root.appendChild(turn);
    return turn;
  }

  it("scrolls to the turn node by data-turn-idx and applies highlight after intersect", () => {
    const turn = makeTurn(7);
    const { scrollToTurn, currentDeepLinkTarget } = inScope(() =>
      useConversationDeepLinkScroll(ref(root)),
    );

    scrollToTurn(7, null);

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(currentDeepLinkTarget.value).toBe("7-null");
    expect(turn.classList.contains("turn-highlight")).toBe(false);

    FakeIntersectionObserver.instances[0]!.trigger(true);
    expect(turn.classList.contains("turn-highlight")).toBe(true);

    vi.advanceTimersByTime(4000);
    expect(turn.classList.contains("turn-highlight")).toBe(false);
  });

  it("prefers data-event-idx when eventIndex is provided", () => {
    const turn = makeTurn(3, [11]);
    const { scrollToTurn, currentDeepLinkTarget } = inScope(() =>
      useConversationDeepLinkScroll(ref(root)),
    );

    scrollToTurn(3, 11);

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    const observed = FakeIntersectionObserver.instances[0]!.observed[0]!;
    expect((observed as HTMLElement).getAttribute("data-event-idx")).toBe("11");
    expect(currentDeepLinkTarget.value).toBe("3-11");
    // Highlight target is the event node, not the turn node.
    FakeIntersectionObserver.instances[0]!.trigger(true);
    expect((observed as HTMLElement).classList.contains("turn-highlight")).toBe(true);
    expect(turn.classList.contains("turn-highlight")).toBe(false);
  });

  it("falls back to the turn node when the event-id is not found", () => {
    makeTurn(3, [11]);
    const { scrollToTurn, currentDeepLinkTarget } = inScope(() =>
      useConversationDeepLinkScroll(ref(root)),
    );

    scrollToTurn(3, 999);

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(currentDeepLinkTarget.value).toBe("3-null");
  });

  it("is a no-op when the rootRef is null", () => {
    const { scrollToTurn, currentDeepLinkTarget } = inScope(() =>
      useConversationDeepLinkScroll(ref<HTMLElement | null>(null)),
    );

    scrollToTurn(1, null);
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(currentDeepLinkTarget.value).toBeNull();
  });

  it("is a no-op when the target node does not exist", () => {
    const { scrollToTurn, currentDeepLinkTarget } = inScope(() =>
      useConversationDeepLinkScroll(ref(root)),
    );

    scrollToTurn(99, null);
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(currentDeepLinkTarget.value).toBeNull();
  });

  it("disconnects the observer and clears timers when the scope is disposed", () => {
    makeTurn(1);
    const localScope = effectScope();
    localScope.run(() => {
      const { scrollToTurn } = useConversationDeepLinkScroll(ref(root));
      scrollToTurn(1, null);
    });

    const observer = FakeIntersectionObserver.instances[0]!;
    expect(observer.disconnected).toBe(false);
    localScope.stop();
    expect(observer.disconnected).toBe(true);
  });

  it("disconnects the previous observer when scrollToTurn is called twice", () => {
    makeTurn(1);
    makeTurn(2);
    const { scrollToTurn } = inScope(() => useConversationDeepLinkScroll(ref(root)));

    scrollToTurn(1, null);
    scrollToTurn(2, null);

    expect(FakeIntersectionObserver.instances).toHaveLength(2);
    expect(FakeIntersectionObserver.instances[0]!.disconnected).toBe(true);
    expect(FakeIntersectionObserver.instances[1]!.disconnected).toBe(false);
  });
});
