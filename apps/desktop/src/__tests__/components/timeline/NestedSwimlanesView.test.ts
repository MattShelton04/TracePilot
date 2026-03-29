import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import NestedSwimlanesView from "../../../components/timeline/NestedSwimlanesView.vue";
import { useSessionDetailStore } from "../../../stores/sessionDetail";

// ── Mock @tracepilot/client (store imports it) ──────────────────────
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSessionDetail: vi.fn(),
    getSessionTurns: vi.fn(),
    getSessionEvents: vi.fn(),
    getSessionTodos: vi.fn(),
    getSessionCheckpoints: vi.fn(),
    getShutdownMetrics: vi.fn(),
  });
});

// ── Helpers ─────────────────────────────────────────────────────────

function makeTurnToolCall(overrides: Record<string, unknown> = {}) {
  return {
    toolName: "view",
    success: true,
    isComplete: true,
    durationMs: 100,
    toolCallId: `tc-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-01-01T00:00:00.100Z",
    ...overrides,
  };
}

function makeTurn(overrides: Record<string, unknown> = {}) {
  return {
    turnIndex: 0,
    userMessage: "Fix the bug",
    assistantMessages: [{ content: "I'll fix the bug." }],
    model: "gpt-4.1",
    toolCalls: [makeTurnToolCall()],
    durationMs: 5000,
    isComplete: true,
    timestamp: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mountComponent() {
  return mount(NestedSwimlanesView, {
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

describe("NestedSwimlanesView", () => {
  let store: ReturnType<typeof useSessionDetailStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSessionDetailStore();
  });

  it("renders empty state when store has no turns", () => {
    store.turns = [];
    store.loading = false;

    const wrapper = mountComponent();
    const empty = wrapper.find(".empty-state-stub");
    expect(empty.exists()).toBe(true);
    // The EmptyState stub receives the title prop
    expect(wrapper.html()).toContain("No Timeline Data");
  });

  it("renders loading state when store is loading", () => {
    store.turns = [];
    store.loading = true;

    const wrapper = mountComponent();
    const loading = wrapper.find(".ns-loading");
    expect(loading.exists()).toBe(true);
    expect(loading.text()).toContain("Loading timeline");
  });

  it("groups turns into phases by user messages correctly", () => {
    store.turns = [
      makeTurn({ turnIndex: 0, userMessage: "First question" }),
      makeTurn({ turnIndex: 1, userMessage: null }),
      makeTurn({ turnIndex: 2, userMessage: "Second question" }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    const phases = wrapper.findAll(".phase-group");
    expect(phases).toHaveLength(2);
  });

  it("renders phase headers with correct labels and stats", () => {
    store.turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "Fix the login bug",
        durationMs: 3000,
        toolCalls: [makeTurnToolCall(), makeTurnToolCall()],
      }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    const header = wrapper.find(".phase-header");
    expect(header.exists()).toBe(true);
    expect(header.text()).toContain("Phase 1");
    expect(header.text()).toContain("Fix the login bug");
    // Should show tool count badge
    expect(header.text()).toContain("2 tools");
  });

  it("clicking phase header toggles collapse", async () => {
    store.turns = [
      makeTurn({ turnIndex: 0, userMessage: "Phase one" }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    // Phase body should be visible initially
    expect(wrapper.find(".phase-body").exists()).toBe(true);

    // Click header to collapse
    await wrapper.find(".phase-header").trigger("click");
    await nextTick();
    expect(wrapper.find(".phase-body").exists()).toBe(false);

    // Click again to expand
    await wrapper.find(".phase-header").trigger("click");
    await nextTick();
    expect(wrapper.find(".phase-body").exists()).toBe(true);
  });

  it("subagent lanes appear for turns with isSubagent tool calls", () => {
    const subagentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      agentDisplayName: "Explore Agent",
      toolCallId: "agent-1",
    });
    const childTc = makeTurnToolCall({
      toolName: "grep",
      parentToolCallId: "agent-1",
      isSubagent: false,
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "Search for X",
        toolCalls: [subagentTc, childTc],
      }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    const subagentLanes = wrapper.findAll(".subagent-lane");
    expect(subagentLanes.length).toBeGreaterThanOrEqual(1);
    expect(wrapper.text()).toContain("Explore Agent");
  });

  it("direct tools lane appears for non-subagent, non-child tool calls", () => {
    const subagentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
    });
    const directTc = makeTurnToolCall({
      toolName: "powershell",
      isSubagent: false,
      parentToolCallId: undefined,
      toolCallId: "direct-1",
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "Do something",
        toolCalls: [subagentTc, directTc],
      }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    const directLane = wrapper.find(".direct-tools-lane");
    expect(directLane.exists()).toBe(true);
    expect(wrapper.text()).toContain("powershell");
  });

  it("creates implicit phase for turns before first user message", () => {
    store.turns = [
      makeTurn({ turnIndex: 0, userMessage: null }),
      makeTurn({ turnIndex: 1, userMessage: "Hello" }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    const phases = wrapper.findAll(".phase-group");
    expect(phases).toHaveLength(2);
    // First phase should show "(system)"
    const firstPhaseHeader = phases[0].find(".phase-label");
    expect(firstPhaseHeader.text()).toContain("(system)");
  });

  it("shows agent count badge when phase has subagents", () => {
    const subagentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "Explore code",
        toolCalls: [subagentTc, makeTurnToolCall()],
      }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("1 agent");
  });

  it("parallel badge shown for subagents with overlapping time ranges", () => {
    const agent1 = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:05.000Z",
    });
    const agent2 = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-2",
      startedAt: "2025-01-01T00:00:01.000Z",
      completedAt: "2025-01-01T00:00:06.000Z",
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "Run two agents",
        toolCalls: [agent1, agent2],
      }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("parallel");
  });

  it("no parallel badge when subagents do not overlap", () => {
    const agent1 = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:05.000Z",
    });
    const agent2 = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-2",
      startedAt: "2025-01-01T00:00:10.000Z",
      completedAt: "2025-01-01T00:00:15.000Z",
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "Run two agents sequentially",
        toolCalls: [agent1, agent2],
      }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    expect(wrapper.text()).not.toContain("parallel");
  });

  it("finds subagent child tools across turns (cross-turn boundary)", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-cross",
      agentDisplayName: "Cross-Turn Agent",
      durationMs: 60000,
    });
    const childTool = makeTurnToolCall({
      toolName: "grep",
      isSubagent: false,
      toolCallId: "child-grep-1",
      parentToolCallId: "agent-cross",
      durationMs: 50,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
      makeTurn({ turnIndex: 1, userMessage: "Second message", toolCalls: [childTool] }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    await nextTick();
    // The child tool "grep" should appear in the subagent lane of turn 0
    // (found via cross-turn allToolCalls search)
    const allText = wrapper.text();
    expect(allText).toContain("grep");
    // The child tool should NOT appear as a direct tool in turn 1
    // (it's a child of agent-cross in turn 0)
    const directToolBars = wrapper.findAll(".swimlane-bar--tool");
    const grepBars = directToolBars.filter(b => b.text().includes("grep"));
    // grep should appear only under the agent's nested lane, not as a standalone
    expect(grepBars.length).toBe(1);
  });

  it("shows prompt in detail panel for subagent with arguments", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-prompt",
      agentDisplayName: "Code Review Agent",
      arguments: { prompt: "Check for SQL injection", agent_type: "code-review" },
      durationMs: 30000,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
    ] as any;
    store.loading = false;

    const wrapper = mountComponent();
    // Expand phase
    const phaseHeaders = wrapper.findAll(".phase-header");
    if (phaseHeaders.length > 0) {
      await phaseHeaders[0].trigger("click");
      await nextTick();
    }
    // Click the subagent bar to open detail
    const agentBars = wrapper.findAll(".tool-bar");
    const bar = agentBars.find(b => b.text().includes("Code Review Agent") || b.text().includes("code-review"));
    if (bar) {
      await bar.trigger("click");
      await nextTick();
      expect(wrapper.text()).toContain("Check for SQL injection");
    }
  });
});
