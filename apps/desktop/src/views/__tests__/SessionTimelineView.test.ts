import { makeTurn, setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn } from "@tracepilot/types";
import { EmptyState, ErrorAlert } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { resetSessionTabViews, useSessionTabViews } from "@/composables/useSessionTabViews";
import SessionTimelineView from "../SessionTimelineView.vue";

const store = reactive({
  sessionId: "s1",
  detail: { id: "s1" } as { id: string } | null,
  loading: false,
  turns: [] as ConversationTurn[],
  turnsError: null as string | null,
  loaded: new Set<string>(["detail"]),
  loadTurns: vi.fn(),
});
vi.mock("@/composables/useSessionDetailContext", () => ({ useSessionDetailContext: () => store }));

beforeEach(() => {
  localStorage.clear();
  resetSessionTabViews();
});

afterEach(() => {
  store.loading = false;
  store.turns = [];
  store.turnsError = null;
  store.loaded = new Set(["detail"]);
  store.loadTurns.mockReset();
});

function mountTimeline() {
  setupPinia();
  return mount(SessionTimelineView, {
    global: {
      stubs: {
        AgentTreeView: true,
        NestedSwimlanesView: true,
        TurnWaterfallView: true,
        AgentMessagesView: true,
      },
    },
  });
}

it("shows turns loading, not 'No Timeline Data', while the session's turns load", async () => {
  const wrapper = mountTimeline();
  expect(store.loadTurns).toHaveBeenCalled();
  expect(wrapper.get('[role="status"]').text()).toContain("Loading timeline");
  expect(wrapper.findComponent(EmptyState).exists()).toBe(false);

  store.loaded.add("turns");
  await nextTick();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.getComponent(EmptyState).text()).toContain("No Timeline Data");
  wrapper.unmount();
});

it("shows a failed turns load as an error with retry, not as an empty session", () => {
  store.turnsError = "Couldn't read events.jsonl";
  const wrapper = mountTimeline();
  const alert = wrapper.getComponent(ErrorAlert);
  expect(alert.props("message")).toBe("Couldn't read events.jsonl");
  expect(wrapper.findComponent(EmptyState).exists()).toBe(false);
  expect(wrapper.find('[role="status"]').exists()).toBe(false);

  store.loadTurns.mockClear();
  store.loaded.add("turns");
  alert.vm.$emit("retry");
  expect(store.loaded.has("turns")).toBe(false);
  expect(store.loadTurns).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

it("draws the timeline once turns have loaded", () => {
  store.turns = [makeTurn({ turnIndex: 0 })];
  store.loaded.add("turns");
  const wrapper = mountTimeline();
  expect(wrapper.findComponent(EmptyState).exists()).toBe(false);
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.find("agent-tree-view-stub").exists()).toBe(true);
  expect(wrapper.text()).toContain("Session Timeline");
  wrapper.unmount();
});

it("keeps the chosen view when the Timeline tab is left and reopened", async () => {
  store.turns = [makeTurn({ turnIndex: 0 })];
  store.loaded.add("turns");
  const first = mountTimeline();
  const swimlanes = first.findAll("button").find((b) => b.text() === "Swimlanes");
  await swimlanes?.trigger("click");
  expect(first.find("nested-swimlanes-view-stub").exists()).toBe(true);
  first.unmount();

  const reopened = mountTimeline();
  expect(reopened.find("nested-swimlanes-view-stub").exists()).toBe(true);
  expect(reopened.find("agent-tree-view-stub").exists()).toBe(false);
  reopened.unmount();
});

it("shows the agent tree for a remembered Messages view when the session has no subagents", () => {
  useSessionTabViews().value.timeline = "messages";
  store.turns = [makeTurn({ turnIndex: 0 })];
  store.loaded.add("turns");
  const wrapper = mountTimeline();
  expect(wrapper.find("agent-tree-view-stub").exists()).toBe(true);
  expect(wrapper.find("agent-messages-view-stub").exists()).toBe(false);
  // The choice is kept for the next session that has subagents.
  expect(useSessionTabViews().value.timeline).toBe("messages");
  wrapper.unmount();
});
