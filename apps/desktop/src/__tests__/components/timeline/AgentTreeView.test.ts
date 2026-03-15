import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import AgentTreeView from "../../../components/timeline/AgentTreeView.vue";
import { useSessionDetailStore } from "../../../stores/sessionDetail";

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

function makeTurnToolCall(overrides: Record<string, unknown> = {}) {
  return {
    toolName: "view",
    success: true,
    isComplete: true,
    durationMs: 200,
    toolCallId: `tc-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-01-01T00:00:00.200Z",
    ...overrides,
  };
}

function makeTurn(overrides: Record<string, unknown> = {}) {
  return {
    turnIndex: 0,
    userMessage: "Fix the bug",
    assistantMessages: ["Done."],
    model: "gpt-4.1",
    toolCalls: [] as ReturnType<typeof makeTurnToolCall>[],
    durationMs: 5000,
    isComplete: true,
    timestamp: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mountComponent() {
  return mount(AgentTreeView, {
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

describe("AgentTreeView", () => {
  let store: ReturnType<typeof useSessionDetailStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSessionDetailStore();
  });

  it("renders empty state when no turns have subagents", () => {
    // Turns with only non-subagent tool calls
    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [makeTurnToolCall({ isSubagent: false })],
      }),
    ] as any;

    const wrapper = mountComponent();
    const empty = wrapper.find(".empty-state-stub");
    expect(empty.exists()).toBe(true);
    expect(wrapper.html()).toContain("No Agent Orchestration");
  });

  it("shows turn navigation for turns with subagents", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
      makeTurn({
        turnIndex: 1,
        toolCalls: [
          makeTurnToolCall({
            toolName: "task",
            isSubagent: true,
            toolCallId: "agent-2",
            agentDisplayName: "Task Agent",
          }),
        ],
      }),
    ] as any;

    const wrapper = mountComponent();
    const navLabel = wrapper.find(".turn-nav-label");
    expect(navLabel.exists()).toBe(true);
    expect(navLabel.text()).toContain("1 of 2 with agents");
  });

  it("root node shows Main Agent with turn model", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, model: "gpt-4.1", toolCalls: [agentTc] }),
    ] as any;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("Main Agent");
    expect(wrapper.text()).toContain("gpt-4.1");
  });

  it("subagent child nodes appear with correct display names", () => {
    const agent1 = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:05.000Z",
      durationMs: 5000,
    });
    const agent2 = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-2",
      agentDisplayName: "Code Review Agent",
      startedAt: "2025-01-01T00:00:06.000Z",
      completedAt: "2025-01-01T00:00:10.000Z",
      durationMs: 4000,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agent1, agent2] }),
    ] as any;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("Explore Agent");
    expect(wrapper.text()).toContain("Code Review Agent");
  });

  it("subagent nodes show their own model (tc.model) if available", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
      model: "claude-haiku-4.5",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, model: "gpt-4.1", toolCalls: [agentTc] }),
    ] as any;

    const wrapper = mountComponent();
    // The agent node should show its own model
    expect(wrapper.text()).toContain("claude-haiku-4.5");
  });

  it("clicking a node selects it and shows detail panel", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
    ] as any;

    const wrapper = mountComponent();
    // No detail panel initially
    expect(wrapper.find(".detail-panel").exists()).toBe(false);

    // Click a node
    const nodes = wrapper.findAll(".agent-node");
    expect(nodes.length).toBeGreaterThan(0);
    await nodes[0].trigger("click");
    await nextTick();

    expect(wrapper.find(".detail-panel").exists()).toBe(true);
  });

  it("clicking same node deselects it", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
    ] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll(".agent-node");

    // Click to select
    await nodes[0].trigger("click");
    await nextTick();
    expect(wrapper.find(".detail-panel").exists()).toBe(true);

    // Click same node to deselect
    await nodes[0].trigger("click");
    await nextTick();
    expect(wrapper.find(".detail-panel").exists()).toBe(false);
  });

  it("parallel groups detect overlapping time ranges", () => {
    // Two subagents with overlapping time ranges
    const agent1 = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Agent A",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:05.000Z",
      durationMs: 5000,
    });
    const agent2 = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-2",
      agentDisplayName: "Agent B",
      startedAt: "2025-01-01T00:00:02.000Z",
      completedAt: "2025-01-01T00:00:07.000Z",
      durationMs: 5000,
    });
    // Third non-overlapping agent to ensure we have multiple groups
    // (parallelGroups returns [] when there's only 1 group)
    const agent3 = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-3",
      agentDisplayName: "Agent C",
      startedAt: "2025-01-01T00:00:20.000Z",
      completedAt: "2025-01-01T00:00:25.000Z",
      durationMs: 5000,
    });
    const agent4 = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-4",
      agentDisplayName: "Agent D",
      startedAt: "2025-01-01T00:00:22.000Z",
      completedAt: "2025-01-01T00:00:27.000Z",
      durationMs: 5000,
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agent1, agent2, agent3, agent4],
      }),
    ] as any;

    const wrapper = mountComponent();
    // With 2+ parallel groups, parallel badges should appear
    const badges = wrapper.findAll(".parallel-badge");
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.text()).toContain("Parallel Group");
  });

  it("nodes with no overlap are not grouped together", () => {
    const agent1 = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Agent A",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:02.000Z",
      durationMs: 2000,
    });
    const agent2 = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-2",
      agentDisplayName: "Agent B",
      startedAt: "2025-01-01T00:00:10.000Z",
      completedAt: "2025-01-01T00:00:12.000Z",
      durationMs: 2000,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agent1, agent2] }),
    ] as any;

    const wrapper = mountComponent();
    // No parallel badges should appear for non-overlapping agents
    const badges = wrapper.findAll(".parallel-badge");
    expect(badges).toHaveLength(0);
  });

  it("prev button disabled on first agent turn", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
    ] as any;

    const wrapper = mountComponent();
    const prevBtn = wrapper.find('button[aria-label="Previous agent turn"]');
    expect(prevBtn.attributes("disabled")).toBeDefined();
  });

  it("next button disabled on last agent turn", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
    ] as any;

    const wrapper = mountComponent();
    const nextBtn = wrapper.find('button[aria-label="Next agent turn"]');
    expect(nextBtn.attributes("disabled")).toBeDefined();
  });
});
