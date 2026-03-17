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
    assistantMessages: [{ content: "Done." }],
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

  it("finds child tools across turns (cross-turn boundary)", () => {
    // Subagent in turn 0, its child tools end up in turn 1
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-cross",
      agentDisplayName: "Cross-Turn Agent",
      durationMs: 120000,
    });
    // Child tool in a DIFFERENT turn
    const childTool = makeTurnToolCall({
      toolName: "grep",
      isSubagent: false,
      toolCallId: "child-grep-1",
      parentToolCallId: "agent-cross",
      durationMs: 50,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
      makeTurn({ turnIndex: 1, toolCalls: [childTool] }),
    ] as any;

    const wrapper = mountComponent();
    // The agent node should show "1 tool" (found cross-turn)
    expect(wrapper.text()).toContain("1 tool");
  });

  it("shows prompt in detail panel when subagent has arguments", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-prompt",
      agentDisplayName: "Code Review Agent",
      arguments: { prompt: "Review the auth module for vulnerabilities", agent_type: "code-review" },
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
    ] as any;

    const wrapper = mountComponent();
    // Click the subagent node to open detail panel
    const nodes = wrapper.findAll(".agent-node");
    const childNode = nodes.find(n => n.text().includes("Code Review Agent"));
    expect(childNode).toBeDefined();
    await childNode!.trigger("click");
    await nextTick();

    expect(wrapper.find(".detail-panel").exists()).toBe(true);
    expect(wrapper.text()).toContain("Review the auth module for vulnerabilities");
  });

  it("in-progress subagent shows ⏳ and pulsing node class", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      isComplete: false,
      success: undefined,
      toolCallId: "agent-ip",
      agentDisplayName: "Running Agent",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: undefined,
      durationMs: undefined,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
    ] as any;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("⏳");
    const nodes = wrapper.findAll(".agent-node");
    const inProgressNode = nodes.find(n => n.text().includes("Running Agent"));
    expect(inProgressNode).toBeDefined();
    expect(inProgressNode!.classes()).toContain("agent-node--in-progress");
  });

  it("main agent tool list includes subagent-spawning tool calls with agent badge", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-spawn-1",
      agentDisplayName: "Explore Agent",
      arguments: { agent_type: "explore", prompt: "Find auth code" },
    });
    const directTool = makeTurnToolCall({
      toolName: "view",
      isSubagent: false,
      toolCallId: "tc-view-1",
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc, directTool] }),
    ] as any;

    const wrapper = mountComponent();
    // Click main agent node to open detail panel
    const mainNode = wrapper.findAll(".agent-node").find(n => n.text().includes("Main Agent"));
    expect(mainNode).toBeDefined();
    await mainNode!.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    expect(detailPanel.exists()).toBe(true);
    // Should show both the subagent tool call and the direct tool
    expect(detailPanel.text()).toContain("Explore Agent");
    expect(detailPanel.text()).toContain("view");
    // Subagent tool call should have an "agent" badge
    const agentBadges = wrapper.findAll(".detail-agent-badge");
    expect(agentBadges.length).toBe(1);
  });

  it("in-progress node status icon has pulsing animation class", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      isComplete: false,
      success: undefined,
      toolCallId: "agent-pulse",
      agentDisplayName: "Pulsing Agent",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: undefined,
      durationMs: undefined,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
    ] as any;

    const wrapper = mountComponent();
    const statusIcons = wrapper.findAll(".agent-node-status--in-progress");
    expect(statusIcons.length).toBeGreaterThan(0);
  });

  // ── Subagent Output Tests ─────────────────────────────────────────

  it("shows output section when a subagent with messages is selected", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [
          { content: "Main agent text" },
          { content: "Subagent found the answer", parentToolCallId: "agent-1" },
        ],
      }),
    ] as any;

    const wrapper = mountComponent();
    // Select the subagent node (second node after main)
    const nodes = wrapper.findAll(".agent-node");
    const subagentNode = nodes.find(n => n.text().includes("Explore Agent"));
    expect(subagentNode).toBeDefined();
    await subagentNode!.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    expect(detailPanel.exists()).toBe(true);
    expect(detailPanel.text()).toContain("Output");
    expect(detailPanel.text()).toContain("Subagent found the answer");
    // Main agent text should NOT appear in the subagent output
    expect(detailPanel.find(".detail-output").text()).not.toContain("Main agent text");
  });

  it("shows reasoning section with toggle when subagent has reasoning", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Thinking Agent",
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [
          { content: "Result", parentToolCallId: "agent-1" },
        ],
        reasoningTexts: [
          { content: "Let me think about this...", parentToolCallId: "agent-1" },
        ],
      }),
    ] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll(".agent-node");
    const subagentNode = nodes.find(n => n.text().includes("Thinking Agent"));
    await subagentNode!.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    // Reasoning toggle should exist
    const reasoningToggle = detailPanel.find(".reasoning-toggle");
    expect(reasoningToggle.exists()).toBe(true);
    expect(reasoningToggle.text()).toContain("1 reasoning block");

    // Reasoning content hidden by default
    expect(detailPanel.find(".reasoning-content").exists()).toBe(false);

    // Click to expand
    await reasoningToggle.trigger("click");
    await nextTick();
    expect(detailPanel.find(".reasoning-content").exists()).toBe(true);
    expect(detailPanel.find(".reasoning-content").text()).toContain("Let me think about this...");
  });

  it("main agent node excludes subagent-attributed messages", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Sub Agent",
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [
          { content: "Main says hello" },
          { content: "Sub says hello", parentToolCallId: "agent-1" },
        ],
      }),
    ] as any;

    const wrapper = mountComponent();
    // Select main agent node (first node)
    const nodes = wrapper.findAll(".agent-node");
    const mainNode = nodes.find(n => n.text().includes("Main Agent"));
    expect(mainNode).toBeDefined();
    await mainNode!.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    expect(detailPanel.exists()).toBe(true);
    // Main output should contain only main agent's message
    expect(detailPanel.text()).toContain("Main says hello");
    // Subagent message should NOT appear in main agent's output
    const outputSection = detailPanel.find(".detail-output");
    if (outputSection.exists()) {
      expect(outputSection.text()).not.toContain("Sub says hello");
    }
  });

  it("does not show output section when subagent has no messages", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Silent Agent",
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [{ content: "Main only" }],
      }),
    ] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll(".agent-node");
    const subagentNode = nodes.find(n => n.text().includes("Silent Agent"));
    await subagentNode!.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    expect(detailPanel.exists()).toBe(true);
    // No Output heading since no messages
    const sectionTitles = detailPanel.findAll(".detail-section-title");
    const outputTitle = sectionTitles.filter(t => t.text() === "Output");
    expect(outputTitle.length).toBe(0);
    // No reasoning toggle
    expect(detailPanel.find(".reasoning-toggle").exists()).toBe(false);
  });
});
