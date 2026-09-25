import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import AgentMessagesView from "../../../components/timeline/AgentMessagesView.vue";
import { provideSessionAgentDirectory } from "../../../composables/useSessionAgentDirectory";
import { useSessionDetailStore } from "../../../stores/sessionDetail";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSessionDetail: vi.fn(),
    getSessionTurns: vi.fn(),
    getSessionEvents: vi.fn(),
    getSessionTodos: vi.fn(),
    getSessionCheckpoints: vi.fn(),
    getShutdownMetrics: vi.fn(),
  });
});

const ALPHA_ID = "65f59a0b-dcb7-4bc0-bd1b-1c971ca4edd4";
const BETA_ID = "9fec072e-1ce7-49f2-9378-c9465b7a6b84";
const at = (s: number) => `2026-09-25T09:00:${String(s).padStart(2, "0")}.000Z`;

function tool(partial: Partial<TurnToolCall> & Pick<TurnToolCall, "toolName">): TurnToolCall {
  return { isComplete: true, success: true, ...partial };
}

function launch(key: string, name: string, agentId: string, eventIndex: number): TurnToolCall {
  return tool({
    toolName: "task",
    toolCallId: key,
    isSubagent: true,
    agentId,
    agentStatus: "idle",
    startedAt: at(2),
    completedAt: at(20),
    eventIndex,
    arguments: { name, agent_type: "general-purpose", prompt: `You are ${name}.` },
  });
}

/** Main launches alpha and beta; alpha asks beta a question, which waits in beta's queue. */
function messagingSession(): ConversationTurn[] {
  return [
    {
      turnIndex: 0,
      isComplete: true,
      timestamp: at(0),
      endTimestamp: at(30),
      assistantMessages: [],
      toolCalls: [
        launch("launch-alpha", "alpha", ALPHA_ID, 1),
        launch("launch-beta", "beta", BETA_ID, 2),
        tool({
          toolName: "write_agent",
          toolCallId: "alpha-msg",
          parentToolCallId: "launch-alpha",
          startedAt: at(8),
          eventIndex: 3,
          arguments: { agent_id: BETA_ID, message: "What is 6*7?" },
        }),
      ],
      agentMessages: [
        {
          content: "What is 6*7?",
          recipientToolCallId: "launch-beta",
          senderAgentId: ALPHA_ID,
          isLaunch: false,
          delivery: "queued",
          timestamp: at(12),
          eventIndex: 4,
        },
      ],
    },
  ];
}

function mountView() {
  const store = useSessionDetailStore();
  const Host = defineComponent({
    setup() {
      provideSessionAgentDirectory(store);
      return () => h(AgentMessagesView);
    },
  });
  return mount(Host, { attachTo: document.body });
}

describe("AgentMessagesView", () => {
  let store: ReturnType<typeof useSessionDetailStore>;

  beforeEach(() => {
    setupPinia();
    store = useSessionDetailStore();
  });

  it("explains when the session has no agent exchanges", () => {
    store.turns = [{ turnIndex: 0, isComplete: true, assistantMessages: [], toolCalls: [] }];
    const wrapper = mountView();
    expect(wrapper.text()).toContain("No agent exchanges");
  });

  it("summarises the exchanges and lists them in time order", () => {
    store.turns = messagingSession();
    const wrapper = mountView();

    expect(wrapper.find(".comms-summary").text()).toContain("1 message");
    expect(wrapper.find(".comms-summary").text()).toContain("1 peer");
    expect(wrapper.find(".comms-summary").text()).toContain("1 queued");

    const rows = wrapper.findAll(".comms-log-row");
    expect(rows.map((r) => r.find(".comms-kind").text())).toEqual([
      "Launch prompt",
      "Launch prompt",
      "Peer",
    ]);
    expect(rows[2]?.find(".comms-log-delivery").text()).toBe("+4.0s queued");
  });

  it("draws one sequence column per agent, with the queued wait on the recipient", () => {
    store.turns = messagingSession();
    const wrapper = mountView();
    const heads = wrapper.findAll(".seq-header .seq-head-name").map((n) => n.text());
    expect(heads).toEqual(["Main agent", "alpha", "beta"]);
    expect(wrapper.findAll(".seq-wait")).toHaveLength(1);
  });

  it("filters by kind and by agent", async () => {
    store.turns = messagingSession();
    const wrapper = mountView();

    const launches = wrapper.findAll(".comms-toggle").find((b) => b.text().startsWith("Launches"));
    await launches?.trigger("click");
    expect(wrapper.findAll(".comms-log-row")).toHaveLength(1);
    await launches?.trigger("click");

    await wrapper.find("#comms-agent-filter").setValue("launch-alpha");
    expect(wrapper.findAll(".comms-log-row")).toHaveLength(2);
  });

  it("selects an exchange in the log and the diagram together", async () => {
    store.turns = messagingSession();
    const wrapper = mountView();

    const peerRow = wrapper.findAll(".comms-log-row")[2];
    await peerRow?.trigger("click");
    await nextTick();
    expect(peerRow?.classes()).toContain("comms-log-row--selected");
    expect(wrapper.find(".comms-edge--selected").attributes("aria-label")).toContain(
      "alpha → beta",
    );

    await wrapper.find(".comms-edge--selected").trigger("click");
    expect(wrapper.find(".comms-log-row--selected").exists()).toBe(false);
  });

  it("switches between the sequence, lanes and graph diagrams", async () => {
    store.turns = messagingSession();
    const wrapper = mountView();
    const option = (label: string) =>
      wrapper.findAll(".comms-toolbar button").find((b) => b.text() === label);

    await option("Lanes")?.trigger("click");
    expect(wrapper.find(".lanes-zoom").exists()).toBe(true);
    expect(wrapper.findAll(".lane-name").map((t) => t.text())).toEqual([
      "Main agent",
      "alpha",
      "beta",
    ]);

    await option("Graph")?.trigger("click");
    expect(wrapper.find("#comms-graph-scrubber").exists()).toBe(true);
    expect(wrapper.findAll(".graph-node")).toHaveLength(3);
  });
});
