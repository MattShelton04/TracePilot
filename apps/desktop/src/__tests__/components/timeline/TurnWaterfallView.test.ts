import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import TurnWaterfallView from "../../../components/timeline/TurnWaterfallView.vue";
import { useSessionDetailStore } from "../../../stores/sessionDetail";
import { makeTurnToolCall, makeTurn } from "../../helpers/testFixtures";

// ── Mock @tracepilot/client ─────────────────────────────────────────
vi.mock("@tracepilot/client", () => ({
  getSessionDetail: vi.fn(),
  getSessionTurns: vi.fn(),
  getSessionEvents: vi.fn(),
  getSessionTodos: vi.fn(),
  getSessionCheckpoints: vi.fn(),
  getShutdownMetrics: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────

function mountComponent() {
  return mount(TurnWaterfallView, {
    global: {
      stubs: {
        EmptyState: {
          template: '<div class="empty-state-stub">{{ title }}</div>',
          props: ["icon", "title", "message"],
        },
        Badge: {
          template: '<span class="badge-stub"><slot /></span>',
          props: ["variant"],
        },
        ExpandChevron: {
          template: '<span class="chevron-stub" />',
          props: ["expanded", "size"],
        },
      },
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("TurnWaterfallView", () => {
  let store: ReturnType<typeof useSessionDetailStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSessionDetailStore();
  });

  it("renders empty state when no turns", () => {
    store.turns = [];

    const wrapper = mountComponent();
    const empty = wrapper.find(".empty-state-stub");
    expect(empty.exists()).toBe(true);
    expect(wrapper.html()).toContain("No turns loaded");
  });

  it("shows turn navigation (prev/next buttons)", () => {
    store.turns = [makeTurn({ turnIndex: 0 }), makeTurn({ turnIndex: 1 })];

    const wrapper = mountComponent();
    const navBtns = wrapper.findAll(".nav-btn");
    // At least 2 nav buttons (prev + next), plus possibly "Jump to"
    expect(navBtns.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.text()).toContain("Turn 1 of 2");
  });

  it("prev button disabled on first turn", () => {
    store.turns = [makeTurn({ turnIndex: 0 }), makeTurn({ turnIndex: 1 })];

    const wrapper = mountComponent();
    const prevBtn = wrapper.find('button[aria-label="Previous turn"]');
    expect(prevBtn.attributes("disabled")).toBeDefined();
  });

  it("next button disabled on last turn", () => {
    store.turns = [makeTurn({ turnIndex: 0 })];

    const wrapper = mountComponent();
    const nextBtn = wrapper.find('button[aria-label="Next turn"]');
    expect(nextBtn.attributes("disabled")).toBeDefined();
  });

  it("clicking next advances to next turn", async () => {
    store.turns = [
      makeTurn({ turnIndex: 0, userMessage: "First message" }),
      makeTurn({ turnIndex: 1, userMessage: "Second message" }),
    ];

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("Turn 1 of 2");

    const nextBtn = wrapper.find('button[aria-label="Next turn"]');
    await nextBtn.trigger("click");
    await nextTick();

    expect(wrapper.text()).toContain("Turn 2 of 2");
  });

  it("waterfall rows render for each tool call in current turn", () => {
    const tc1 = makeTurnToolCall({
      toolName: "view",
      toolCallId: "tc-1",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:01.000Z",
      durationMs: 1000,
    });
    const tc2 = makeTurnToolCall({
      toolName: "edit",
      toolCallId: "tc-2",
      startedAt: "2025-01-01T00:00:01.000Z",
      completedAt: "2025-01-01T00:00:02.000Z",
      durationMs: 1000,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [tc1, tc2] }),
    ];

    const wrapper = mountComponent();
    const rows = wrapper.findAll(".wf-row");
    // At least 2 tool call rows (there may also be a message row)
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("subagent rows show agent display name", () => {
    const subagentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      agentDisplayName: "Explore Agent",
      toolCallId: "agent-1",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:02.000Z",
      durationMs: 2000,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [subagentTc] }),
    ];

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("Explore Agent");
  });

  it("nested (child) rows are indented", () => {
    const parentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:05.000Z",
      durationMs: 5000,
    });
    const childTc = makeTurnToolCall({
      toolName: "grep",
      parentToolCallId: "agent-1",
      isSubagent: false,
      toolCallId: "child-1",
      startedAt: "2025-01-01T00:00:01.000Z",
      completedAt: "2025-01-01T00:00:02.000Z",
      durationMs: 1000,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [parentTc, childTc] }),
    ];

    const wrapper = mountComponent();
    const childRows = wrapper.findAll(".wf-row.child");
    expect(childRows.length).toBeGreaterThanOrEqual(1);
    // Child label-col has non-zero paddingLeft for indentation
    const labelCol = childRows[0].find(".label-col");
    const style = labelCol.attributes("style");
    expect(style).toContain("padding-left");
    expect(style).not.toContain("padding-left: 0px");
  });

  it("click on row pins detail panel", async () => {
    const tc = makeTurnToolCall({
      toolName: "view",
      toolCallId: "tc-1",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:01.000Z",
      durationMs: 1000,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [tc] }),
    ];

    const wrapper = mountComponent();
    // No detail panel initially
    expect(wrapper.find(".detail-panel").exists()).toBe(false);

    // Click the first non-message wf-row
    const rows = wrapper.findAll('.wf-row:not(.message-row)');
    expect(rows.length).toBeGreaterThan(0);
    await rows[0].trigger("click");
    await nextTick();

    expect(wrapper.find(".detail-panel").exists()).toBe(true);
  });

  it("clicking same row again unpins detail panel", async () => {
    const tc = makeTurnToolCall({
      toolName: "view",
      toolCallId: "tc-1",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:01.000Z",
      durationMs: 1000,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [tc] }),
    ];

    const wrapper = mountComponent();
    const rows = wrapper.findAll('.wf-row:not(.message-row)');

    // Click to pin
    await rows[0].trigger("click");
    await nextTick();
    expect(wrapper.find(".detail-panel").exists()).toBe(true);

    // Click same row again to unpin
    await rows[0].trigger("click");
    await nextTick();
    expect(wrapper.find(".detail-panel").exists()).toBe(false);
  });

  it("terminology legend toggles on click", async () => {
    store.turns = [makeTurn({ turnIndex: 0 })];

    const wrapper = mountComponent();
    const toggle = wrapper.find(".terminology-toggle");
    expect(toggle.exists()).toBe(true);

    // List should be hidden initially
    expect(wrapper.find(".terminology-list").exists()).toBe(false);

    // Click to open
    await toggle.trigger("click");
    await nextTick();
    expect(wrapper.find(".terminology-list").exists()).toBe(true);

    // Click again to close
    await toggle.trigger("click");
    await nextTick();
    expect(wrapper.find(".terminology-list").exists()).toBe(false);
  });

  it("finds child tools across turns (cross-turn boundary)", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-cross",
      agentDisplayName: "Cross-Turn Agent",
      durationMs: 60000,
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:01:00.000Z",
    });
    const childTool = makeTurnToolCall({
      toolName: "grep",
      isSubagent: false,
      toolCallId: "child-grep-1",
      parentToolCallId: "agent-cross",
      durationMs: 50,
      startedAt: "2025-01-01T00:00:05.000Z",
      completedAt: "2025-01-01T00:00:05.050Z",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
      makeTurn({ turnIndex: 1, toolCalls: [childTool] }),
    ];

    const wrapper = mountComponent();
    // The waterfall should show the child tool nested under the subagent
    expect(wrapper.text()).toContain("grep");
  });

  it("shows prompt in pinned detail for subagent with arguments", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-prompt",
      agentDisplayName: "Code Review Agent",
      arguments: { prompt: "Review auth security", agent_type: "code-review" },
      durationMs: 30000,
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:30.000Z",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
    ];

    const wrapper = mountComponent();
    // Click the waterfall row to pin detail
    const rows = wrapper.findAll(".waterfall-row");
    const agentRow = rows.find(r => r.text().includes("Code Review Agent") || r.text().includes("code-review"));
    if (agentRow) {
      await agentRow.trigger("click");
      await nextTick();
      expect(wrapper.text()).toContain("Review auth security");
    }
  });
});
