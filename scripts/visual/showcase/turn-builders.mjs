// Builders for synthetic hero turns: tool calls, background agents, agent
// reads and assistant messages, numbered in event order.

import { heroAt } from "./sessions.mjs";

export const AGENT_IDS = {
  registry: "a3c0e1f2-0001-4c9a-8e10-5d2b7f9a0c01",
  device: "a3c0e1f2-0002-4c9a-8e10-5d2b7f9a0c02",
  review: "a3c0e1f2-0003-4c9a-8e10-5d2b7f9a0c03",
  e2e: "a3c0e1f2-0004-4c9a-8e10-5d2b7f9a0c04",
  safari: "a3c0e1f2-0005-4c9a-8e10-5d2b7f9a0c05",
};

let eventIndex = 0;
const next = () => eventIndex++;

/** Restart event numbering before building the turn list. */
export function resetEvents() {
  eventIndex = 0;
}

export function call(id, toolName, minute, durationMs, args, result, extra = {}) {
  const startedAt = heroAt(minute);
  return {
    toolCallId: id,
    toolName,
    eventIndex: next(),
    arguments: args,
    success: extra.success ?? true,
    isComplete: true,
    startedAt,
    completedAt: new Date(Date.parse(startedAt) + durationMs).toISOString(),
    durationMs,
    resultContent: result,
    ...extra,
  };
}

export function agent(id, type, displayName, minute, durationMs, prompt, stats) {
  return call(
    id,
    type,
    minute,
    durationMs,
    { description: displayName, prompt, agent_type: type, mode: "background" },
    stats.result,
    {
      isSubagent: true,
      agentId: AGENT_IDS[stats.key],
      agentStatus: "completed",
      agentDisplayName: displayName,
      agentDescription: stats.description,
      model: stats.model,
      totalToolCalls: stats.tools,
      totalTokens: stats.tokens,
    },
  );
}

export const say = (content, parentToolCallId, agentDisplayName) => ({
  content,
  eventIndex: next(),
  ...(parentToolCallId ? { parentToolCallId, agentDisplayName } : {}),
});

export function readAgent(id, minute, key, type, description, model, elapsed, response) {
  return call(
    id,
    "read_agent",
    minute,
    1400,
    { agent_id: AGENT_IDS[key], wait: true, timeout: 120 },
    `Agent completed. agent_id: ${AGENT_IDS[key]}, agent_type: ${type}, status: completed, description: ${description}, elapsed: ${elapsed}, total_turns: 1, model: ${model}\n\n[Turn 0]\n${response}`,
  );
}
