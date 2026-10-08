export const MODEL = "claude-opus-5-5";
const VERSION = "2.1.289";

/** Appends records with a chained `parentUuid` and a one-second clock. */
export class Transcript {
  constructor({ sessionId, cwd, branch, namespace, start, agentId = null }) {
    Object.assign(this, { sessionId, cwd, branch, namespace, start, agentId });
    this.seq = 0;
    this.clock = 0;
    this.lastUuid = null;
    this.promptId = null;
    this.prompts = 0;
    this.lines = [];
  }

  uuid() {
    this.seq += 1;
    return `${this.namespace}-0000-4000-8000-${this.seq.toString(16).padStart(12, "0")}`;
  }

  timestamp() {
    this.clock += 7;
    return new Date(Date.parse(this.start) + this.clock * 1000).toISOString();
  }

  record(type, body) {
    const uuid = this.uuid();
    this.lines.push({
      type,
      uuid,
      parentUuid: this.lastUuid,
      isSidechain: this.agentId !== null,
      timestamp: this.timestamp(),
      sessionId: this.sessionId,
      cwd: this.cwd,
      gitBranch: this.branch,
      version: VERSION,
      entrypoint: "cli",
      userType: "external",
      ...(this.agentId ? { agentId: this.agentId } : {}),
      ...body,
    });
    this.lastUuid = uuid;
  }

  /** An idle gap before the next record. */
  idle(seconds) {
    this.clock += seconds;
  }

  bookkeeping(body) {
    this.lines.push({ ...body, sessionId: this.sessionId });
  }

  prompt(text) {
    this.prompts += 1;
    this.promptId = `22222222-2222-4222-8222-${this.prompts.toString(16).padStart(12, "0")}`;
    this.record("user", {
      promptId: this.promptId,
      message: { role: "user", content: text },
      origin: { kind: "human" },
      promptSource: "typed",
      permissionMode: "auto",
    });
  }

  /** One API call, one record per content block; the last carries the usage. */
  call(messageId, blocks, usage, stopReason) {
    blocks.forEach((block, index) => {
      const last = index === blocks.length - 1;
      this.record("assistant", {
        requestId: `req_${messageId}`,
        message: {
          id: messageId,
          model: MODEL,
          role: "assistant",
          stop_reason: last ? stopReason : null,
          content: [block],
          usage: {
            input_tokens: usage.input,
            cache_read_input_tokens: usage.cacheRead,
            cache_creation_input_tokens: usage.cacheWrite,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: usage.cacheWrite,
            },
            output_tokens: last ? usage.output : Math.floor(usage.output / 2),
            output_tokens_details: { thinking_tokens: usage.thinking ?? 0 },
            service_tier: "standard",
          },
        },
      });
    });
  }

  toolResult(toolUseId, content, toolUseResult) {
    this.record("user", {
      promptId: this.promptId,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: false, content }],
      },
      toolUseResult,
    });
  }

  /** A tool use the user or a permission rule refused. */
  denied(toolUseId, kind) {
    this.record("user", {
      promptId: this.promptId,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            is_error: true,
            content: "The user doesn't want to proceed with this tool use.",
          },
        ],
      },
      toolUseResult: "User rejected tool use",
      toolDenialKind: kind,
    });
  }

  /** The user pressed Esc while a tool ran. */
  interrupted(toolUseId) {
    const marker = "[Request interrupted by user for tool use]";
    this.record("user", {
      promptId: this.promptId,
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: toolUseId, is_error: true, content: marker },
          { type: "text", text: marker },
        ],
      },
      toolUseResult: `Error: ${marker}`,
    });
  }

  /** A `<synthetic>` 429 Claude Code writes when a usage limit is hit. */
  rateLimited() {
    this.record("assistant", {
      isApiErrorMessage: true,
      error: "rate_limit",
      apiErrorStatus: 429,
      message: {
        id: `msg_synthetic_${this.seq}`,
        model: "<synthetic>",
        role: "assistant",
        stop_reason: "stop_sequence",
        content: [text("You've hit your usage limit · resets 6pm")],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    });
  }

  costState(cost, usage) {
    this.bookkeeping({
      type: "cost-state",
      totalCostUSD: cost,
      totalAPIDuration: 48000,
      totalDuration: this.clock * 1000,
      totalLinesAdded: 4,
      totalLinesRemoved: 1,
      startTime: Date.parse(this.start),
      hasUnknownModelCost: false,
      modelUsage: {
        [MODEL]: {
          inputTokens: usage.input,
          outputTokens: usage.output,
          thinkingTokens: 0,
          cacheReadInputTokens: usage.cacheRead,
          cacheCreationInputTokens: usage.cacheWrite,
          webSearchRequests: 0,
          costUSD: cost,
        },
      },
    });
  }

  toJsonl() {
    return `${this.lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  }
}

export const text = (value) => ({ type: "text", text: value });
export const thinking = () => ({ type: "thinking", thinking: "", signature: "c3ludGhldGlj" });
export const toolUse = (id, name, input) => ({
  type: "tool_use",
  id,
  name,
  input,
  caller: { type: "direct" },
});
