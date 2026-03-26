import type { ConversationTurn, TurnToolCall } from '@tracepilot/types';
import { describe, expect, it } from 'vitest';
import {
  buildSubagentContentIndex,
  buildSubagentIndex,
  groupTurnByAgent,
  hasSubagents,
} from '../utils/agentGrouping';

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnIndex: 0,
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: 'view',
    isComplete: true,
    ...overrides,
  };
}

describe('groupTurnByAgent', () => {
  it('returns single main section for turn with no subagents', () => {
    const turn = makeTurn({
      assistantMessages: [{ content: 'Hello' }, { content: 'World' }],
      reasoningTexts: [{ content: 'thinking...' }],
      toolCalls: [
        makeToolCall({ toolName: 'grep', toolCallId: 'tc1' }),
        makeToolCall({ toolName: 'edit', toolCallId: 'tc2' }),
      ],
    });

    const sections = groupTurnByAgent(turn);
    expect(sections).toHaveLength(1);

    const main = sections[0];
    expect(main.agentId).toBeUndefined();
    expect(main.agentDisplayName).toBe('Copilot');
    expect(main.agentType).toBe('main');
    expect(main.messages).toEqual(['Hello', 'World']);
    expect(main.reasoning).toEqual(['thinking...']);
    expect(main.toolCalls).toHaveLength(2);
  });

  it('groups tool calls and messages by subagent', () => {
    const turn = makeTurn({
      assistantMessages: [
        { content: "I'll explore this." },
        { content: 'Found it!', parentToolCallId: 'sub-1', agentDisplayName: 'Explore Agent' },
        { content: 'Done!' },
      ],
      reasoningTexts: [{ content: 'let me think...', parentToolCallId: 'sub-1' }],
      toolCalls: [
        makeToolCall({
          toolCallId: 'sub-1',
          toolName: 'task',
          isSubagent: true,
          agentDisplayName: 'Explore Agent',
          startedAt: '2026-01-01T00:00:00Z',
          success: true,
          durationMs: 5000,
        }),
        makeToolCall({
          toolCallId: 'tc-child-1',
          toolName: 'grep',
          parentToolCallId: 'sub-1',
        }),
        makeToolCall({
          toolCallId: 'tc-direct',
          toolName: 'edit',
        }),
      ],
    });

    const sections = groupTurnByAgent(turn);
    expect(sections).toHaveLength(3);

    // Main section (before subagent)
    const main = sections[0];
    expect(main.agentId).toBeUndefined();
    expect(main.messages).toEqual(["I'll explore this."]);
    expect(main.reasoning).toEqual([]);
    // Main includes the subagent launch call + the direct edit
    expect(main.toolCalls.map((tc) => tc.toolName)).toEqual(['task', 'edit']);

    // Subagent section
    const sub = sections[1];
    expect(sub.agentId).toBe('sub-1');
    expect(sub.agentDisplayName).toBe('Explore Agent');
    expect(sub.agentType).toBe('explore');
    expect(sub.messages).toEqual(['Found it!']);
    expect(sub.reasoning).toEqual(['let me think...']);
    expect(sub.toolCalls).toHaveLength(1);
    expect(sub.toolCalls[0].toolName).toBe('grep');
    expect(sub.status).toBe('completed');
    expect(sub.durationMs).toBe(5000);

    // Main continuation section (after subagent)
    const mainAfter = sections[2];
    expect(mainAfter.agentId).toBeUndefined();
    expect(mainAfter.messages).toEqual(['Done!']);
    expect(mainAfter.toolCalls).toHaveLength(0);
  });

  it('handles multiple subagents ordered by startedAt', () => {
    const turn = makeTurn({
      assistantMessages: [
        { content: 'child-b msg', parentToolCallId: 'sub-b' },
        { content: 'child-a msg', parentToolCallId: 'sub-a' },
      ],
      toolCalls: [
        makeToolCall({
          toolCallId: 'sub-b',
          toolName: 'task',
          isSubagent: true,
          agentDisplayName: 'Code Review Agent',
          startedAt: '2026-01-01T00:00:05Z',
        }),
        makeToolCall({
          toolCallId: 'sub-a',
          toolName: 'task',
          isSubagent: true,
          agentDisplayName: 'Explore Agent',
          startedAt: '2026-01-01T00:00:01Z',
        }),
      ],
    });

    const sections = groupTurnByAgent(turn);
    expect(sections).toHaveLength(3);
    expect(sections[0].agentType).toBe('main');
    // Explore started first
    expect(sections[1].agentDisplayName).toBe('Explore Agent');
    expect(sections[2].agentDisplayName).toBe('Code Review Agent');
  });

  it('subagent launch without child content does not create empty section', () => {
    const turn = makeTurn({
      assistantMessages: [{ content: 'launching subagent...' }],
      toolCalls: [
        makeToolCall({
          toolCallId: 'sub-1',
          toolName: 'task',
          isSubagent: true,
          agentDisplayName: 'Explore Agent',
          startedAt: '2026-01-01T00:00:00Z',
        }),
      ],
    });

    const sections = groupTurnByAgent(turn);
    // Only main section — subagent has no child content in this turn
    expect(sections).toHaveLength(1);
    expect(sections[0].agentType).toBe('main');
    expect(sections[0].messages).toEqual(['launching subagent...']);
    // The subagent launch tool call is in the main section
    expect(sections[0].toolCalls).toHaveLength(1);
    expect(sections[0].toolCalls[0].toolCallId).toBe('sub-1');
  });

  it('orphan parentToolCallId falls to main agent', () => {
    const turn = makeTurn({
      assistantMessages: [{ content: 'orphan msg', parentToolCallId: 'nonexistent-id' }],
      toolCalls: [],
    });

    const sections = groupTurnByAgent(turn);
    expect(sections).toHaveLength(1);
    expect(sections[0].messages).toEqual(['orphan msg']);
  });

  it('handles turn with empty assistantMessages', () => {
    const turn = makeTurn({
      assistantMessages: [],
      toolCalls: [makeToolCall({ toolCallId: 'tc1' })],
    });

    const sections = groupTurnByAgent(turn);
    expect(sections).toHaveLength(1);
    expect(sections[0].messages).toEqual([]);
    expect(sections[0].toolCalls).toHaveLength(1);
  });

  it('cross-turn attribution: child content in later turn resolves via globalSubagentMap', () => {
    // Turn A: subagent launches (tool.execution_start)
    const turnA = makeTurn({
      turnIndex: 5,
      assistantMessages: [{ content: 'Let me explore that.' }],
      toolCalls: [
        makeToolCall({
          toolCallId: 'sub-cross',
          toolName: 'task',
          isSubagent: true,
          agentDisplayName: 'Explore codebase',
          startedAt: '2026-01-01T00:00:00Z',
          success: true,
          durationMs: 12000,
        }),
      ],
    });

    // Turn B: child content arrives (after assistant.turn_start boundary)
    const turnB = makeTurn({
      turnIndex: 6,
      assistantMessages: [
        {
          content: 'Found the file!',
          parentToolCallId: 'sub-cross',
          agentDisplayName: 'Explore codebase',
        },
      ],
      toolCalls: [
        makeToolCall({
          toolCallId: 'child-tc',
          toolName: 'grep',
          parentToolCallId: 'sub-cross',
        }),
      ],
    });

    // Build global index from both turns
    const globalMap = buildSubagentIndex([turnA, turnB]);
    expect(globalMap.has('sub-cross')).toBe(true);

    // Turn A: subagent launch but no child content → only main section
    const sectionsA = groupTurnByAgent(turnA, globalMap);
    expect(sectionsA).toHaveLength(1);
    expect(sectionsA[0].agentType).toBe('main');
    expect(sectionsA[0].toolCalls[0].toolCallId).toBe('sub-cross');

    // Turn B: child content resolved to subagent via global map
    const sectionsB = groupTurnByAgent(turnB, globalMap);
    expect(sectionsB).toHaveLength(2);

    // Main section (empty — all content belongs to subagent)
    expect(sectionsB[0].agentType).toBe('main');
    expect(sectionsB[0].messages).toEqual([]);

    // Subagent section with resolved content
    const sub = sectionsB[1];
    expect(sub.agentId).toBe('sub-cross');
    expect(sub.agentDisplayName).toBe('Explore codebase');
    expect(sub.agentType).toBe('explore');
    expect(sub.messages).toEqual(['Found the file!']);
    expect(sub.toolCalls).toHaveLength(1);
    expect(sub.toolCalls[0].toolName).toBe('grep');
    expect(sub.durationMs).toBe(12000);
  });
});

