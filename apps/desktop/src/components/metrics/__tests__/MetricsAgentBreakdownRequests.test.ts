import { getAgentRequestRollups } from "@tracepilot/client";
import { makeTurn, makeTurnToolCall, setupPinia } from "@tracepilot/test-utils";
import type {
  AgentRequestRollup,
  AgentRequestRollupResponse,
  ConversationTurn,
  ShutdownMetrics,
} from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { SESSION_DETAIL_KEY } from "@/composables/session/contextKey";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import MetricsAgentBreakdown from "../MetricsAgentBreakdown.vue";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../../__tests__/mocks/client");
  return createClientMock({ getAgentRequestRollups: vi.fn() });
});

const rollupsCall = vi.mocked(getAgentRequestRollups);

function rollup(overrides: Partial<AgentRequestRollup> = {}): AgentRequestRollup {
  return {
    runKey: null,
    agentId: null,
    requestCount: 0,
    ownNanoAiu: null,
    cacheReadTokens: 0,
    inputTokens: 0,
    unattributedRequests: 0,
    ...overrides,
  };
}

function respond(overrides: Partial<AgentRequestRollupResponse> = {}): AgentRequestRollupResponse {
  return { enabled: true, available: true, rollups: [], ...overrides };
}

/** A shutdown snapshot with a main agent and one launched sub-agent. */
function fixture(): { metrics: ShutdownMetrics; turns: ConversationTurn[] } {
  const call = makeTurnToolCall({
    toolCallId: "call-1",
    isSubagent: true,
    agentId: "agent-explore-01",
    agentDisplayName: "Explore",
  });
  return {
    metrics: {
      totalNanoAiu: 10_000_000_000,
      metricsTimestamp: "2026-09-20T10:00:00.000Z",
      agentUsage: {
        eventIndex: 1,
        timestamp: "2026-09-20T10:00:00.000Z",
        hasInvalidFields: false,
        agents: {
          main: { totalNanoAiu: 6_000_000_000, modelMetrics: {} },
          "agent-explore-01": { totalNanoAiu: 2_000_000_000, modelMetrics: {} },
        },
      },
    } as unknown as ShutdownMetrics,
    turns: [makeTurn({ turnIndex: 0, toolCalls: [call] })],
  };
}

async function render(response: AgentRequestRollupResponse | null) {
  if (response) rollupsCall.mockResolvedValue(response);
  const { metrics, turns } = fixture();
  const wrapper = mount(MetricsAgentBreakdown, {
    props: { metrics, turns },
    global: {
      provide: {
        [SESSION_DETAIL_KEY as symbol]: reactive({
          sessionId: "session-a",
        }) as unknown as SessionDetailContext,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(async () => {
  setupPinia();
  rollupsCall.mockReset();
  await flushPromises();
  usePreferencesStore().featureFlags.sessionStoreEnrichment = true;
});

describe("MetricsAgentBreakdown request columns", () => {
  it("adds request columns without replacing the shutdown totals", async () => {
    const wrapper = await render(
      respond({
        rollups: [
          rollup({
            agentId: "main",
            requestCount: 2,
            ownNanoAiu: "4474355000",
            cacheReadTokens: 295_259,
            inputTokens: 307_432,
          }),
        ],
      }),
    );

    const headers = wrapper.findAll("th").map((th) => th.text());
    expect(headers).toContain("Recorded credits");
    expect(headers).toContain("Model requests");
    expect(headers).toContain("Request credits");
    expect(headers).toContain("Request cache read");

    const mainRow = wrapper.findAll("tbody tr")[0].text();
    // The shutdown figure (6 AIC) and the recorded-request figure both stand.
    expect(mainRow).toContain("6 AIC");
    expect(mainRow).toContain("4.47 AIC");
    expect(mainRow).toContain("96.0%");
  });

  it("uses exact decimal arithmetic for own credits", async () => {
    const wrapper = await render(
      respond({
        rollups: [rollup({ agentId: "main", requestCount: 1, ownNanoAiu: "9007199254740993" })],
      }),
    );

    // Number("9007199254740993") is 9007199254740992, which would render
    // 9,007,199 AIC either way — the exactness is asserted on the helper in
    // agentRequestRollups.test.ts; here it must simply not be NaN or blank.
    expect(wrapper.findAll("tbody tr")[0].text()).toContain("9,007,199 AIC");
  });

  it("keeps an agent with no recorded requests visibly unrecorded", async () => {
    const wrapper = await render(
      respond({ rollups: [rollup({ agentId: "main", requestCount: 4, ownNanoAiu: "1000000000" })] }),
    );

    const rows = wrapper.findAll("tbody tr");
    // The sub-agent has shutdown credits but no roll-up; its request cells are
    // dashes rather than a fabricated zero.
    expect(rows[1].text()).toContain("2 AIC");
    expect(rows[1].text()).toContain("—");
  });

  it("displays unattributed requests instead of folding them into an agent", async () => {
    const wrapper = await render(
      respond({
        rollups: [
          rollup({ agentId: "main", requestCount: 3, ownNanoAiu: "1000000000" }),
          rollup({ requestCount: 2, ownNanoAiu: "4474355000", unattributedRequests: 2 }),
        ],
      }),
    );

    const note = wrapper.get('[data-testid="agent-requests-unattributed"]').text();
    expect(note).toContain("Not attributed to an agent run: 2 recorded request(s)");
    expect(note).toContain("4.47 AIC");
    expect(note).toContain("the breakdown above does not say where");
    // The main agent still shows only its own three requests.
    expect(wrapper.findAll("tbody tr")[0].text()).toContain("3");
  });

  it("says the source was unreadable rather than hiding the breakdown", async () => {
    const wrapper = await render(respond({ available: false, rollups: [] }));

    expect(wrapper.get('[data-testid="agent-requests-unavailable"]').text()).toContain(
      "No session store could be read",
    );
    expect(wrapper.findAll("th").map((th) => th.text())).not.toContain("Model requests");
    // The shutdown-based breakdown is untouched.
    expect(wrapper.get('[data-testid="agent-usage-table"]').text()).toContain("6 AIC");
  });

  it("reads nothing while the feature is off", async () => {
    usePreferencesStore().featureFlags.sessionStoreEnrichment = false;
    const wrapper = await render(null);

    expect(rollupsCall).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="agent-requests-note"]').exists()).toBe(false);
  });
});
