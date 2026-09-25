import { describe, expect, it } from "vitest";
import {
  parseListAgentsResult,
  parseReadAgentResult,
  parseWriteAgentResult,
  writeAgentTarget,
} from "../utils/agentComms/parsers";

describe("parseReadAgentResult", () => {
  it("parses a multi-turn transcript with parent and sibling messages", () => {
    const content = [
      "Agent is idle (waiting for messages). agent_id: 65f59a0b-dcb7-4bc0-bd1b-1c971ca4edd4, agent_type: general-purpose, status: idle, description: Coordinate alpha messaging, elapsed: 20s, total_turns: 3, model: claude-haiku-4.5",
      "",
      "[Turn 0]",
      "Beta answered: **42**.",
      "",
      "[Turn 1]",
      "[Message from 9fec072e-1ce7-49f2-9378-c9465b7a6b84]",
      "6 * 7 = 42.",
      "",
      "[Response]",
      "Beta’s answer was **42**.",
      "",
      "[Turn 2]",
      "[Message]",
      "Final check: reply with the single word DONE.",
      "",
      "[Response]",
      "DONE",
    ].join("\n");
    const result = parseReadAgentResult(content);
    expect(result).toMatchObject({
      headline: "Agent is idle (waiting for messages)",
      status: "idle",
      agentId: "65f59a0b-dcb7-4bc0-bd1b-1c971ca4edd4",
      agentType: "general-purpose",
      description: "Coordinate alpha messaging",
      elapsedSeconds: 20,
      totalTurns: 3,
      model: "claude-haiku-4.5",
      timedOut: false,
      body: "",
    });
    expect(result?.turns).toEqual([
      { index: 0, response: "Beta answered: **42**." },
      {
        index: 1,
        message: { fromAgentId: "9fec072e-1ce7-49f2-9378-c9465b7a6b84", content: "6 * 7 = 42." },
        response: "Beta’s answer was **42**.",
      },
      {
        index: 2,
        message: {
          fromAgentId: undefined,
          content: "Final check: reply with the single word DONE.",
        },
        response: "DONE",
      },
    ]);
  });

  it("keeps an empty response when the agent replied through a tool", () => {
    const result = parseReadAgentResult(
      "Agent is idle (waiting for messages). agent_id: b, agent_type: general-purpose, status: idle, description: d, elapsed: 12s, total_turns: 2, model: m\n\n[Turn 1]\n[Message from a]\nalpha asks: what is 6*7?\n\n[Response]\n",
    );
    expect(result?.turns).toEqual([
      {
        index: 1,
        message: { fromAgentId: "a", content: "alpha asks: what is 6*7?" },
        response: "",
      },
    ]);
  });

  it("parses a timed-out running read with intent and progress", () => {
    const result = parseReadAgentResult(
      'Agent is still running after waiting 60s. agent_id: wave1-review, agent_type: general-purpose, status: running, description: Wave-1 review, part 2, elapsed: 606s, total_turns: 0, model: gpt-5.4, current_intent: "Cross-checking review, again", tool_calls_completed: 53, (timed out waiting for completion) You will be automatically notified when this agent completes — no need to poll.',
    );
    expect(result).toMatchObject({
      status: "running",
      agentId: "wave1-review",
      description: "Wave-1 review, part 2",
      elapsedSeconds: 606,
      currentIntent: "Cross-checking review, again",
      toolCallsCompleted: 53,
      timedOut: true,
      turns: [],
    });
  });

  it("keeps the body of legacy completed results without turn markers", () => {
    const result = parseReadAgentResult(
      "Agent completed. agent_id: audit, agent_type: explore, status: completed, description: Audit, elapsed: 292s, total_turns: 0, model: claude-opus-4.7, duration: 285s\n\n# Report\n\nBody text",
    );
    expect(result).toMatchObject({
      status: "completed",
      durationSeconds: 285,
      turns: [],
      body: "# Report\n\nBody text",
    });
  });

  it("returns null for unrecognized output", () => {
    expect(parseReadAgentResult("")).toBeNull();
    expect(parseReadAgentResult("Agent not found")).toBeNull();
    expect(parseReadAgentResult("# Just markdown")).toBeNull();
  });
});

