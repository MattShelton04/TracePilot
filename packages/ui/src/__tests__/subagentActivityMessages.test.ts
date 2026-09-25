import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import {
  buildSubagentActivities,
  hasFollowUpMessages,
} from "../components/SubagentPanel/activities";
import SubagentActivityStream from "../components/SubagentPanel/SubagentActivityStream.vue";
import type { AgentCommunication } from "../utils/agentComms";

function comm(
  partial: Partial<AgentCommunication> & Pick<AgentCommunication, "id">,
): AgentCommunication {
  return {
    kind: "message",
    fromKey: "main",
    toKeys: ["alpha"],
    relation: "down",
    content: "hello",
    order: 0,
    deliveries: [],
    failed: false,
    ...partial,
  };
}

const writeToBeta: TurnToolCall = {
  toolName: "write_agent",
  toolCallId: "w1",
  parentToolCallId: "alpha",
  isComplete: true,
  success: true,
  eventIndex: 39,
  arguments: { agent_id: "beta", message: "what is 6*7?" },
};

const view: TurnToolCall = {
  toolName: "view",
  toolCallId: "v1",
  parentToolCallId: "alpha",
  isComplete: true,
  eventIndex: 30,
};

const communications = {
  inbound: [
    comm({ id: "launch:alpha", kind: "launch", content: "You are alpha.", order: 7 }),
    comm({
      id: "message:w2",
      fromKey: "beta",
      relation: "peer",
      content: "6 * 7 = 42.",
      order: 56,
      deliveries: [{ toKey: "alpha", delivery: "idle", eventIndex: 65 }],
    }),
  ],
  outbound: [
    comm({
      id: "message:w1",
      fromKey: "alpha",
      toKeys: ["beta"],
      relation: "peer",
      content: "what is 6*7?",
      order: 39,
      toolCallId: "w1",
    }),
  ],
};

describe("buildSubagentActivities with messages", () => {
  it("interleaves sent and received messages and replies, skipping the launch prompt", () => {
    const items = buildSubagentActivities({
      parentId: "alpha",
      childTools: [writeToBeta, view],
      childReasoning: [],
      communications,
      childMessages: [
        { content: "", eventIndex: 38 },
        { content: "Beta answered 42.", eventIndex: 44 },
        { content: "Confirmed.", eventIndex: 80 },
      ],
    });
    expect(items.map((i) => (i.kind === "message" ? `${i.kind}-${i.direction}` : i.kind))).toEqual([
      "tool",
      "message-out",
      "response",
      "message-in",
      "response",
    ]);
    const received = items[3];
    expect(received.kind === "message" && received.delivery?.eventIndex).toBe(65);
  });

  it("keeps replies out of the stream for single-turn agents", () => {
    const items = buildSubagentActivities({
      parentId: "alpha",
      childTools: [view],
      childReasoning: [],
      communications: { inbound: [communications.inbound[0]], outbound: [] },
      childMessages: [{ content: "Done.", eventIndex: 44 }],
    });
    expect(items.map((i) => i.kind)).toEqual(["tool"]);
    expect(hasFollowUpMessages({ inbound: [communications.inbound[0]], outbound: [] })).toBe(false);
    expect(hasFollowUpMessages(communications)).toBe(true);
  });

  it("renders messages with direction, relation and queued badges", () => {
    const wrapper = mount(SubagentActivityStream, {
      props: {
        activities: [
          {
            kind: "message",
            key: "in",
            sortKey: 1,
            direction: "in",
            communication: communications.inbound[1],
            delivery: { toKey: "alpha", delivery: "queued", eventIndex: 65 },
          },
          {
            kind: "message",
            key: "out",
            sortKey: 2,
            direction: "out",
            communication: comm({
              id: "b",
              fromKey: "alpha",
              toKeys: ["x", "y"],
              scope: "children",
            }),
          },
          { kind: "response", key: "r", sortKey: 3, content: "Confirmed." },
        ],
        agentKey: "alpha",
        renderMarkdown: false,
        fullResults: new Map(),
        loadingResults: new Set<string>(),
        failedResults: new Set<string>(),
      },
    });
    const [received, sent] = wrapper.findAll(".sap-msg");
    expect(received.classes()).toContain("sap-msg--peer");
    expect(received.text()).toContain("Message from");
    expect(received.text()).toContain("queued");
    expect(received.text()).toContain("6 * 7 = 42.");
    expect(sent.text()).toContain("Sent to");
    expect(sent.text()).toContain("all children");
    expect(wrapper.get(".sap-response").text()).toContain("Confirmed.");
  });
});