describe('hasSubagents', () => {
  it('returns false when no subagents', () => {
    const turn = makeTurn({
      toolCalls: [makeToolCall({ isSubagent: false })],
    });
    expect(hasSubagents(turn)).toBe(false);
  });

  it('returns true when subagents present', () => {
    const turn = makeTurn({
      toolCalls: [makeToolCall({ isSubagent: true })],
    });
    expect(hasSubagents(turn)).toBe(true);
  });
});

// =========================================================================
// buildSubagentContentIndex
// =========================================================================
describe('buildSubagentContentIndex', () => {
  it('returns empty map for empty turns', () => {
    expect(buildSubagentContentIndex([]).size).toBe(0);
  });

  it('returns empty map when no subagents exist', () => {
    const turns = [
      makeTurn({
        assistantMessages: [{ content: 'hello' }],
        toolCalls: [makeToolCall({ toolCallId: 'tc1', toolName: 'grep' })],
      }),
    ];
    expect(buildSubagentContentIndex(turns).size).toBe(0);
  });

  it('collects messages and reasoning for a single subagent', () => {
    const turns = [
      makeTurn({
        assistantMessages: [
          { content: 'main msg' },
          { content: 'sub output', parentToolCallId: 'sub-1' },
        ],
        reasoningTexts: [{ content: 'sub thinking', parentToolCallId: 'sub-1' }],
        toolCalls: [makeToolCall({ toolCallId: 'sub-1', toolName: 'task', isSubagent: true })],
      }),
    ];
    const index = buildSubagentContentIndex(turns);
    expect(index.size).toBe(1);
    const content = index.get('sub-1')!;
    expect(content.messages).toEqual(['sub output']);
    expect(content.reasoning).toEqual(['sub thinking']);
  });

  it('aggregates content across multiple turns (cross-turn attribution)', () => {
    const turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [makeToolCall({ toolCallId: 'sub-1', toolName: 'task', isSubagent: true })],
        assistantMessages: [{ content: 'early output', parentToolCallId: 'sub-1' }],
      }),
      makeTurn({
        turnIndex: 1,
        assistantMessages: [{ content: 'late output', parentToolCallId: 'sub-1' }],
        reasoningTexts: [{ content: 'late reasoning', parentToolCallId: 'sub-1' }],
      }),
    ];
    const index = buildSubagentContentIndex(turns);
    const content = index.get('sub-1')!;
    expect(content.messages).toEqual(['early output', 'late output']);
    expect(content.reasoning).toEqual(['late reasoning']);
  });

  it('separates content for multiple subagents', () => {
    const turns = [
      makeTurn({
        assistantMessages: [
          { content: 'from agent A', parentToolCallId: 'sub-a' },
          { content: 'from agent B', parentToolCallId: 'sub-b' },
        ],
        toolCalls: [
          makeToolCall({ toolCallId: 'sub-a', toolName: 'task', isSubagent: true }),
          makeToolCall({ toolCallId: 'sub-b', toolName: 'task', isSubagent: true }),
        ],
      }),
    ];
    const index = buildSubagentContentIndex(turns);
    expect(index.size).toBe(2);
    expect(index.get('sub-a')!.messages).toEqual(['from agent A']);
    expect(index.get('sub-b')!.messages).toEqual(['from agent B']);
  });

  it('excludes messages without parentToolCallId (main agent messages)', () => {
    const turns = [
      makeTurn({
        assistantMessages: [
          { content: 'main agent says' },
          { content: 'sub says', parentToolCallId: 'sub-1' },
        ],
        toolCalls: [makeToolCall({ toolCallId: 'sub-1', toolName: 'task', isSubagent: true })],
      }),
    ];
    const index = buildSubagentContentIndex(turns);
    expect(index.get('sub-1')!.messages).toEqual(['sub says']);
  });

  it("excludes orphan parentToolCallIds that don't match any subagent", () => {
    const turns = [
      makeTurn({
        assistantMessages: [
          { content: 'orphaned msg', parentToolCallId: 'unknown-id' },
          { content: 'valid msg', parentToolCallId: 'sub-1' },
        ],
        toolCalls: [makeToolCall({ toolCallId: 'sub-1', toolName: 'task', isSubagent: true })],
      }),
    ];
    const index = buildSubagentContentIndex(turns);
    expect(index.size).toBe(1);
    expect(index.get('sub-1')!.messages).toEqual(['valid msg']);
    expect(index.has('unknown-id')).toBe(false);
  });
});

