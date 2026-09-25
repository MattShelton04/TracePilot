import type { AgentMessage, ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  buildAgentCommunications,
  communicationsFor,
  summarizeAgentCommunications,
} from "../utils/agentComms/communications";
import { buildAgentDirectory, MAIN_AGENT_KEY } from "../utils/agentComms/directory";

const ALPHA_ID = "65f59a0b-dcb7-4bc0-bd1b-1c971ca4edd4";
const BETA_ID = "9fec072e-1ce7-49f2-9378-c9465b7a6b84";
const SESSION_ID = "16847ed6-9975-4831-b56f-e0bcfcb9ee30";

function tool(partial: Partial<TurnToolCall> & Pick<TurnToolCall, "toolName">): TurnToolCall {
  return { isComplete: true, success: true, ...partial };
}

function launch(key: string, name: string, agentId: string, eventIndex: number): TurnToolCall {
  return tool({
    toolName: "task",
    toolCallId: key,
    isSubagent: true,
    agentId,
    agentDisplayName: name,
    agentStatus: "idle",
    eventIndex,
    arguments: { name, agent_type: "general-purpose", prompt: `You are ${name}.` },
  });
}

function delivery(
  recipient: string,
  content: string,
  source: string,
  eventIndex: number,
  extra: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    content,
    recipientToolCallId: recipient,
    senderAgentId: source,
    isLaunch: false,
    delivery: "idle",
    eventIndex,
    timestamp: `2026-09-25T09:17:${String(eventIndex).padStart(2, "0")}Z`,
    ...extra,
  };
}

/** Main launches alpha + beta; they message each other; main broadcasts. */
function siblingSession(): ConversationTurn[] {
  return [
    {
      turnIndex: 0,
      isComplete: true,
      assistantMessages: [],
      toolCalls: [
        launch("launch-alpha", "alpha", ALPHA_ID, 7),
        launch("launch-beta", "beta", BETA_ID, 8),
        tool({
          toolName: "write_agent",
          toolCallId: "w-alpha",
          parentToolCallId: "launch-alpha",
          eventIndex: 39,
          arguments: { agent_id: BETA_ID, message: "alpha asks: what is 6*7?" },
          resultContent: `Message delivered to agent ${BETA_ID}. The recipient can reply with write_agent.`,
        }),
        tool({
          toolName: "write_agent",
          toolCallId: "w-beta",
          parentToolCallId: "launch-beta",
          eventIndex: 56,
          arguments: { agent_id: ALPHA_ID, message: "6 * 7 = 42." },
        }),
        tool({
          toolName: "read_agent",
          toolCallId: "r-poll",
          eventIndex: 60,
          arguments: { agent_id: BETA_ID, wait: true },
          resultContent: `Agent is still running after waiting 30s. agent_id: ${BETA_ID}, agent_type: general-purpose, status: running, description: d, elapsed: 30s, (timed out waiting for completion)`,
        }),
        tool({
          toolName: "write_agent",
          toolCallId: "w-broadcast",
          eventIndex: 69,
          arguments: { scope: "children", message: "Final check: reply with DONE." },
          resultContent: `Message delivered to 2 agents.\n- ${ALPHA_ID}, delivered, task_status=running\n- ${BETA_ID}, delivered, task_status=running`,
        }),
        tool({
          toolName: "read_agent",
          toolCallId: "r-alpha",
          eventIndex: 79,
          completedAt: "2026-09-25T09:17:14Z",
          arguments: { agent_id: ALPHA_ID, wait: true },
          resultContent: `Agent is idle (waiting for messages). agent_id: ${ALPHA_ID}, agent_type: general-purpose, status: idle, description: d, elapsed: 20s, total_turns: 3, model: m\n\n[Turn 2]\n[Message]\nFinal check: reply with DONE.\n\n[Response]\nDONE`,
        }),
      ],
      agentMessages: [
        delivery("launch-beta", "You are beta.", SESSION_ID, 21, { isLaunch: true }),
        delivery("launch-alpha", "You are alpha.", SESSION_ID, 24, { isLaunch: true }),
        delivery("launch-beta", "alpha asks: what is 6*7?", ALPHA_ID, 50, {
          senderToolCallId: "launch-alpha",
        }),
        delivery("launch-alpha", "6 * 7 = 42.", BETA_ID, 65, { senderToolCallId: "launch-beta" }),
        delivery("launch-beta", "Final check: reply with DONE.", SESSION_ID, 73),
        delivery("launch-alpha", "Final check: reply with DONE.", SESSION_ID, 82, {
          delivery: "queued",
        }),
      ],
    },
  ];
}