describe("parseWriteAgentResult", () => {
  it("parses single deliveries in both wordings", () => {
    for (const tail of [
      "Use read_agent to check the agent's response.",
      "The recipient can reply with write_agent.",
    ]) {
      expect(parseWriteAgentResult(`Message delivered to agent docs-cleanup. ${tail}`)).toEqual({
        summary: `Message delivered to agent docs-cleanup. ${tail}`,
        deliveries: [{ agentId: "docs-cleanup", outcome: "delivered", delivered: true }],
      });
    }
  });

  it("parses multi-recipient delivery lines", () => {
    const result = parseWriteAgentResult(
      "Message delivered to 2 agents.\n- a1, delivered, task_status=running\n- b2, not accepting messages",
    );
    expect(result?.deliveries).toEqual([
      { agentId: "a1", outcome: "delivered", delivered: true, taskStatus: "running" },
      { agentId: "b2", outcome: "not accepting messages", delivered: false, taskStatus: undefined },
    ]);
  });

  it("returns null for unrelated text", () => {
    expect(parseWriteAgentResult("Agent not found")).toBeNull();
    expect(parseWriteAgentResult(undefined)).toBeNull();
  });
});

describe("writeAgentTarget", () => {
  it("distinguishes direct, multi-recipient and scoped sends", () => {
    expect(writeAgentTarget({ agent_id: "a", message: "m" })).toEqual({
      kind: "agents",
      agentIds: ["a"],
    });
    expect(writeAgentTarget({ agent_ids: ["a", "b", 3], message: "m" })).toEqual({
      kind: "agents",
      agentIds: ["a", "b"],
    });
    expect(writeAgentTarget({ scope: "children", message: "m" })).toEqual({
      kind: "scope",
      scope: "children",
    });
    expect(writeAgentTarget({ message: "m" })).toEqual({ kind: "unknown" });
  });
});

describe("parseListAgentsResult", () => {
  it("parses the scoped 1.0.88 format with IDs and relations", () => {
    const result = parseListAgentsResult(
      'Background agents (scope: siblings):\n\nRunning (2):\n  🔄 alpha (65f59a0b-dcb7-4bc0-bd1b-1c971ca4edd4): general-purpose - "Coordinate alpha messaging" (4s, owner: 16847ed6, relation: sibling) (model: claude-haiku-4.5)\n  🔄 beta (9fec072e): general-purpose - "Answer alpha question" (4s, owner: 16847ed6, relation: sibling) (model: claude-haiku-4.5)',
    );
    expect(result?.scope).toBe("siblings");
    expect(result?.total).toBe(2);
    expect(result?.groups[0]).toMatchObject({ status: "running", label: "Running" });
    expect(result?.groups[0].agents[0]).toEqual({
      name: "alpha",
      agentId: "65f59a0b-dcb7-4bc0-bd1b-1c971ca4edd4",
      agentType: "general-purpose",
      description: "Coordinate alpha messaging",
      elapsedSeconds: 4,
      owner: "16847ed6",
      relation: "sibling",
      model: "claude-haiku-4.5",
      oneShot: false,
    });
  });

  it("parses the legacy format where the name is the agent ID", () => {
    const result = parseListAgentsResult(
      'Background agents:\n\nIdle (1):\n  💤 import-validator-split: general-purpose - "Split import validator" (6966s, owner: 26d9e83e) (model: gpt-5.5)\n\nCompleted (1):\n  ✅ docs: explore - "Docs (v2)" (12s, owner: 26d9e83e) (one-shot)',
    );
    expect(result?.scope).toBeUndefined();
    expect(result?.groups.map((g) => g.status)).toEqual(["idle", "completed"]);
    expect(result?.groups[0].agents[0]).toMatchObject({
      name: "import-validator-split",
      agentId: "import-validator-split",
      relation: undefined,
      model: "gpt-5.5",
    });
    expect(result?.groups[1].agents[0]).toMatchObject({
      name: "docs",
      description: "Docs (v2)",
      oneShot: true,
    });
  });

  it("handles an empty roster and unrelated text", () => {
    expect(parseListAgentsResult("Background agents:\n\nNo background agents.")).toEqual({
      scope: undefined,
      groups: [],
      total: 0,
    });
    expect(parseListAgentsResult("nothing here")).toBeNull();
  });
});
