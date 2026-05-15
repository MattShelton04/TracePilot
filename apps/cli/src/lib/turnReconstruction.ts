/**
 * Reconstruct conversation "turns" from a stream of Copilot CLI session events.
 *
 * This mirrors what `crates/tracepilot-core::turns` produces in Rust, kept in
 * TypeScript so the CLI can run without an FFI dependency. The function is
 * pure with respect to the event source — pass any `AsyncIterable` of parsed
 * event records (typically `streamEvents(path)`).
 */

export interface TurnInfo {
  turnId: string;
  model?: string;
  userMessage?: string;
  assistantSnippet?: string;
  tools: { name: string; success: boolean }[];
  startTime?: string;
  endTime?: string;
  durationMs?: number;
}

type RawEvent = Record<string, unknown>;

function stripAnsiAndControlCharacters(content: string): string {
  let output = "";

  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);

    if (code === 0x1b && content[i + 1] === "[") {
      i += 2;
      while (i < content.length) {
        const ansiCode = content.charCodeAt(i);
        if (ansiCode >= 0x40 && ansiCode <= 0x7e) break;
        i++;
      }
      continue;
    }

    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      output += " ";
      continue;
    }

    output += content[i];
  }

  return output;
}

function formatSnippet(content: string, maxLength: number): string {
  return stripAnsiAndControlCharacters(content).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function reconstructTurns(events: AsyncIterable<RawEvent>): Promise<TurnInfo[]> {
  const turns: TurnInfo[] = [];
  let currentTurn: TurnInfo | null = null;
  let pendingUserMessage: string | undefined;
  let lastAssignedUserMessage: string | undefined;
  // Track pending tool calls by toolCallId so we can match names on completion
  const pendingTools = new Map<string, string>(); // toolCallId → toolName

  function ensureCurrentTurn(data: RawEvent | undefined, timestamp?: string): TurnInfo {
    if (!currentTurn) {
      currentTurn = {
        turnId: (data?.turnId as string) ?? String(turns.length),
        tools: [],
        startTime: timestamp,
        userMessage:
          pendingUserMessage !== lastAssignedUserMessage ? pendingUserMessage : undefined,
      };
      if (pendingUserMessage) lastAssignedUserMessage = pendingUserMessage;
    }
    return currentTurn;
  }

  for await (const evt of events) {
    if (!evt || typeof evt !== "object") continue;
    const type = evt.type as string | undefined;
    if (!type) continue;
    const data = evt.data as RawEvent | undefined;
    const timestamp = evt.timestamp as string | undefined;

    if (type === "user.message") {
      const content = data?.content as string | undefined;
      if (content) {
        pendingUserMessage = formatSnippet(content, 200) || undefined;
      }
    }

    if (type === "assistant.turn_start") {
      const userMsg =
        pendingUserMessage !== lastAssignedUserMessage ? pendingUserMessage : undefined;
      if (pendingUserMessage) lastAssignedUserMessage = pendingUserMessage;

      currentTurn = {
        turnId: (data?.turnId as string) ?? String(turns.length),
        tools: [],
        startTime: timestamp,
        userMessage: userMsg,
      };
    }

    if (type === "assistant.message") {
      const turn = ensureCurrentTurn(data, timestamp);
      const content = data?.content as string | undefined;
      if (content && content.length > 0 && !turn.assistantSnippet) {
        turn.assistantSnippet = formatSnippet(content, 120) || undefined;
      }
    }

    if (type === "tool.execution_start") {
      const turn = ensureCurrentTurn(data, timestamp);
      const toolName = data?.toolName as string | undefined;
      const toolCallId = data?.toolCallId as string | undefined;
      const model = data?.model as string | undefined;
      if (model && !turn.model) turn.model = model;
      // Record the tool name keyed by toolCallId for later matching
      if (toolName && toolCallId) {
        pendingTools.set(toolCallId, toolName);
      }
      // Also add the tool entry now (will be updated on completion)
      if (toolName && toolName !== "report_intent") {
        turn.tools.push({ name: toolName, success: true });
      }
    }

    if (type === "tool.execution_complete") {
      const turn = ensureCurrentTurn(data, timestamp);
      const model = data?.model as string | undefined;
      if (model && !turn.model) turn.model = model;
      const toolCallId = data?.toolCallId as string | undefined;
      const success = data?.success as boolean | undefined;

      // Find the matching tool entry and update its success status
      if (toolCallId) {
        const toolName = pendingTools.get(toolCallId);
        if (toolName && toolName !== "report_intent") {
          // Find the last tool entry with this name and update success
          for (let j = turn.tools.length - 1; j >= 0; j--) {
            if (turn.tools[j].name === toolName) {
              if (success === false) turn.tools[j].success = false;
              break;
            }
          }
        }
        pendingTools.delete(toolCallId);
      }
    }

    if (type === "assistant.turn_end" && currentTurn) {
      currentTurn.endTime = timestamp;
      if (currentTurn.startTime && currentTurn.endTime) {
        currentTurn.durationMs =
          new Date(currentTurn.endTime).getTime() - new Date(currentTurn.startTime).getTime();
      }
      turns.push(currentTurn);
      currentTurn = null;
    }
  }

  // Push any incomplete turn
  if (currentTurn) turns.push(currentTurn);

  return turns;
}