describe("buildAgentDirectory", () => {
  it("resolves runtime IDs, launch calls, names and the session ID", () => {
    const directory = buildAgentDirectory(siblingSession(), { sessionId: SESSION_ID });
    expect(directory.entries.map((e) => e.key)).toEqual([
      MAIN_AGENT_KEY,
      "launch-alpha",
      "launch-beta",
    ]);
    expect(directory.resolve(ALPHA_ID)?.name).toBe("alpha");
    expect(directory.resolve("launch-beta")?.agentId).toBe(BETA_ID);
    expect(directory.resolve("beta")?.key).toBe("launch-beta");
    expect(directory.resolve(SESSION_ID)?.isMain).toBe(true);
    expect(directory.resolve("nobody")).toBeUndefined();
    expect(directory.get("launch-alpha")).toMatchObject({ depth: 1, parentKey: MAIN_AGENT_KEY });
    expect(directory.isAncestor(MAIN_AGENT_KEY, "launch-alpha")).toBe(true);
    expect(directory.isAncestor("launch-alpha", "launch-beta")).toBe(false);
  });

  it("uses the legacy name-style ID reported by the launch result", () => {
    const legacy = launch("t1", "import-validator-split", "", 1);
    legacy.agentId = undefined;
    legacy.resultContent =
      "Agent started in background with agent_id: import-validator-split-1. You'll be notified.";
    const directory = buildAgentDirectory([
      { turnIndex: 0, isComplete: true, assistantMessages: [], toolCalls: [legacy] },
    ]);
    expect(directory.resolve("import-validator-split-1")?.key).toBe("t1");
  });

  it("computes depth for nested workers recorded before their parent", () => {
    const child = launch("inner", "inner", "u-inner", 5);
    child.parentToolCallId = "outer";
    const directory = buildAgentDirectory([
      {
        turnIndex: 0,
        isComplete: true,
        assistantMessages: [],
        toolCalls: [child, launch("outer", "outer", "u-outer", 1)],
      },
    ]);
    expect(directory.get("inner")?.depth).toBe(2);
    expect(directory.isAncestor(MAIN_AGENT_KEY, "inner")).toBe(true);
    expect(directory.isAncestor("outer", "inner")).toBe(true);
  });
});

describe("buildAgentCommunications", () => {
  const turns = siblingSession();
  const directory = buildAgentDirectory(turns, { sessionId: SESSION_ID });
  const log = buildAgentCommunications(turns, directory);

  it("orders launches, peer messages, broadcasts and reads by event", () => {
    expect(log.map((c) => `${c.kind}:${c.fromKey}->${c.toKeys.join("+")}`)).toEqual([
      "launch:main->launch-alpha",
      "launch:main->launch-beta",
      "message:launch-alpha->launch-beta",
      "message:launch-beta->launch-alpha",
      "read:launch-beta->main",
      "message:main->launch-alpha+launch-beta",
      "read:launch-alpha->main",
    ]);
  });

  it("classifies relations and matches deliveries to sends", () => {
    const [launchAlpha, , peerAsk, peerReply, poll, broadcast, read] = log;
    expect(launchAlpha.deliveries).toEqual([
      expect.objectContaining({ toKey: "launch-alpha", delivery: "idle", eventIndex: 24 }),
    ]);
    expect(peerAsk).toMatchObject({
      relation: "peer",
      failed: false,
      content: "alpha asks: what is 6*7?",
    });
    expect(peerAsk.deliveries[0]).toMatchObject({ toKey: "launch-beta", eventIndex: 50 });
    expect(peerReply.deliveries[0]).toMatchObject({ toKey: "launch-alpha", eventIndex: 65 });
    expect(broadcast).toMatchObject({ relation: "down", scope: "children" });
    expect(broadcast.deliveries.map((d) => [d.toKey, d.delivery])).toEqual([
      ["launch-beta", "idle"],
      ["launch-alpha", "queued"],
    ]);
    expect(poll).toMatchObject({ relation: "up", returned: false, readStatus: "running" });
    expect(read).toMatchObject({ returned: true, readStatus: "idle", content: "DONE" });
  });

  it("summarizes the session and filters per agent", () => {
    expect(summarizeAgentCommunications(log)).toEqual({
      messages: 3,
      peerMessages: 2,
      broadcasts: 1,
      queued: 1,
      failed: 0,
      reads: 1,
      polls: 1,
      participants: 3,
    });
    const alpha = communicationsFor(log, "launch-alpha");
    expect(alpha.inbound.map((c) => c.id)).toEqual([
      "launch:launch-alpha",
      "message:w-beta",
      "message:w-broadcast",
    ]);
    expect(alpha.outbound.map((c) => c.id)).toEqual(["message:w-alpha", "read:r-alpha"]);
  });

  it("keeps deliveries whose send was not recorded", () => {
    const partial = siblingSession();
    partial[0].toolCalls = partial[0].toolCalls.filter((tc) => tc.toolCallId !== "w-alpha");
    const orphanLog = buildAgentCommunications(partial, directory);
    const orphan = orphanLog.find((c) => c.id.startsWith("delivery:"));
    expect(orphan).toMatchObject({
      kind: "message",
      fromKey: "launch-alpha",
      toKeys: ["launch-beta"],
      relation: "peer",
    });
  });

  it("works for logs without delivered messages", () => {
    const legacy = siblingSession();
    legacy[0].agentMessages = undefined;
    const legacyLog = buildAgentCommunications(legacy, directory);
    const broadcast = legacyLog.find((c) => c.scope === "children");
    // Recipients come from the multi-delivery result when deliveries are absent.
    expect(broadcast?.toKeys).toEqual(["launch-alpha", "launch-beta"]);
    expect(broadcast?.deliveries).toEqual([]);
  });
});
