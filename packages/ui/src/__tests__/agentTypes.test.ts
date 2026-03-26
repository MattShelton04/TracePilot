import type { TurnToolCall } from '@tracepilot/types';
import { describe, expect, it } from 'vitest';
import {
  AGENT_COLORS,
  AGENT_ICONS,
  type AgentType,
  agentStatusFromToolCall,
  getAgentColor,
  getAgentIcon,
  getToolCallColor,
  getToolStatusColor,
  inferAgentType,
  inferAgentTypeFromToolCall,
  STATUS_ICONS,
} from '../utils/agentTypes';

function makeToolCall(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: 'view',
    isComplete: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('AGENT_COLORS', () => {
  it('has entries for all five agent types', () => {
    const types: AgentType[] = ['main', 'explore', 'general-purpose', 'code-review', 'task'];
    for (const t of types) {
      expect(AGENT_COLORS[t]).toMatch(/^var\(--agent-color-/);
    }
  });
});

describe('AGENT_ICONS', () => {
  it('has entries for all five agent types', () => {
    const types: AgentType[] = ['main', 'explore', 'general-purpose', 'code-review', 'task'];
    for (const t of types) {
      expect(AGENT_ICONS[t]).toBeTruthy();
    }
  });
});

describe('STATUS_ICONS', () => {
  it('has entries for all three statuses', () => {
    expect(STATUS_ICONS.completed).toBeTruthy();
    expect(STATUS_ICONS.failed).toBeTruthy();
    expect(STATUS_ICONS['in-progress']).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// inferAgentType
// ---------------------------------------------------------------------------

describe('inferAgentType', () => {
  it("returns 'explore' for display name containing 'explore'", () => {
    expect(inferAgentType('Explore Agent')).toBe('explore');
  });

  it("returns 'code-review' for display name containing 'code-review'", () => {
    expect(inferAgentType('Code-Review Agent')).toBe('code-review');
  });

  it("returns 'code-review' for display name containing 'code review' (space)", () => {
    expect(inferAgentType('Code Review')).toBe('code-review');
  });

  it("returns 'general-purpose' for display name containing 'general'", () => {
    expect(inferAgentType('General-Purpose Agent')).toBe('general-purpose');
  });

  it('infers from toolName when displayName is absent', () => {
    expect(inferAgentType(undefined, 'explore-codebase')).toBe('explore');
  });

  it("infers from args.agent_type when name doesn't match", () => {
    expect(inferAgentType(undefined, 'task', { agent_type: 'explore' })).toBe('explore');
  });

  it("infers 'code-review' from args.agent_type with underscore", () => {
    expect(inferAgentType(undefined, 'task', { agent_type: 'code_review' })).toBe('code-review');
  });

  it("infers 'task' from args.agent_type", () => {
    expect(inferAgentType(undefined, 'unknown', { agent_type: 'task' })).toBe('task');
  });

  it("defaults to 'task' when nothing matches", () => {
    expect(inferAgentType()).toBe('task');
    expect(inferAgentType('unknown-agent', 'unknown-tool')).toBe('task');
  });

  it('is case-insensitive', () => {
    expect(inferAgentType('EXPLORE')).toBe('explore');
    expect(inferAgentType('CODE-REVIEW')).toBe('code-review');
  });
});

// ---------------------------------------------------------------------------
// inferAgentTypeFromToolCall
// ---------------------------------------------------------------------------

describe('inferAgentTypeFromToolCall', () => {
  it('delegates to inferAgentType with tool call fields', () => {
    const tc = makeToolCall({
      agentDisplayName: 'Explore Agent',
      toolName: 'task',
      arguments: {},
    });
    expect(inferAgentTypeFromToolCall(tc)).toBe('explore');
  });

  it('falls back to task for generic tool calls', () => {
    const tc = makeToolCall({ toolName: 'grep' });
    expect(inferAgentTypeFromToolCall(tc)).toBe('task');
  });
});

// ---------------------------------------------------------------------------
// agentStatusFromToolCall
// ---------------------------------------------------------------------------

describe('agentStatusFromToolCall', () => {
  it("returns 'in-progress' when not complete", () => {
    expect(agentStatusFromToolCall(makeToolCall({ isComplete: false }))).toBe('in-progress');
  });

  it("returns 'failed' when complete and success is false", () => {
    expect(agentStatusFromToolCall(makeToolCall({ isComplete: true, success: false }))).toBe(
      'failed',
    );
  });

  it("returns 'completed' when complete and success is true", () => {
    expect(agentStatusFromToolCall(makeToolCall({ isComplete: true, success: true }))).toBe(
      'completed',
    );
  });

  it("returns 'completed' when complete and success is undefined", () => {
    expect(agentStatusFromToolCall(makeToolCall({ isComplete: true }))).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// getAgentColor
// ---------------------------------------------------------------------------

describe('getAgentColor', () => {
  it('returns correct CSS variable for each known agent type', () => {
    expect(getAgentColor('main')).toBe('var(--agent-color-main)');
    expect(getAgentColor('explore')).toBe('var(--agent-color-explore)');
    expect(getAgentColor('general-purpose')).toBe('var(--agent-color-general-purpose)');
    expect(getAgentColor('code-review')).toBe('var(--agent-color-code-review)');
    expect(getAgentColor('task')).toBe('var(--agent-color-task)');
  });

  it('falls back to main agent color for unknown types', () => {
    expect(getAgentColor('unknown-type')).toBe(AGENT_COLORS.main);
    expect(getAgentColor('')).toBe(AGENT_COLORS.main);
  });

  it('falls back to main agent color for undefined/null-ish inputs', () => {
    expect(getAgentColor(undefined as unknown as string)).toBe(AGENT_COLORS.main);
    expect(getAgentColor(null as unknown as string)).toBe(AGENT_COLORS.main);
  });
});

// ---------------------------------------------------------------------------
// getAgentIcon
// ---------------------------------------------------------------------------

describe('getAgentIcon', () => {
  it('returns correct icon for each known agent type', () => {
    expect(getAgentIcon('main')).toBe('🤖');
    expect(getAgentIcon('explore')).toBe('🔍');
    expect(getAgentIcon('general-purpose')).toBe('🛠️');
    expect(getAgentIcon('code-review')).toBe('🔎');
    expect(getAgentIcon('task')).toBe('📋');
  });

  it('falls back to main agent icon for unknown types', () => {
    expect(getAgentIcon('unknown-type')).toBe(AGENT_ICONS.main);
    expect(getAgentIcon('')).toBe(AGENT_ICONS.main);
  });

  it('falls back to main agent icon for undefined/null-ish inputs', () => {
    expect(getAgentIcon(undefined as unknown as string)).toBe(AGENT_ICONS.main);
    expect(getAgentIcon(null as unknown as string)).toBe(AGENT_ICONS.main);
  });
});

// ---------------------------------------------------------------------------
// getToolStatusColor
// ---------------------------------------------------------------------------

describe('getToolStatusColor', () => {
  it('returns danger for failed tool calls', () => {
    const tc = makeToolCall({ success: false });
    expect(getToolStatusColor(tc)).toBe('var(--danger-fg)');
  });

  it('returns tertiary for pending tool calls (success is undefined)', () => {
    const tc = makeToolCall({ success: undefined });
    expect(getToolStatusColor(tc)).toBe('var(--text-tertiary)');
  });

  it('returns tertiary for pending tool calls (success is null)', () => {
    const tc = makeToolCall({ success: null as unknown as boolean });
    expect(getToolStatusColor(tc)).toBe('var(--text-tertiary)');
  });

  it('returns tertiary for read_agent tool calls', () => {
    const tc = makeToolCall({ toolName: 'read_agent', success: true });
    expect(getToolStatusColor(tc)).toBe('var(--text-tertiary)');
  });

  it('returns warning for successful regular tool calls', () => {
    const tc = makeToolCall({ toolName: 'grep', success: true });
    expect(getToolStatusColor(tc)).toBe('var(--warning-fg)');
  });

  it('checks failure before pending status', () => {
    const tc = makeToolCall({ success: false, toolName: 'read_agent' });
    expect(getToolStatusColor(tc)).toBe('var(--danger-fg)');
  });
});

// ---------------------------------------------------------------------------
// getToolCallColor
// ---------------------------------------------------------------------------

describe('getToolCallColor', () => {
  it('returns agent color for subagent tool calls', () => {
    const tc = makeToolCall({
      isSubagent: true,
      agentDisplayName: 'Explore Agent',
      toolName: 'task',
    });
    expect(getToolCallColor(tc)).toBe(AGENT_COLORS.explore);
  });

  it('returns task agent color for subagent with unrecognized type', () => {
    const tc = makeToolCall({
      isSubagent: true,
      toolName: 'unknown',
    });
    // "unknown" doesn't match any agent type pattern, so inferAgentType
    // defaults to "task" — getAgentColor then resolves AGENT_COLORS.task
    expect(getToolCallColor(tc)).toBe(AGENT_COLORS.task);
  });

  it('delegates to getToolStatusColor for non-subagent calls', () => {
    const failed = makeToolCall({ success: false });
    expect(getToolCallColor(failed)).toBe('var(--danger-fg)');

    const success = makeToolCall({ toolName: 'grep', success: true });
    expect(getToolCallColor(success)).toBe('var(--warning-fg)');
  });

  it('returns tertiary for non-subagent pending tool calls', () => {
    const pending = makeToolCall({ toolName: 'edit', success: undefined });
    expect(getToolCallColor(pending)).toBe('var(--text-tertiary)');
  });

  it('returns tertiary for non-subagent read_agent calls', () => {
    const readAgent = makeToolCall({ toolName: 'read_agent', success: true });
    expect(getToolCallColor(readAgent)).toBe('var(--text-tertiary)');
  });

  it('isSubagent check takes precedence over status coloring', () => {
    const tc = makeToolCall({
      isSubagent: true,
      success: false,
      agentDisplayName: 'Code-Review Agent',
    });
    // Even though success is false, subagent branch is used
    expect(getToolCallColor(tc)).toBe(AGENT_COLORS['code-review']);
  });
});
