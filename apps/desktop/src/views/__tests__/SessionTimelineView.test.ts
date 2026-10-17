import { makeTurn, makeTurnToolCall, setupPinia } from "@tracepilot/test-utils";
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

function subagentTurn(turnIndex: number, { withId = true } = {}) {
  const toolCallId = withId ? `agent-${turnIndex}` : undefined;
  return makeTurn({
    turnIndex,
    toolCalls: [makeTurnToolCall({ toolName: "task", isSubagent: true, toolCallId })],
  });
}

function viewButtons(wrapper: ReturnType<typeof mountTimeline>) {
  return wrapper.findAll("button").map((b) => b.text());
}

it("draws the timeline once turns have loaded", () => {
  store.turns = [subagentTurn(0)];
  store.loaded.add("turns");
  const wrapper = mountTimeline();
  expect(wrapper.findComponent(EmptyState).exists()).toBe(false);
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.find("agent-tree-view-stub").exists()).toBe(true);
  expect(wrapper.text()).toContain("Session Timeline");
  wrapper.unmount();
});

it("opens a session without subagents on Swimlanes, not an empty agent tree", () => {
  store.turns = [makeTurn({ turnIndex: 0 }), makeTurn({ turnIndex: 1 })];
  store.loaded.add("turns");
  const wrapper = mountTimeline();
  expect(wrapper.find("nested-swimlanes-view-stub").exists()).toBe(true);
  expect(wrapper.find("agent-tree-view-stub").exists()).toBe(false);
  // Agent Tree would only say "No Agent Orchestration", so it isn't offered.
  expect(viewButtons(wrapper)).toEqual(["Swimlanes", "Waterfall"]);
  // The stored choice is kept for the next session that has subagents.
  expect(useSessionTabViews().value.timeline).toBe("agent-tree");
  wrapper.unmount();
});

it("stays on the fallback view when a live session spawns its first subagent", async () => {
  const wrapper = mountTimeline();
  store.turns = [makeTurn({ turnIndex: 0 })];
  store.loaded.add("turns");
  await nextTick();
  expect(wrapper.find("nested-swimlanes-view-stub").exists()).toBe(true);

  store.turns = [...store.turns, subagentTurn(1)];
  await nextTick();
  expect(wrapper.find("nested-swimlanes-view-stub").exists()).toBe(true);
  expect(viewButtons(wrapper)).toContain("Agent Tree");

  await wrapper
    .findAll("button")
    .find((b) => b.text() === "Agent Tree")
    ?.trigger("click");
  expect(wrapper.find("agent-tree-view-stub").exists()).toBe(true);
  expect(useSessionTabViews().value.timeline).toBe("agent-tree");
  wrapper.unmount();
});

it("offers the agent tree for a subagent call without an id, but not Messages", () => {
  // The agent tree lists every subagent call; Messages needs ids to address agents.
  store.turns = [subagentTurn(0, { withId: false })];
  store.loaded.add("turns");
  const wrapper = mountTimeline();
  expect(wrapper.find("agent-tree-view-stub").exists()).toBe(true);
  expect(viewButtons(wrapper)).toEqual(["Swimlanes", "Waterfall", "Agent Tree"]);
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

it("shows Swimlanes for a remembered Messages view when the session has no subagents", () => {
  useSessionTabViews().value.timeline = "messages";
  store.turns = [makeTurn({ turnIndex: 0 })];
  store.loaded.add("turns");
  const wrapper = mountTimeline();
  expect(wrapper.find("nested-swimlanes-view-stub").exists()).toBe(true);
  expect(wrapper.find("agent-tree-view-stub").exists()).toBe(false);
  expect(wrapper.find("agent-messages-view-stub").exists()).toBe(false);
  // The choice is kept for the next session that has subagents.
  expect(useSessionTabViews().value.timeline).toBe("messages");
  wrapper.unmount();
});

it("shows the agent tree for a remembered Messages view that can't address the agents", () => {
  useSessionTabViews().value.timeline = "messages";
  store.turns = [subagentTurn(0, { withId: false })];
  store.loaded.add("turns");
  const wrapper = mountTimeline();
  expect(wrapper.find("agent-tree-view-stub").exists()).toBe(true);
  wrapper.unmount();
});
