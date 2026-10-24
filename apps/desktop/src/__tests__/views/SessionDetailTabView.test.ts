import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, inject, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { markConversationFocusRevealed } from "@/composables/conversationFocusReveal";
import { SESSION_DETAIL_KEY } from "@/composables/session/contextKey";
import {
  type ConversationNavigationTarget,
  NAVIGATE_CONVERSATION_KEY,
} from "@/composables/useConversationNavigation";
import SessionDetailTabView from "@/views/SessionDetailTabView.vue";

const mocks = vi.hoisted(() => ({ viewer: false }));

vi.mock("@/composables/useWindowRole", () => ({
  useWindowRole: () => ({ isViewer: () => mocks.viewer }),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock();
});

// The panel's header actions read the router it is given (Export, Replay).
const PanelStub = defineComponent({
  name: "SessionDetailPanel",
  props: { router: { type: Object, default: undefined } },
  template: "<div />",
});

function mountTab(plugins: unknown[] = []) {
  return mount(SessionDetailTabView, {
    props: { sessionId: "session-1", activeSubTab: "overview" },
    global: {
      plugins: plugins as never[],
      stubs: { SessionDetailPanel: PanelStub },
    },
  });
}

describe("SessionDetailTabView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.viewer = false;
  });

  it("gives a main-window tab the app's router, so its header can export", () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    const wrapper = mountTab([router]);
    expect(wrapper.getComponent(PanelStub).props("router")).toBe(router);
  });

  it("gives a viewer window, which has no router, none", () => {
    mocks.viewer = true;
    const wrapper = mountTab();
    expect(wrapper.getComponent(PanelStub).props("router")).toBeNull();
  });
});

describe("SessionDetailTabView sub-tab scroll", () => {
  /** The panel's scroller: the sub-tab nav, then the sub-tab's content. */
  let jumpToTurn: ((target: ConversationNavigationTarget) => void) | undefined;
  let panelStore: { pendingConversationFocus: { requestId: number } | null } | null = null;
  const ScrollingPanel = defineComponent({
    name: "SessionDetailPanel",
    setup() {
      jumpToTurn = inject(NAVIGATE_CONVERSATION_KEY);
      panelStore = inject(SESSION_DETAIL_KEY, null);
      return () => h("div", { class: "page-content" }, [h("div", { role: "tablist" })]);
    },
  });
  let top = 0;

  async function mountScrolling() {
    const wrapper = mount(SessionDetailTabView, {
      props: {
        sessionId: "session-1",
        activeSubTab: "conversation",
        "onUpdate:activeSubTab": (tab: string) => wrapper.setProps({ activeSubTab: tab }),
      },
      global: { stubs: { SessionDetailPanel: ScrollingPanel } },
    });
    const scroller = wrapper.element as HTMLElement;
    Object.defineProperties(scroller, {
      scrollTop: {
        get: () => top,
        set: (v: number) => {
          top = Math.min(Math.max(0, v), 3400);
        },
        configurable: true,
      },
      scrollHeight: { get: () => 4000, configurable: true },
      clientHeight: { get: () => 600, configurable: true },
    });
    // The nav sits in the header, scrolling away with the content.
    const nav = scroller.querySelector("[role=tablist]") as HTMLElement;
    nav.getBoundingClientRect = () => ({ top: 260 - top, bottom: 300 - top }) as DOMRect;
    await nextTick();
    return { wrapper, scroller };
  }

  /** The user reads at `to`, then scrolls back up to the tabs. */
  function readThenScrollUp(scroller: HTMLElement, to: number) {
    scroller.scrollTop = to;
    scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(1000);
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
  }

  async function show(wrapper: Awaited<ReturnType<typeof mountScrolling>>["wrapper"], tab: string) {
    await wrapper.setProps({ activeSubTab: tab });
    await nextTick();
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.viewer = true;
    top = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns to the conversation where the user left it", async () => {
    const { wrapper, scroller } = await mountScrolling();
    readThenScrollUp(scroller, 1800);

    await show(wrapper, "overview");
    expect(scroller.scrollTop).toBe(0);
    await show(wrapper, "conversation");

    expect(scroller.scrollTop).toBe(1800);
  });

  it("opens a sub-tab seen for the first time at its top, with the tabs left in place", async () => {
    const { wrapper, scroller } = await mountScrolling();
    await show(wrapper, "metrics");
    scroller.scrollTop = 900;

    // The nav (at 260) lands at the top of the scroller, not back below the header.
    await show(wrapper, "timeline");
    expect(scroller.scrollTop).toBe(260);

    scroller.scrollTop = 100;
    await show(wrapper, "tasks");
    expect(scroller.scrollTop).toBe(100);
  });

  it("lets a jump to a turn win over the remembered position", async () => {
    const { wrapper, scroller } = await mountScrolling();
    readThenScrollUp(scroller, 1800);
    await show(wrapper, "overview");

    jumpToTurn?.({ turnIndex: 4 });
    await nextTick();
    // The conversation scrolls the turn into view itself.
    scroller.scrollTop = 2500;
    await nextTick();
    vi.advanceTimersByTime(6000);

    expect(wrapper.props("activeSubTab")).toBe("conversation");
    expect(scroller.scrollTop).toBe(2500);
  });

  it("returns to where the user read after a jump to a turn has been shown", async () => {
    const { wrapper, scroller } = await mountScrolling();
    await show(wrapper, "overview");
    jumpToTurn?.({ turnIndex: 4 });
    await nextTick();
    // The conversation scrolls to the turn and records that it was shown.
    const store = panelStore as NonNullable<typeof panelStore>;
    markConversationFocusRevealed(store, store.pendingConversationFocus?.requestId ?? -1);
    scroller.scrollTop = 2500;
    vi.advanceTimersByTime(6000);

    readThenScrollUp(scroller, 2900);
    await show(wrapper, "overview");
    await show(wrapper, "conversation");

    expect(scroller.scrollTop).toBe(2900);

    // A new jump still wins over the remembered position.
    await show(wrapper, "overview");
    jumpToTurn?.({ turnIndex: 1 });
    await nextTick();
    scroller.scrollTop = 700;
    await nextTick();
    vi.advanceTimersByTime(6000);
    expect(scroller.scrollTop).toBe(700);
  });
});
