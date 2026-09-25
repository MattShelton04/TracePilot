import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { type Component, computed, defineComponent, h } from "vue";
import ListAgentsRenderer from "../components/renderers/ListAgentsRenderer.vue";
import ReadAgentRenderer from "../components/renderers/ReadAgentRenderer.vue";
import WriteAgentRenderer from "../components/renderers/WriteAgentRenderer.vue";
import { provideAgentDirectory } from "../composables/useAgentDirectory";
import { buildAgentCommunications, buildAgentDirectory } from "../utils/agentComms";

const ALPHA = "65f59a0b-dcb7-4bc0-bd1b-1c971ca4edd4";
const BETA = "9fec072e-1ce7-49f2-9378-c9465b7a6b84";

function launch(key: string, name: string, agentId: string): TurnToolCall {
  return {
    toolName: "task",
    toolCallId: key,
    isSubagent: true,
    isComplete: true,
    success: true,
    agentId,
    agentDisplayName: name,
    arguments: { name, agent_type: "general-purpose" },
  };
}

const broadcast: TurnToolCall = {
  toolName: "write_agent",
  toolCallId: "w-broadcast",
  isComplete: true,
  success: true,
  eventIndex: 69,
  arguments: { scope: "children", message: "Final check: reply with DONE." },
  resultContent: `Message delivered to 2 agents.\n- ${ALPHA}, delivered, task_status=running\n- ${BETA}, delivered, task_status=running`,
};

const turns: ConversationTurn[] = [
  {
    turnIndex: 0,
    isComplete: true,
    assistantMessages: [],
    toolCalls: [
      launch("launch-alpha", "alpha", ALPHA),
      launch("launch-beta", "beta", BETA),
      broadcast,
    ],
    agentMessages: [
      {
        content: "Final check: reply with DONE.",
        recipientToolCallId: "launch-beta",
        isLaunch: false,
        delivery: "idle",
        eventIndex: 73,
        timestamp: "2026-09-25T09:17:07Z",
      },
      {
        content: "Final check: reply with DONE.",
        recipientToolCallId: "launch-alpha",
        isLaunch: false,
        delivery: "queued",
        eventIndex: 82,
        timestamp: "2026-09-25T09:17:10Z",
      },
    ],
  },
];

function mountWithDirectory(
  component: Component,
  props: Record<string, unknown>,
  openAgent?: (key: string) => void,
) {
  const Host = defineComponent({
    setup() {
      const directory = computed(() => buildAgentDirectory(turns));
      const communications = computed(() => buildAgentCommunications(turns, directory.value));
      provideAgentDirectory({ directory, communications, openAgent });
      return () => h(component, props);
    },
  });
  return mount(Host);
}

function tool(toolName: string, args: Record<string, unknown>, parent?: string): TurnToolCall {
  return {
    toolName,
    toolCallId: `${toolName}-1`,
    parentToolCallId: parent,
    isComplete: true,
    success: true,
    arguments: args,
  };
}

