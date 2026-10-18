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

    expect(wrapper.find(".comms-summary").text()).toContain("2 launches");
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

  it("names recipients the session didn't record and takes delivery from the result", () => {
    const UNKNOWN_A = "72510000-0000-4000-8000-000000000002";
    const UNKNOWN_B = "72510000-0000-4000-8000-000000000003";
    store.turns = [
      {
        turnIndex: 0,
        isComplete: true,
        timestamp: at(0),
        endTimestamp: at(30),
        assistantMessages: [],
        toolCalls: [
          launch("launch-alpha", "alpha", ALPHA_ID, 1),
          tool({
            toolName: "write_agent",
            toolCallId: "to-unknown",
            startedAt: at(4),
            eventIndex: 2,
            arguments: { agent_ids: [UNKNOWN_A, UNKNOWN_B], message: "Review wrapping." },
            resultContent: `Message delivered to 2 agents.\n- ${UNKNOWN_A}, delivered, task_status=running\n- ${UNKNOWN_B}, not accepting messages`,
          }),
          tool({
            toolName: "write_agent",
            toolCallId: "to-alpha",
            startedAt: at(6),
            eventIndex: 3,
            arguments: { agent_id: ALPHA_ID, message: "Carry on." },
            resultContent: `Message delivered to agent ${ALPHA_ID}.`,
          }),
          tool({
            toolName: "write_agent",
            toolCallId: "to-unknown-pending",
            startedAt: at(8),
            eventIndex: 4,
            isComplete: false,
            arguments: { agent_id: UNKNOWN_A, message: "Please review." },
          }),
        ],
      },
    ];
    const wrapper = mountView();
    const row = (id: string) => wrapper.get(`[data-comm-id="message:${id}"]`);
    const cells = (id: string) => row(id).findAll("td");

    const chips = cells("to-unknown")[2]?.findAll(".agent-chip") ?? [];
    expect(chips.map((c) => c.text())).toEqual(["72510000…0002", "72510000…0003"]);
    expect(chips.map((c) => c.attributes("title"))).toEqual([UNKNOWN_A, UNKNOWN_B]);
    expect(chips[0]?.classes()).toContain("agent-chip--unknown");
    const lines = row("to-unknown").findAll(".comms-log-delivery div");
    expect(lines.map((l) => l.text())).toEqual(["delivered to 1 of 2", "1 not accepting messages"]);
    expect(lines[1]?.classes()).toContain("failed");
    // A known recipient with no delivery event is confirmed by the result.
    expect(row("to-alpha").find(".comms-log-delivery").text()).toBe("delivered");
    // No result yet: still named, still unconfirmed.
    expect(cells("to-unknown-pending")[2]?.text()).toBe("72510000…0002");
    expect(row("to-unknown-pending").find(".comms-log-delivery").text()).toBe("unconfirmed");

    // The diagram has no column for them: no arrow, but the row says who it went to.
    const labels = wrapper.findAll(".comms-msg-label").map((t) => t.text());
    expect(labels).toContain("to 2 unrecorded agents");
    expect(labels).toContain("to 1 unrecorded agent");
    const edge = wrapper
      .findAll(".comms-edge")
      .find((e) => e.attributes("aria-label")?.includes("Review wrapping."));
    expect(edge?.findAll(".comms-edge-line")).toHaveLength(0);
    expect(edge?.attributes("aria-label")).toContain(
      `Main agent → ${UNKNOWN_A}, ${UNKNOWN_B} (not recorded in this session)`,
    );
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

  it("counts the exchanges the filters leave listed, launches included", async () => {
    store.turns = messagingSession();
    const wrapper = mountView();
    const stats = () => wrapper.findAll(".comms-stat").map((s) => s.text());
    const toggle = (label: string) =>
      wrapper.findAll(".comms-toggle").find((b) => b.text().startsWith(label));

    // Three rows: two launches and one message.
    expect(wrapper.findAll(".comms-log-row")).toHaveLength(3);
    expect(stats()).toEqual(["2 launches", "1 message", "1 peer", "1 queued"]);

    await toggle("Messages")?.trigger("click");
    expect(wrapper.findAll(".comms-log-row")).toHaveLength(2);
    expect(stats()).toEqual(["2 launches"]);

    await toggle("Launches")?.trigger("click");
    expect(wrapper.findAll(".comms-log-row")).toHaveLength(0);
    expect(stats()).toEqual(["0 exchanges"]);

    await toggle("Messages")?.trigger("click");
    await toggle("Launches")?.trigger("click");
    await wrapper.find("#comms-agent-filter").setValue("launch-alpha");
    expect(wrapper.findAll(".comms-log-row")).toHaveLength(2);
    expect(stats()).toEqual(["1 launch", "1 message", "1 peer", "1 queued"]);
  });

  it("counts a launch-only session's launches rather than claiming 0 messages", () => {
    const [turn] = messagingSession();
    if (!turn) throw new Error("missing turn");
    store.turns = [
      { ...turn, toolCalls: [launch("launch-alpha", "alpha", ALPHA_ID, 1)], agentMessages: [] },
    ];
    const wrapper = mountView();
    expect(wrapper.findAll(".comms-log-row")).toHaveLength(1);
    expect(wrapper.findAll(".comms-stat").map((s) => s.text())).toEqual(["1 launch"]);
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

  it("keeps the selected exchange and scrubbed time when a running turn gains a message", async () => {
    store.turns = messagingSession().map((turn) => ({ ...turn, isComplete: false }));
    const wrapper = mountView();
    const graph = wrapper.findAll(".comms-toolbar button").find((b) => b.text() === "Graph");
    await graph?.trigger("click");
    await wrapper.findAll(".comms-log-row")[2]?.trigger("click");
    await wrapper.find("#comms-graph-scrubber").setValue("9000");
    expect(wrapper.find(".graph-clock").text()).toBe("9.0s / 30s");

    const [turn] = messagingSession();
    if (!turn) throw new Error("missing turn");
    store.turns = [
      {
        ...turn,
        isComplete: false,
        endTimestamp: at(40),
        toolCalls: [
          ...turn.toolCalls,
          tool({
            toolName: "write_agent",
            toolCallId: "new-main-msg",
            startedAt: at(35),
            eventIndex: 5,
            arguments: { agent_id: ALPHA_ID, message: "New work arrived" },
          }),
        ],
      },
    ];
    await nextTick();

    expect(wrapper.find(".comms-summary").text()).toContain("2 messages");
    expect(wrapper.find(".graph-clock").text()).toBe("9.0s / 40s");
    expect(wrapper.find(".comms-log-row--selected").attributes("data-comm-id")).toBe(
      "message:alpha-msg",
    );
    expect(wrapper.findAll(".comms-log-row")).toHaveLength(4);
  });
});
