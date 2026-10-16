import { makeTurn, makeTurnToolCall, setupPinia } from "@tracepilot/test-utils";
import type { ShutdownMetrics } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { useSessionsStore } from "@/stores/sessions";
import MetricsAgents from "../MetricsAgents.vue";

beforeEach(() => setupPinia());

const rowIds = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('[data-testid="agent-usage-row"]').map((row) => row.attributes("title"));

describe("MetricsAgents", () => {
  it("keeps the current page across usage refreshes", async () => {
    const metrics: ShutdownMetrics = {
      agentUsage: {
        eventIndex: 1,
        hasInvalidFields: false,
        agents: Object.fromEntries(
          Array.from({ length: 51 }, (_, index) => [
            `worker-${String(index).padStart(2, "0")}`,
            { modelMetrics: {} },
          ]),
        ),
      },
    };
    const wrapper = mount(MetricsAgents, { props: { metrics, turns: [] } });
    expect(rowIds(wrapper)).toHaveLength(50);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Next")
      ?.trigger("click");
    const second = rowIds(wrapper);
    expect(second.at(-1)).toBe("worker-50");
    await wrapper.setProps({ metrics: { ...metrics } });
    expect(rowIds(wrapper)).toEqual(second);
    wrapper.unmount();
  });

  it("ranks agents in their tree with a share of the recorded cost", () => {
    const metrics: ShutdownMetrics = {
      totalNanoAiu: 4e9,
      agentUsage: {
        eventIndex: 1,
        hasInvalidFields: false,
        agents: {
          main: {
            totalNanoAiu: 1e9,
            modelMetrics: {
              luna: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40 } },
            },
          },
          paid: { totalNanoAiu: 3e9, modelMetrics: {} },
        },
      },
    };
    const turns = [
      makeTurn({
        toolCalls: [
          makeTurnToolCall({
            toolCallId: "launch-paid",
            agentId: "paid",
            agentDisplayName: "paid",
            isSubagent: true,
          }),
        ],
      }),
    ];
    const wrapper = mount(MetricsAgents, { props: { metrics, turns } });
    expect(rowIds(wrapper)).toEqual(["main", "paid"]);
    expect(wrapper.text()).toContain("Share of cost");
    const paid = wrapper.findAll('[data-testid="agent-usage-row"]')[1];
    expect(paid.text()).toContain("75%");
    expect(paid.text()).toContain("$0.03");
  });

  it("shows observed zero, opens model detail and the agent's activity", async () => {
    const metrics: ShutdownMetrics = {
      agentUsage: {
        eventIndex: 1,
        hasInvalidFields: false,
        agents: {
          worker: {
            totalNanoAiu: 0,
            modelMetrics: {
              luna: {
                totalNanoAiu: 0,
                usage: {
                  inputTokens: 100,
                  outputTokens: 20,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                },
              },
            },
          },
        },
      },
    };
    const wrapper = mount(MetricsAgents, {
      props: {
        metrics,
        turns: [
          makeTurn({
            toolCalls: [
              makeTurnToolCall({
                toolCallId: "launch",
                agentId: "worker",
                agentDisplayName: "Worker",
                isSubagent: true,
              }),
            ],
          }),
        ],
      },
    });
    // An observed zero reads as $0.00, not a dash.
    expect(wrapper.text()).toContain("Attributed cost: $0.00");
    await wrapper.get('[data-testid="agent-usage-row"][title="worker"]').trigger("click");
    const detail = wrapper.get('[data-testid="agent-usage-detail"]');
    expect(detail.text()).toContain("120 tokens");
    expect(detail.text()).toContain("0% cached");
    await detail
      .findAll("button")
      .find((button) => button.text() === "Open agent activity")
      ?.trigger("click");
    expect(wrapper.emitted("activity")).toEqual([["launch"]]);
  });

  it("notes that rows overlap when they include descendants", async () => {
    const metrics: ShutdownMetrics = {
      agentUsage: {
        eventIndex: 1,
        hasInvalidFields: false,
        agents: { main: { modelMetrics: {} }, worker: { modelMetrics: {} } },
      },
    };
    const wrapper = mount(MetricsAgents, { props: { metrics, turns: [] } });
    const branch = wrapper.findAll("button").find((b) => b.text() === "With descendants");
    await branch?.trigger("click");
    expect(wrapper.text()).toContain("Rows include their descendants and overlap");
  });

  it("explains missing per-agent usage and opens activity straight from a row", async () => {
    const turns = [
      makeTurn({
        toolCalls: [
          makeTurnToolCall({
            toolCallId: "launch",
            agentId: "worker",
            agentDisplayName: "Worker",
            isSubagent: true,
          }),
        ],
      }),
    ];
    const copilot = mount(MetricsAgents, { props: { metrics: {}, turns } });
    expect(copilot.text()).toContain("Per-agent usage was not recorded");
    expect(copilot.text()).toContain("Share of tool calls");
    const claude = mount(MetricsAgents, { props: { metrics: {}, turns, showCredits: false } });
    expect(claude.text()).toContain("Claude Code doesn't record usage per agent");
    const worker = claude
      .findAll('[data-testid="agent-usage-row"]')
      .find((row) => row.text().includes("Worker"));
    await worker?.trigger("click");
    expect(claude.emitted("activity")).toEqual([["launch"]]);
  });

  it("shows an unfinished agent of an ended Claude session as No final report", () => {
    const metrics: ShutdownMetrics = {
      agentUsage: {
        eventIndex: 1,
        hasInvalidFields: false,
        agents: { main: { modelMetrics: {} }, worker: { modelMetrics: {} } },
      },
    };
    const turns = [
      makeTurn({
        toolCalls: [
          makeTurnToolCall({
            toolCallId: "launch-worker",
            agentId: "worker",
            agentDisplayName: "worker",
            nativeToolName: "Agent",
            isSubagent: true,
            isComplete: false,
            success: undefined,
          }),
        ],
      }),
    ];
    type Item = ReturnType<typeof useSessionsStore>["sessions"][number];
    useSessionDetailStore().sessionId = "s-1";
    const sessions = useSessionsStore();
    const status = (source: Item["source"], isRunning: boolean) => {
      sessions.sessions = [{ id: "s-1", source, isRunning } as Item];
      const wrapper = mount(MetricsAgents, { props: { metrics, turns } });
      const text = wrapper.get('[data-testid="agent-usage-row"][title="worker"]').text();
      wrapper.unmount();
      return text;
    };
    expect(status("claudeCode", false)).toContain("No final report");
    expect(status("claudeCode", true)).toContain("Running");
    // Copilot is unchanged: an unfinished agent still reads as running.
    expect(status("copilot", false)).toContain("Running");
  });
});
