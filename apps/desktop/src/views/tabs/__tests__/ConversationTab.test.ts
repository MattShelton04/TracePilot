import { makeTurn, setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn } from "@tracepilot/types";
import { EmptyState, ErrorAlert, StatCard } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive, ref } from "vue";
import ChatViewMode from "@/components/conversation/ChatViewMode.vue";
import ConversationTab from "../ConversationTab.vue";

const store = reactive({
  sessionId: "s1",
  detail: null,
  turns: [] as ConversationTurn[],
  turnsVersion: 0,
  turnsError: null as string | null,
  loaded: new Set<string>(),
  pendingConversationFocus: null,
  promptCache: null,
  loadTurns: vi.fn(),
  loadPromptCache: vi.fn(),
});
vi.mock("@/composables/useSessionDetailContext", () => ({ useSessionDetailContext: () => store }));
// Scrolled to the middle of an overflowing conversation: both jump buttons show.
vi.mock("@/composables/useAutoScroll", () => ({
  useAutoScroll: () => ({
    isLockedToBottom: ref(false),
    showScrollToTop: ref(true),
    hasOverflow: ref(true),
    scrollToBottom: vi.fn(),
    scrollToTop: vi.fn(),
  }),
}));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ query: {} }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  store.turns = [];
  store.turnsError = null;
  store.loaded = new Set();
  store.loadTurns.mockReset();
});

function mountTab() {
  setupPinia();
  const wrapper = mount(ConversationTab, {
    global: { stubs: { ChatViewMode: true, ConversationTurnList: true } },
  });
  const stat = (label: string) =>
    wrapper
      .findAllComponents(StatCard)
      .find((card) => card.props("label") === label)
      ?.props("value");
  return { wrapper, stat };
}

it("says the conversation is loading, not empty, until turns have loaded", async () => {
  const { wrapper, stat } = mountTab();
  expect(store.loadTurns).toHaveBeenCalled();
  expect(wrapper.get('[role="status"]').text()).toContain("Loading conversation");
  expect(wrapper.findComponent(EmptyState).exists()).toBe(false);
  expect(stat("Turns")).toBe("—");
  expect(stat("Tool Calls")).toBe("—");

  store.loaded.add("turns");
  await nextTick();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.getComponent(EmptyState).text()).toContain("No conversation turns found.");
  expect(stat("Turns")).toBe(0);
  wrapper.unmount();
});

it("shows a failed load as an error with retry, never as an empty conversation", async () => {
  store.turnsError = "Couldn't read events.jsonl";
  const { wrapper, stat } = mountTab();
  expect(wrapper.getComponent(ErrorAlert).props("message")).toBe("Couldn't read events.jsonl");
  expect(wrapper.findComponent(EmptyState).exists()).toBe(false);
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(stat("Turns")).toBe("—");

  store.loadTurns.mockClear();
  store.loaded.add("turns");
  wrapper.getComponent(ErrorAlert).vm.$emit("retry");
  expect(store.loaded.has("turns")).toBe(false);
  expect(store.loadTurns).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

it("renders loaded turns with their counts", () => {
  store.turns = [makeTurn({ turnIndex: 0 }), makeTurn({ turnIndex: 1 })];
  store.loaded.add("turns");
  const { wrapper, stat } = mountTab();
  expect(wrapper.findComponent(EmptyState).exists()).toBe(false);
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.find("chat-view-mode-stub").exists()).toBe(true);
  expect(stat("Turns")).toBe(2);
  wrapper.unmount();
});

describe("scroll buttons beside the subagent panel", () => {
  async function mountChat() {
    store.turns = [makeTurn({ turnIndex: 0 })];
    store.loaded.add("turns");
    const { wrapper } = mountTab();
    await nextTick();
    const group = () => wrapper.find(".scroll-fab-group");
    const panel = async (width: number, fullWidth = false) => {
      wrapper.getComponent(ChatViewMode).vm.$emit("panelLayout", { width, fullWidth });
      await nextTick();
    };
    return { wrapper, group, panel };
  }

  it("keep their default corner while no panel is open", async () => {
    const { wrapper, group } = await mountChat();
    expect(group().exists()).toBe(true);
    expect(group().classes()).not.toContain("scroll-fab-group--beside-panel");
    expect(group().attributes("style")).toBeUndefined();
    expect(wrapper.get('[aria-label="Scroll to top"]').attributes("title")).toBe("Jump to top");
    expect(wrapper.get('[aria-label="Scroll to bottom"]').find("svg").exists()).toBe(true);
    wrapper.unmount();
  });

  it("move left of an open panel by its width, and back when it closes", async () => {
    const { wrapper, group, panel } = await mountChat();
    await panel(547.2);
    expect(group().classes()).toContain("scroll-fab-group--beside-panel");
    expect(group().attributes("style")).toContain("--fab-panel-offset: 547px");

    await panel(0);
    expect(group().classes()).not.toContain("scroll-fab-group--beside-panel");
    expect(group().attributes("style")).toBeUndefined();
    wrapper.unmount();
  });

  it("hide while the panel fills the window", async () => {
    const { wrapper, group, panel } = await mountChat();
    await panel(900, true);
    expect(group().exists()).toBe(false);
    await panel(0);
    expect(group().exists()).toBe(true);
    wrapper.unmount();
  });
});
