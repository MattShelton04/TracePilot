import { getSessionRequestLog } from "@tracepilot/client";
import type { RequestLog } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordedRequestsPanel from "@/components/contextCapture/RecordedRequestsPanel.vue";

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
    ...overrides,
  };
}

function mountPanel(sessionId = "session-a") {
  return mount(RecordedRequestsPanel, { props: { sessionId } });
}

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

  it("says plainly that sessions from older Claude Code versions recorded nothing", async () => {
    vi.mocked(getSessionRequestLog).mockResolvedValue(
      log({ shapes: [], calls: [], totalCalls: 0, models: [], agents: [], records: 0 }),
    );
    const wrapper = mountPanel();
    await flushPromises();
    expect(getSessionRequestLog).toHaveBeenCalledWith("session-a");
    expect(wrapper.text()).toContain("This Claude Code version didn't record requests.");
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
    expect(wrapper.text()).toContain("This Claude Code version didn't record requests.");
  });

  it("offers a retry when the log cannot be read", async () => {
    vi.mocked(getSessionRequestLog).mockRejectedValueOnce(new Error("Session not found"));
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("Session not found");
  });
});
