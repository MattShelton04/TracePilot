import { getSessionRequestLog } from "@tracepilot/client";
import type { RequestLog } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import RecordedRequestsPanel from "@/components/contextCapture/RecordedRequestsPanel.vue";
import { useClaudeRequestLog } from "@/composables/useClaudeRequestLog";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({ getSessionRequestLog: vi.fn() });
});

enableAutoUnmount(afterEach);

const section = (index: number, content: string) => ({
  index,
  source: "system",
  content,
  bytes: 100,
  characters: 100,
  containsProbe: false,
});

function log(overrides: Partial<RequestLog> = {}): RequestLog {
  return {
    shapes: [
      {
        hash: "main",
        firstUsed: "2026-10-17T00:00:00Z",
        calls: 3,
        agents: [{ agentId: null, agentType: null, calls: 3 }],
        system: [section(0, "Main system prompt.")],
        tools: [
          {
            index: 0,
            name: "Read",
            description: "Read a file.",
            schema: { type: "object", properties: {} },
            raw: {},
            bytes: 300,
            characters: 300,
          },
        ],
        systemBytes: 100,
        toolBytes: 300,
      },
      {
        hash: "explore",
        firstUsed: "2026-10-17T00:01:00Z",
        calls: 1,
        agents: [{ agentId: "a1", agentType: "Explore", calls: 1 }],
        system: [section(0, "Explore system prompt.")],
        tools: [],
        systemBytes: 100,
        toolBytes: 0,
      },
    ],
    omittedShapes: 0,
    omittedShapeHashes: [],
    calls: [
      {
        timestamp: "2026-10-17T00:00:00Z",
        model: "claude-opus-5-5",
        querySource: "repl_main_thread",
        agentId: null,
        agentType: null,
        shapeHash: "main",
        maxTokens: 64000,
        thinking: "adaptive",
        effort: "high",
        betas: ["beta-a"],
        contextEdits: [],
        cacheBreakpoints: 3,
        extendsPrevious: false,
      },
    ],
    totalCalls: 4,
    callsWithoutShape: 0,
    models: [{ name: "claude-opus-5-5", calls: 4 }],
    agents: [
      { agentId: null, agentType: null, calls: 3 },
      { agentId: "a1", agentType: "Explore", calls: 1 },
    ],
    records: 9,
    unreadableRecords: 0,
    files: 2,
    unreadableFiles: 0,
    ...overrides,
  };
}

/** Owns the log as the Context tab does, so props drive its session and refresh. */
const Host = defineComponent({
  props: { sessionId: { type: String, required: true }, refreshKey: { default: 1 } },
  setup(props) {
    const requestLog = useClaudeRequestLog(
      () => props.sessionId,
      () => props.refreshKey,
    );
    return () => h(RecordedRequestsPanel, { requestLog });
  },
});

function mountPanel(sessionId = "session-a", refreshKey = 1) {
  return mount(Host, { props: { sessionId, refreshKey } });
}

const call = log().calls[0];

async function open(wrapper: ReturnType<typeof mountPanel>, label: string) {
  await wrapper
    .findAll(".recorded-requests__tabs button")
    .find((button) => button.text().startsWith(label))
    ?.trigger("click");
}