// =========================================================================
// agentStatusFromToolCall — subagent completion status
// =========================================================================
import { agentStatusFromToolCall } from '../utils/agentTypes';

describe('agentStatusFromToolCall', () => {
  it('returns completed for a complete subagent with success=true', () => {
    const tc = makeToolCall({ isSubagent: true, isComplete: true, success: true });
    expect(agentStatusFromToolCall(tc)).toBe('completed');
  });

  it('returns failed for a complete subagent with success=false', () => {
    const tc = makeToolCall({ isSubagent: true, isComplete: true, success: false });
    expect(agentStatusFromToolCall(tc)).toBe('failed');
  });

  it('returns in-progress for an incomplete subagent', () => {
    const tc = makeToolCall({ isSubagent: true, isComplete: false, success: undefined });
    expect(agentStatusFromToolCall(tc)).toBe('in-progress');
  });

  it('returns completed for a complete subagent even when success is null', () => {
    // With the backend fix, success should always be set. But if somehow it isn't,
    // a complete subagent should show as completed, not in-progress.
    const tc = makeToolCall({ isSubagent: true, isComplete: true, success: undefined });
    expect(agentStatusFromToolCall(tc)).toBe('completed');
  });

  it('returns completed for a regular (non-subagent) tool call', () => {
    const tc = makeToolCall({ isSubagent: false, isComplete: true, success: true });
    expect(agentStatusFromToolCall(tc)).toBe('completed');
  });

  it('returns in-progress for an incomplete regular tool call', () => {
    const tc = makeToolCall({ isSubagent: false, isComplete: false });
    expect(agentStatusFromToolCall(tc)).toBe('in-progress');
  });
});