describe("ReadAgentRenderer", () => {
  const transcript = [
    `Agent is idle (waiting for messages). agent_id: ${ALPHA}, agent_type: general-purpose, status: idle, description: Coordinate alpha messaging, elapsed: 20s, total_turns: 3, model: claude-haiku-4.5`,
    "",
    "[Turn 0]",
    "Beta answered: 42.",
    "",
    "[Turn 1]",
    `[Message from ${BETA}]`,
    "6 * 7 = 42.",
    "",
    "[Response]",
    "",
    "[Turn 2]",
    "[Message]",
    "Final check: reply with DONE.",
    "",
    "[Response]",
    "DONE",
  ].join("\n");

  it("names the worker and the sibling that messaged it", async () => {
    const wrapper = mountWithDirectory(ReadAgentRenderer, {
      content: transcript,
      args: { agent_id: ALPHA, wait: true, timeout: 180 },
      tc: tool("read_agent", { agent_id: ALPHA }),
    });
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
    expect(text).not.toContain(BETA);
    expect(text).toContain("Idle");
    expect(text).toContain("waited ≤ 180s");
    expect(text).toContain("claude-haiku-4.5");
    expect(text).toContain("3 turns");
    expect(text).toContain("No text response");
    // The parent's own message is attributed to the reader: the main agent.
    expect(text).toContain("Main agent");
  });

  it("collapses earlier turns of long transcripts", async () => {
    const long = `${transcript}\n\n[Turn 3]\n[Message]\nOne more.\n\n[Response]\nOK`;
    const wrapper = mountWithDirectory(ReadAgentRenderer, {
      content: long,
      args: {},
      tc: tool("read_agent", { agent_id: ALPHA }),
    });
    await flushPromises();
    expect(wrapper.findAll(".ra-turn")).toHaveLength(3);
    await wrapper.find(".ra-show-earlier").trigger("click");
    expect(wrapper.findAll(".ra-turn")).toHaveLength(4);
  });

  it("falls back to Markdown for unstructured output", async () => {
    const wrapper = mountWithDirectory(ReadAgentRenderer, {
      content: "Output too large to read at once (25.5 KB).",
      args: {},
      tc: tool("read_agent", { agent_id: ALPHA }),
    });
    await flushPromises();
    expect(wrapper.find(".ra-fallback").exists()).toBe(true);
    expect(wrapper.text()).toContain("Output too large");
  });
});

describe("WriteAgentRenderer", () => {
  it("shows a broadcast's recipients and queued delivery", async () => {
    const wrapper = mountWithDirectory(WriteAgentRenderer, {
      content: broadcast.resultContent,
      args: broadcast.arguments,
      tc: broadcast,
    });
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("all children");
    expect(text).toContain("Final check: reply with DONE.");
    const rows = wrapper.findAll(".wa-delivery");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("alpha");
    expect(rows[0].text()).toContain("Queued — recipient was busy");
    expect(rows[1].text()).toContain("beta");
    expect(rows[1].text()).toContain("Delivered");
  });

  it("opens the recipient when its chip is clicked", async () => {
    const openAgent = vi.fn();
    const direct = tool("write_agent", { agent_id: BETA, message: "alpha asks" }, "launch-alpha");
    const wrapper = mountWithDirectory(
      WriteAgentRenderer,
      {
        content: `Message delivered to agent ${BETA}. The recipient can reply with write_agent.`,
        args: direct.arguments,
        tc: direct,
      },
      openAgent,
    );
    await flushPromises();
    const chips = wrapper.findAll("button.agent-chip");
    expect(chips.map((c) => c.text())).toEqual(["alpha", "beta", "beta"]);
    await chips[1].trigger("click");
    expect(openAgent).toHaveBeenCalledWith("launch-beta");
  });
});

describe("ListAgentsRenderer", () => {
  it("groups agents by status with relation and model", async () => {
    const wrapper = mountWithDirectory(ListAgentsRenderer, {
      content: `Background agents (scope: siblings):\n\nRunning (1):\n  🔄 beta (${BETA}): general-purpose - "Answer alpha question" (4s, owner: s, relation: sibling) (model: claude-haiku-4.5)\n\nIdle (1):\n  💤 alpha (${ALPHA}): general-purpose - "Coordinate" (9s, owner: s, relation: sibling) (model: claude-haiku-4.5)`,
      args: { scope: "siblings" },
      tc: tool("list_agents", { scope: "siblings" }, "launch-alpha"),
    });
    await flushPromises();
    const groups = wrapper.findAll(".la-group");
    expect(groups).toHaveLength(2);
    expect(groups[0].text()).toContain("Running");
    expect(groups[0].text()).toContain("beta");
    expect(groups[0].text()).toContain("sibling");
    expect(groups[1].text()).toContain("Idle");
    expect(wrapper.text()).toContain("siblings · 2 agents");
  });
});