describe("RecordedRequestsPanel", () => {
  beforeEach(() => {
    vi.mocked(getSessionRequestLog).mockReset();
  });

  it("says plainly when a session has no request records", async () => {
    vi.mocked(getSessionRequestLog).mockResolvedValue(
      log({ shapes: [], calls: [], totalCalls: 0, models: [], agents: [], records: 0 }),
    );
    const wrapper = mountPanel();
    await flushPromises();
    expect(getSessionRequestLog).toHaveBeenCalledWith("session-a");
    expect(wrapper.text()).toContain("No request records in this session.");
    expect(wrapper.find(".recorded-requests__tabs").exists()).toBe(false);
  });

  it("labels the record as Claude Code's, not an exact capture, and shows each set", async () => {
    vi.mocked(getSessionRequestLog).mockResolvedValue(log());
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.text()).toContain("Recorded by Claude Code");
    expect(wrapper.text()).toContain("It is not an exact capture");
    expect(wrapper.text()).toContain("Recorded calls");
    const shapes = wrapper.findAll(".recorded-requests__shapes button").map((b) => b.text());
    expect(shapes).toEqual([
      expect.stringContaining("Main agent"),
      expect.stringContaining("Explore"),
    ]);

    await open(wrapper, "System");
    expect(wrapper.text()).toContain("Main system prompt.");
    await wrapper
      .findAll(".recorded-requests__shapes button")
      .find((button) => button.text().includes("Explore"))
      ?.trigger("click");
    expect(wrapper.text()).toContain("Explore system prompt.");

    await open(wrapper, "Calls");
    expect(wrapper.text()).toContain("The latest 1 of 4 calls");
    expect(wrapper.text()).toContain("repl_main_thread");
    expect(wrapper.text()).toContain("effort high");
    expect(wrapper.text()).toContain("claude-opus-5.5");
    expect(wrapper.text()).not.toContain("claude-opus-5-5");
  });

  it("reloads when the session's data is refreshed, keeping the log on screen", async () => {
    let resolveReload: (value: RequestLog) => void = () => {};
    vi.mocked(getSessionRequestLog)
      .mockResolvedValueOnce(log())
      .mockImplementationOnce(() => new Promise((resolve) => (resolveReload = resolve)));
    const wrapper = mountPanel("session-a", 1);
    await flushPromises();
    await open(wrapper, "Calls");
    expect(wrapper.text()).toContain("The latest 1 of 4 calls");

    await wrapper.setProps({ refreshKey: 2 });
    expect(getSessionRequestLog).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("The latest 1 of 4 calls");
    expect(wrapper.text()).not.toContain("Reading recorded requests");

    resolveReload(
      log({ calls: [call, { ...call, timestamp: "2026-10-17T00:02:00Z" }], totalCalls: 5 }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain("The latest 2 of 5 calls");
  });

  it("keeps the calls page across refreshes and starts another session on the first", async () => {
    const many = (count: number) =>
      log({
        calls: Array.from({ length: count }, (_, i) => ({
          ...call,
          timestamp: new Date(Date.parse(call.timestamp) + i * 1000).toISOString(),
        })),
        totalCalls: count,
      });
    // Each read answers with a new array of the same calls, as the backend does.
    vi.mocked(getSessionRequestLog).mockImplementation(async () => many(120));
    const wrapper = mountPanel("session-a", 1);
    await flushPromises();
    await open(wrapper, "Calls");
    const pager = () => wrapper.get(".recorded-calls__pager").text();
    expect(pager()).toContain("1 / 3");

    const next = () => wrapper.findAll(".recorded-calls__pager button")[1];
    await next().trigger("click");
    await next().trigger("click");
    expect(pager()).toContain("3 / 3");

    await wrapper.setProps({ refreshKey: 2 });
    await flushPromises();
    expect(getSessionRequestLog).toHaveBeenCalledTimes(2);
    expect(pager()).toContain("3 / 3");

    vi.mocked(getSessionRequestLog).mockImplementation(async () => many(80));
    await wrapper.setProps({ refreshKey: 3 });
    await flushPromises();
    expect(pager()).toContain("2 / 2");

    vi.mocked(getSessionRequestLog).mockImplementation(async () => many(120));
    await wrapper.setProps({ sessionId: "session-b" });
    await flushPromises();
    await open(wrapper, "Calls");
    expect(pager()).toContain("1 / 3");
  });

  it("tells a call whose set was left out from one whose set was never recorded", async () => {
    vi.mocked(getSessionRequestLog).mockResolvedValue(
      log({
        omittedShapes: 1,
        omittedShapeHashes: ["old"],
        calls: [
          { ...call, shapeHash: "old" },
          { ...call, shapeHash: "missing", timestamp: "2026-10-17T00:01:00Z" },
        ],
        callsWithoutShape: 1,
        unreadableFiles: 1,
      }),
    );
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("1 unreadable subagent file");
    await open(wrapper, "Calls");
    expect(wrapper.text()).toContain("Set not shown");
    expect(wrapper.text()).toContain("Unrecorded set");
  });

  it("rebuilds each tool's raw definition and uses recorded wording", async () => {
    vi.mocked(getSessionRequestLog).mockResolvedValue(log());
    const wrapper = mountPanel();
    await flushPromises();
    await open(wrapper, "System");
    expect(wrapper.text()).toContain("in the order Claude Code recorded them");
    expect(wrapper.text()).not.toContain("captured API request");
    await open(wrapper, "Tools");
    expect(wrapper.text()).toContain("Tools Claude Code recorded");
    const tools = wrapper.findComponent({ name: "ContextCaptureTools" });
    expect(tools.props("tools")[0].raw).toEqual({
      name: "Read",
      description: "Read a file.",
      input_schema: { type: "object", properties: {} },
    });
  });

  it("drops a late answer for the previous session", async () => {
    let resolveFirst: (value: RequestLog) => void = () => {};
    vi.mocked(getSessionRequestLog)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(
        log({ shapes: [], calls: [], totalCalls: 0, models: [], agents: [], records: 0 }),
      );
    const wrapper = mountPanel("session-a");
    await wrapper.setProps({ sessionId: "session-b" });
    await flushPromises();
    resolveFirst(log());
    await flushPromises();
    expect(wrapper.text()).toContain("No request records in this session.");
  });

  it("offers a retry when the log cannot be read", async () => {
    vi.mocked(getSessionRequestLog).mockRejectedValueOnce(new Error("Session not found"));
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("Session not found");
  });
});
