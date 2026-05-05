import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ipc } from "../connect.mjs";

export async function selectRichSession(page, candidateLimit, warn) {
  const candidates = await listSessionCandidates(page, candidateLimit, warn);
  if (candidates.length === 0) {
    throw new Error("Unable to score any sessions for README captures.");
  }
  return candidates[0];
}

export async function listSessionCandidates(page, limit, warn) {
  const sessions = await ipc(page, "list_sessions", {
    limit: 75,
    repo: null,
    branch: null,
    hideEmpty: true,
  });

  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new Error(
      "No indexed sessions found. Open TracePilot and index your Copilot sessions first.",
    );
  }

  const scored = [];
  for (const session of sessions.slice(0, 50)) {
    const score = await scoreSession(page, session, warn);
    scored.push(score);
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

async function scoreSession(page, session, warn) {
  let detail = null;
  let turnsResponse = null;
  let todosResponse = null;

  try {
    detail = await ipc(page, "get_session_detail", { sessionId: session.id });
  } catch (error) {
    warn(`Could not load detail for session ${session.id}: ${error.message}`);
  }

  try {
    turnsResponse = await ipc(page, "get_session_turns", { sessionId: session.id });
  } catch (error) {
    warn(`Could not load turns for session ${session.id}: ${error.message}`);
  }

  try {
    todosResponse = await ipc(page, "get_session_todos", { sessionId: session.id });
  } catch (error) {
    warn(`Could not load todos for session ${session.id}: ${error.message}`);
  }

  const turns = Array.isArray(turnsResponse?.turns) ? turnsResponse.turns : [];
  const toolCalls = turns.flatMap((turn) => (Array.isArray(turn.toolCalls) ? turn.toolCalls : []));
  const subagents = toolCalls.filter((tool) => tool.isSubagent);
  const todos = Array.isArray(todosResponse?.todos) ? todosResponse.todos : [];
  const todoDeps = Array.isArray(todosResponse?.deps) ? todosResponse.deps : [];
  const turnCount = detail?.turnCount ?? session.turnCount ?? turns.length;
  const eventCount = detail?.eventCount ?? session.eventCount ?? 0;
  const checkpointCount = detail?.checkpointCount ?? 0;

  const score =
    turnCount * 2 +
    Math.min(eventCount / 100, 60) +
    toolCalls.length * 1.5 +
    subagents.length * 25 +
    todos.length * 8 +
    todoDeps.length * 18 +
    checkpointCount * 8 +
    (detail?.hasPlan ? 10 : 0);

  return {
    score,
    turnCount,
    eventCount,
    todoCount: todos.length,
    todoDepCount: todoDeps.length,
    toolCallCount: toolCalls.length,
    subagentCount: subagents.length,
    checkpointCount,
    id: session.id,
    summary: session.summary,
    repository: session.repository,
    branch: session.branch,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    interestingTurns: interestingTurns(turns),
    searchTerm:
      sanitizeSearchTerm(session.repository) ||
      sanitizeSearchTerm(session.summary) ||
      sanitizeSearchTerm(session.branch) ||
      "copilot",
  };
}

function interestingTurns(turns) {
  return turns
    .map((turn) => {
      const turnToolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
      const turnSubagents = turnToolCalls.filter((tool) => tool.isSubagent);
      const assistantText = Array.isArray(turn.assistantMessages)
        ? turn.assistantMessages.map((message) => message.content).join(" ")
        : "";
      const reasoningText = Array.isArray(turn.reasoningTexts)
        ? turn.reasoningTexts.map((message) => message.content).join(" ")
        : "";
      const score =
        turnToolCalls.length * 1.5 +
        turnSubagents.length * 20 +
        (turn.sessionEvents?.length ?? 0) * 8 +
        Math.min((turn.durationMs ?? 0) / 1000 / 60, 20);

      return {
        turnIndex: turn.turnIndex,
        score: Number(score.toFixed(1)),
        toolCallCount: turnToolCalls.length,
        subagentCount: turnSubagents.length,
        model: turn.model ?? null,
        durationMs: turn.durationMs ?? null,
        userMessage: excerpt(turn.userMessage, 120),
        assistantPreview: excerpt(assistantText || reasoningText, 140),
      };
    })
    .filter((turn) => turn.toolCallCount > 0 || turn.subagentCount > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function printCandidates(candidates, candidateRoot) {
  const rows = candidates.map((candidate, index) => ({
    rank: index + 1,
    id: candidate.id,
    summary: candidate.summary,
    repository: candidate.repository,
    branch: candidate.branch,
    score: Number(candidate.score.toFixed(1)),
    turns: candidate.turnCount,
    events: candidate.eventCount,
    tools: candidate.toolCallCount,
    subagents: candidate.subagentCount,
    todos: candidate.todoCount,
    todoDeps: candidate.todoDepCount,
    checkpoints: candidate.checkpointCount,
    topTurns: candidate.interestingTurns
      .slice(0, 3)
      .map(
        (turn) =>
          `#${turn.turnIndex} (${turn.subagentCount} subagents, ${turn.toolCallCount} tools): ${turn.userMessage}`,
      )
      .join(" | "),
  }));
  console.table(rows);

  const candidatePath = resolve(candidateRoot, "session-candidates.json");
  writeFileSync(candidatePath, JSON.stringify(candidates, null, 2));
  console.log(`[candidates] JSON: ${candidatePath}`);
}

function sanitizeSearchTerm(value) {
  return String(value ?? "")
    .replace(/[^\p{L}\p{N}\-_ ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((part) => part.length >= 3)
    .slice(0, 2)
    .join(" ");
}

function excerpt(value, maxLength) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}
