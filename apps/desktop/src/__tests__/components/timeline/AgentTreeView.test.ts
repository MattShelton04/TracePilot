import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import AgentTreeView from '../../../components/timeline/AgentTreeView.vue';
import { useSessionDetailStore } from '../../../stores/sessionDetail';

// ── Mock @tracepilot/client ─────────────────────────────────────────
vi.mock('@tracepilot/client', () => ({
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
    toolName: 'view',
    success: true,
    isComplete: true,
    durationMs: 200,
    toolCallId: `tc-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: '2025-01-01T00:00:00.000Z',
    completedAt: '2025-01-01T00:00:00.200Z',
    ...overrides,
  };
}

function makeTurn(overrides: Record<string, unknown> = {}) {
  return {
    turnIndex: 0,
    userMessage: 'Fix the bug',
    assistantMessages: [{ content: 'Done.' }],
    model: 'gpt-4.1',
    toolCalls: [] as ReturnType<typeof makeTurnToolCall>[],
    durationMs: 5000,
    isComplete: true,
    timestamp: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mountComponent() {
  return mount(AgentTreeView, {
    global: {
      stubs: {
        EmptyState: {
          template: '<div class="empty-state-stub">{{ title }}</div>',
          props: ['icon', 'title', 'message'],
        },
        Badge: {
          template: '<span class="badge-stub"><slot /></span>',
          props: ['variant'],
        },
        ExpandChevron: {
          template: '<span class="chevron-stub" />',
          props: ['expanded', 'size'],
        },
      },
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentTreeView', () => {
  let store: ReturnType<typeof useSessionDetailStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSessionDetailStore();
  });

  it('renders empty state when no turns have subagents', () => {
    // Turns with only non-subagent tool calls
    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [makeTurnToolCall({ isSubagent: false })],
      }),
    ] as any;

    const wrapper = mountComponent();
    const empty = wrapper.find('.empty-state-stub');
    expect(empty.exists()).toBe(true);
    expect(wrapper.html()).toContain('No Agent Orchestration');
  });

  it('shows turn navigation for turns with subagents', () => {
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Explore Agent',
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
      makeTurn({
        turnIndex: 1,
        toolCalls: [
          makeTurnToolCall({
            toolName: 'task',
            isSubagent: true,
            toolCallId: 'agent-2',
            agentDisplayName: 'Task Agent',
          }),
        ],
      }),
    ] as any;

    const wrapper = mountComponent();
    const navLabel = wrapper.find('.turn-nav-label');
    expect(navLabel.exists()).toBe(true);
    expect(navLabel.text()).toContain('1 of 2 with agents');
  });

  it('root node shows Main Agent with turn model', () => {
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Explore',
    });

    store.turns = [makeTurn({ turnIndex: 0, model: 'gpt-4.1', toolCalls: [agentTc] })] as any;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('Main Agent');
    expect(wrapper.text()).toContain('gpt-4.1');
  });

  it('subagent child nodes appear with correct display names', () => {
    const agent1 = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Explore Agent',
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:05.000Z',
      durationMs: 5000,
    });
    const agent2 = makeTurnToolCall({
      toolName: 'code-review',
      isSubagent: true,
      toolCallId: 'agent-2',
      agentDisplayName: 'Code Review Agent',
      startedAt: '2025-01-01T00:00:06.000Z',
      completedAt: '2025-01-01T00:00:10.000Z',
      durationMs: 4000,
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agent1, agent2] })] as any;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('Explore Agent');
    expect(wrapper.text()).toContain('Code Review Agent');
  });

  it('subagent nodes show their own model (tc.model) if available', () => {
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Explore Agent',
      model: 'claude-haiku-4.5',
    });

    store.turns = [makeTurn({ turnIndex: 0, model: 'gpt-4.1', toolCalls: [agentTc] })] as any;

    const wrapper = mountComponent();
    // The agent node should show its own model
    expect(wrapper.text()).toContain('claude-haiku-4.5');
  });

  it('clicking a node selects it and shows detail panel', async () => {
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Explore Agent',
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })] as any;

    const wrapper = mountComponent();
    // No detail panel initially
    expect(wrapper.find('.detail-panel').exists()).toBe(false);

    // Click a node
    const nodes = wrapper.findAll('.agent-node');
    expect(nodes.length).toBeGreaterThan(0);
    await nodes[0].trigger('click');
    await nextTick();

    expect(wrapper.find('.detail-panel').exists()).toBe(true);
  });

  it('clicking same node deselects it', async () => {
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Explore Agent',
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll('.agent-node');

    // Click to select
    await nodes[0].trigger('click');
    await nextTick();
    expect(wrapper.find('.detail-panel').exists()).toBe(true);

    // Click same node to deselect
    await nodes[0].trigger('click');
    await nextTick();
    expect(wrapper.find('.detail-panel').exists()).toBe(false);
  });

  it('parallel groups detect overlapping time ranges', () => {
    // Two subagents with overlapping time ranges
    const agent1 = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Agent A',
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:05.000Z',
      durationMs: 5000,
    });
    const agent2 = makeTurnToolCall({
      toolName: 'code-review',
      isSubagent: true,
      toolCallId: 'agent-2',
      agentDisplayName: 'Agent B',
      startedAt: '2025-01-01T00:00:02.000Z',
      completedAt: '2025-01-01T00:00:07.000Z',
      durationMs: 5000,
    });
    // Third non-overlapping agent to ensure we have multiple groups
    // (parallelGroups returns [] when there's only 1 group)
    const agent3 = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-3',
      agentDisplayName: 'Agent C',
      startedAt: '2025-01-01T00:00:20.000Z',
      completedAt: '2025-01-01T00:00:25.000Z',
      durationMs: 5000,
    });
    const agent4 = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-4',
      agentDisplayName: 'Agent D',
      startedAt: '2025-01-01T00:00:22.000Z',
      completedAt: '2025-01-01T00:00:27.000Z',
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
    const badges = wrapper.findAll('.parallel-badge');
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.text()).toContain('Parallel Group');
  });

  it('nodes with no overlap are not grouped together', () => {
    const agent1 = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Agent A',
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:02.000Z',
      durationMs: 2000,
    });
    const agent2 = makeTurnToolCall({
      toolName: 'code-review',
      isSubagent: true,
      toolCallId: 'agent-2',
      agentDisplayName: 'Agent B',
      startedAt: '2025-01-01T00:00:10.000Z',
      completedAt: '2025-01-01T00:00:12.000Z',
      durationMs: 2000,
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agent1, agent2] })] as any;

    const wrapper = mountComponent();
    // No parallel badges should appear for non-overlapping agents
    const badges = wrapper.findAll('.parallel-badge');
    expect(badges).toHaveLength(0);
  });

  it('prev button disabled on first agent turn', () => {
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })] as any;

    const wrapper = mountComponent();
    const prevBtn = wrapper.find('button[aria-label="Previous agent turn"]');
    expect(prevBtn.attributes('disabled')).toBeDefined();
  });

  it('next button disabled on last agent turn', () => {
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-1',
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })] as any;

    const wrapper = mountComponent();
    const nextBtn = wrapper.find('button[aria-label="Next agent turn"]');
    expect(nextBtn.attributes('disabled')).toBeDefined();
  });

  it('finds child tools across turns (cross-turn boundary)', () => {
    // Subagent in turn 0, its child tools end up in turn 1
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      toolCallId: 'agent-cross',
      agentDisplayName: 'Cross-Turn Agent',
      durationMs: 120000,
    });
    // Child tool in a DIFFERENT turn
    const childTool = makeTurnToolCall({
      toolName: 'grep',
      isSubagent: false,
      toolCallId: 'child-grep-1',
      parentToolCallId: 'agent-cross',
      durationMs: 50,
    });

    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
      makeTurn({ turnIndex: 1, toolCalls: [childTool] }),
    ] as any;

    const wrapper = mountComponent();
    // The agent node should show "1 tool" (found cross-turn)
    expect(wrapper.text()).toContain('1 tool');
  });

  it('shows prompt in detail panel when subagent has arguments', async () => {
    const agentTc = makeTurnToolCall({
      toolName: 'code-review',
      isSubagent: true,
      toolCallId: 'agent-prompt',
      agentDisplayName: 'Code Review Agent',
      arguments: {
        prompt: 'Review the auth module for vulnerabilities',
        agent_type: 'code-review',
      },
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })] as any;

    const wrapper = mountComponent();
    // Click the subagent node to open detail panel
    const nodes = wrapper.findAll('.agent-node');
    const childNode = nodes.find((n) => n.text().includes('Code Review Agent'));
    expect(childNode).toBeDefined();
    await childNode!.trigger('click');
    await nextTick();

    expect(wrapper.find('.detail-panel').exists()).toBe(true);
    expect(wrapper.text()).toContain('Review the auth module for vulnerabilities');
  });

  it('in-progress subagent shows ⏳ and pulsing node class', () => {
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      isComplete: false,
      success: undefined,
      toolCallId: 'agent-ip',
      agentDisplayName: 'Running Agent',
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: undefined,
      durationMs: undefined,
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })] as any;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('⏳');
    const nodes = wrapper.findAll('.agent-node');
    const inProgressNode = nodes.find((n) => n.text().includes('Running Agent'));
    expect(inProgressNode).toBeDefined();
    expect(inProgressNode!.classes()).toContain('agent-node--in-progress');
  });

  it('main agent tool list includes subagent-spawning tool calls with agent badge', async () => {
    const agentTc = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-spawn-1',
      agentDisplayName: 'Explore Agent',
      arguments: { agent_type: 'explore', prompt: 'Find auth code' },
    });
    const directTool = makeTurnToolCall({
      toolName: 'view',
      isSubagent: false,
      toolCallId: 'tc-view-1',
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc, directTool] })] as any;

    const wrapper = mountComponent();
    // Click main agent node to open detail panel
    const mainNode = wrapper.findAll('.agent-node').find((n) => n.text().includes('Main Agent'));
    expect(mainNode).toBeDefined();
    await mainNode!.trigger('click');
    await nextTick();

    const detailPanel = wrapper.find('.detail-panel');
    expect(detailPanel.exists()).toBe(true);
    // Should show both the subagent tool call and the direct tool
    expect(detailPanel.text()).toContain('Explore Agent');
    expect(detailPanel.text()).toContain('view');
    // Subagent tool call should have an "agent" badge
    const agentBadges = wrapper.findAll('.detail-agent-badge');
    expect(agentBadges.length).toBe(1);
  });

  it('in-progress node status icon has pulsing animation class', () => {
    const agentTc = makeTurnToolCall({
      toolName: 'explore',
      isSubagent: true,
      isComplete: false,
      success: undefined,
      toolCallId: 'agent-pulse',
      agentDisplayName: 'Pulsing Agent',
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: undefined,
      durationMs: undefined,
    });

    store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })] as any;

    const wrapper = mountComponent();
    const statusIcons = wrapper.findAll('.agent-node-status--in-progress');
    expect(statusIcons.length).toBeGreaterThan(0);
  });

  // ── Subagent Output Tests ─────────────────────────────────────────

  it('shows output section when a subagent with messages is selected', async () => {
    const agentTc = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Explore Agent',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [
          { content: 'Main agent text' },
          { content: 'Subagent found the answer', parentToolCallId: 'agent-1' },
        ],
      }),
    ] as any;

    const wrapper = mountComponent();
    // Select the subagent node (second node after main)
    const nodes = wrapper.findAll('.agent-node');
    const subagentNode = nodes.find((n) => n.text().includes('Explore Agent'));
    expect(subagentNode).toBeDefined();
    await subagentNode!.trigger('click');
    await nextTick();

    const detailPanel = wrapper.find('.detail-panel');
    expect(detailPanel.exists()).toBe(true);
    expect(detailPanel.text()).toContain('Output');
    expect(detailPanel.text()).toContain('Subagent found the answer');
    // Main agent text should NOT appear in the subagent output
    expect(detailPanel.find('.detail-output').text()).not.toContain('Main agent text');
  });

  it('shows reasoning section with toggle when subagent has reasoning', async () => {
    const agentTc = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Thinking Agent',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [{ content: 'Result', parentToolCallId: 'agent-1' }],
        reasoningTexts: [{ content: 'Let me think about this...', parentToolCallId: 'agent-1' }],
      }),
    ] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll('.agent-node');
    const subagentNode = nodes.find((n) => n.text().includes('Thinking Agent'));
    await subagentNode!.trigger('click');
    await nextTick();

    const detailPanel = wrapper.find('.detail-panel');
    // Reasoning toggle should exist
    const reasoningToggle = detailPanel.find('.reasoning-toggle');
    expect(reasoningToggle.exists()).toBe(true);
    expect(reasoningToggle.text()).toContain('1 reasoning block');

    // Reasoning content hidden by default
    expect(detailPanel.find('.reasoning-content').exists()).toBe(false);

    // Click to expand
    await reasoningToggle.trigger('click');
    await nextTick();
    expect(detailPanel.find('.reasoning-content').exists()).toBe(true);
    expect(detailPanel.find('.reasoning-content').text()).toContain('Let me think about this…');
  });

  it('main agent node excludes subagent-attributed messages', async () => {
    const agentTc = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Sub Agent',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [
          { content: 'Main says hello' },
          { content: 'Sub says hello', parentToolCallId: 'agent-1' },
        ],
      }),
    ] as any;

    const wrapper = mountComponent();
    // Select main agent node (first node)
    const nodes = wrapper.findAll('.agent-node');
    const mainNode = nodes.find((n) => n.text().includes('Main Agent'));
    expect(mainNode).toBeDefined();
    await mainNode!.trigger('click');
    await nextTick();

    const detailPanel = wrapper.find('.detail-panel');
    expect(detailPanel.exists()).toBe(true);
    // Main output should contain only main agent's message
    expect(detailPanel.text()).toContain('Main says hello');
    // Subagent message should NOT appear in main agent's output
    const outputSection = detailPanel.find('.detail-output');
    if (outputSection.exists()) {
      expect(outputSection.text()).not.toContain('Sub says hello');
    }
  });

  it('does not show output section when subagent has no messages', async () => {
    const agentTc = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-1',
      agentDisplayName: 'Silent Agent',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [{ content: 'Main only' }],
      }),
    ] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll('.agent-node');
    const subagentNode = nodes.find((n) => n.text().includes('Silent Agent'));
    await subagentNode!.trigger('click');
    await nextTick();

    const detailPanel = wrapper.find('.detail-panel');
    expect(detailPanel.exists()).toBe(true);
    // No Output heading since no messages
    const sectionTitles = detailPanel.findAll('.detail-section-title');
    const outputTitle = sectionTitles.filter((t) => t.text() === 'Output');
    expect(outputTitle.length).toBe(0);
    // No reasoning toggle
    expect(detailPanel.find('.reasoning-toggle').exists()).toBe(false);
  });

  // ── Cross-Turn Hierarchy Tests ──────────────────────────────────────

  it('resolves cross-turn parent subagent hierarchy', async () => {
    // Turn 0: Main agent spawns subagent "parent-sub"
    const parentSubagent = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'parent-sub',
      agentDisplayName: 'GPT 5.3 Codex',
      model: 'gpt-5.3-codex',
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:01:00.000Z',
      durationMs: 60000,
    });

    // Turn 1: The parent subagent spawns child subagents
    const childSub1 = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'child-sub-1',
      parentToolCallId: 'parent-sub',
      agentDisplayName: 'GPT 5.3 Codex #2',
      model: 'gpt-5.3-codex',
      startedAt: '2025-01-01T00:00:10.000Z',
    });
    const childSub2 = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'child-sub-2',
      parentToolCallId: 'parent-sub',
      agentDisplayName: 'GPT 5.4',
      model: 'gpt-5.4',
      startedAt: '2025-01-01T00:00:15.000Z',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        model: 'claude-sonnet-4',
        toolCalls: [parentSubagent],
      }),
      makeTurn({
        turnIndex: 1,
        model: 'gpt-5.3-codex',
        toolCalls: [childSub1, childSub2],
      }),
    ] as any;

    const wrapper = mountComponent();
    // Navigate to the second agent turn (turn 1) which has the child subagents
    const nextBtn = wrapper.find('button[aria-label="Next agent turn"]');
    await nextBtn.trigger('click');
    await nextTick();

    // Should show "GPT 5.3 Codex" as a cross-turn parent node
    // with children nested under it
    expect(wrapper.text()).toContain('GPT 5.3 Codex');
    // The cross-turn badge should appear
    expect(wrapper.find('.cross-turn-badge').exists()).toBe(true);
  });

  it('cross-turn parent nodes show correct child tool counts', async () => {
    const parentSubagent = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'parent-sub',
      agentDisplayName: 'Parent Agent',
      model: 'gpt-5.3-codex',
      startedAt: '2025-01-01T00:00:00.000Z',
    });
    // A child tool that belongs to the parent subagent (from a different turn)
    const parentChildTool = makeTurnToolCall({
      toolName: 'grep',
      isSubagent: false,
      toolCallId: 'parent-child-grep',
      parentToolCallId: 'parent-sub',
    });
    const childSub = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'child-sub',
      parentToolCallId: 'parent-sub',
      agentDisplayName: 'Child Agent',
      startedAt: '2025-01-01T00:00:10.000Z',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [parentSubagent, parentChildTool],
      }),
      makeTurn({
        turnIndex: 1,
        toolCalls: [childSub],
      }),
    ] as any;

    const wrapper = mountComponent();
    // Navigate to second agent turn
    const nextBtn = wrapper.find('button[aria-label="Next agent turn"]');
    await nextBtn.trigger('click');
    await nextTick();

    // Parent agent node should exist as a cross-turn parent
    expect(wrapper.text()).toContain('Parent Agent');
  });

  it('nests same-turn subagent tool calls correctly (attribution fix)', async () => {
    // Parent subagent spawned by Main Agent
    const parentSub = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'parent-same-turn',
      agentDisplayName: 'Parent Same Turn',
    });
    // Child subagent spawned by the parent subagent
    const childSub = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'child-same-turn',
      parentToolCallId: 'parent-same-turn',
      agentDisplayName: 'Child Same Turn',
    });
    // A regular tool spawned by the child subagent
    const childTool = makeTurnToolCall({
      toolName: 'grep',
      isSubagent: false,
      toolCallId: 'child-tool-grep',
      parentToolCallId: 'child-same-turn',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [parentSub, childSub, childTool],
      }),
    ] as any;

    const wrapper = mountComponent();
    await nextTick();

    // 1. Check Main Agent's tool list (should only include parentSub)
    const nodes = wrapper.findAll('.agent-node');
    const mainNode = nodes.find((n) => n.text().includes('Main Agent'));
    await mainNode!.trigger('click');
    await nextTick();

    const detailPanel = wrapper.find('.detail-panel');
    const toolItems = detailPanel.findAll('.detail-tool-row');
    // Main agent should only have ONE tool call (the parent subagent spawn)
    // It should NOT include childSub or childTool
    expect(toolItems.length).toBe(1);
    expect(toolItems[0].text()).toContain('Parent Same Turn');

    // 2. Check Parent Subagent's tool list (should include childSub)
    const parentNode = nodes.find((n) => n.text().includes('Parent Same Turn'));
    await parentNode!.trigger('click');
    await nextTick();

    const parentTools = wrapper.find('.detail-panel').findAll('.detail-tool-row');
    // Parent should have the child subagent spawn in its tool list
    expect(parentTools.length).toBe(1);
    expect(parentTools[0].text()).toContain('Child Same Turn');

    // 3. Check Child Subagent's tool list (should include childTool)
    const childNode = nodes.find((n) => n.text().includes('Child Same Turn'));
    await childNode!.trigger('click');
    await nextTick();

    const childTools = wrapper.find('.detail-panel').findAll('.detail-tool-row');
    expect(childTools.length).toBe(1);
    expect(childTools[0].text()).toContain('grep');
  });

  it('renders unified session view with agents from all turns', async () => {
    // Turn 1: Subagent A
    const subA = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'sub-a',
      agentDisplayName: 'Agent A',
    });
    // Turn 2: Subagent B
    const subB = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'sub-b',
      agentDisplayName: 'Agent B',
    });

    store.turns = [
      makeTurn({ turnIndex: 1, toolCalls: [subA] }),
      makeTurn({ turnIndex: 2, toolCalls: [subB] }),
    ] as any;

    const wrapper = mountComponent();
    await nextTick();

    // Default: Paginated view, only shows Agent A (from turn 1)
    expect(wrapper.text()).toContain('Agent A');
    expect(wrapper.text()).not.toContain('Agent B');

    // Switch to Unified mode
    const unifiedBtn = wrapper.findAll('.view-mode-btn').find((b) => b.text().includes('Unified'));
    await unifiedBtn!.trigger('click');
    await nextTick();

    // Now shows both agents
    expect(wrapper.text()).toContain('Agent A');
    expect(wrapper.text()).toContain('Agent B');

    // Turn navigation should be disabled in unified mode
    const navButtons = wrapper.findAll('.turn-nav-btn');
    navButtons.forEach((btn) => {
      expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    });
  });

  // ── Failure Reason Tests ────────────────────────────────────────────

  it('shows failure reason when a failed subagent is selected', async () => {
    const failedAgent = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-fail',
      agentDisplayName: 'Failing Agent',
      success: false,
      isComplete: true,
      error: 'Agent exceeded maximum retries. Last error: connection timeout',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [failedAgent],
        assistantMessages: [{ content: 'Starting task...', parentToolCallId: 'agent-fail' }],
      }),
    ] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll('.agent-node');
    const failedNode = nodes.find((n) => n.text().includes('Failing Agent'));
    expect(failedNode).toBeDefined();
    await failedNode!.trigger('click');
    await nextTick();

    const detailPanel = wrapper.find('.detail-panel');
    expect(detailPanel.exists()).toBe(true);
    // Should show status as failed
    expect(detailPanel.text()).toContain('failed');
    // Should show failure reason section
    expect(detailPanel.find('.detail-failure').exists()).toBe(true);
    expect(detailPanel.find('.detail-failure-body').text()).toContain('connection timeout');
  });

  it('does not show failure reason for completed subagents', async () => {
    const successAgent = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-ok',
      agentDisplayName: 'Success Agent',
      success: true,
      isComplete: true,
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [successAgent],
        assistantMessages: [{ content: 'Done!', parentToolCallId: 'agent-ok' }],
      }),
    ] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll('.agent-node');
    const okNode = nodes.find((n) => n.text().includes('Success Agent'));
    await okNode!.trigger('click');
    await nextTick();

    expect(wrapper.find('.detail-failure').exists()).toBe(false);
  });

  // ── Output Expand/Collapse Tests ────────────────────────────────────

  it("shows 'Show more' toggle for long output", async () => {
    const longContent = 'A'.repeat(600);
    const agentTc = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-long',
      agentDisplayName: 'Verbose Agent',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [{ content: longContent, parentToolCallId: 'agent-long' }],
      }),
    ] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll('.agent-node');
    const verboseNode = nodes.find((n) => n.text().includes('Verbose Agent'));
    await verboseNode!.trigger('click');
    await nextTick();

    // Output should be collapsed by default
    expect(wrapper.find('.detail-output--collapsed').exists()).toBe(true);
    // Toggle button should exist
    const toggle = wrapper.find('.output-toggle');
    expect(toggle.exists()).toBe(true);
    expect(toggle.text()).toContain('Show more');

    // Click to expand
    await toggle.trigger('click');
    await nextTick();
    expect(wrapper.find('.detail-output--expanded').exists()).toBe(true);
    expect(wrapper.find('.output-toggle').text()).toContain('Show less');
  });

  it('does not show toggle for short output', async () => {
    const agentTc = makeTurnToolCall({
      toolName: 'task',
      isSubagent: true,
      toolCallId: 'agent-short',
      agentDisplayName: 'Brief Agent',
    });

    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [{ content: 'Short answer', parentToolCallId: 'agent-short' }],
      }),
    ] as any;

    const wrapper = mountComponent();
    const nodes = wrapper.findAll('.agent-node');
    const briefNode = nodes.find((n) => n.text().includes('Brief Agent'));
    await briefNode!.trigger('click');
    await nextTick();

    // No toggle for short content
    expect(wrapper.find('.output-toggle').exists()).toBe(false);
  });
});
