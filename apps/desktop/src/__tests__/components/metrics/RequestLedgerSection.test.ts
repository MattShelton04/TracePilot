import {
  getRequestPerformance,
  getSessionRequestUsage,
  getSessionStoreStatus,
} from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import type {
  RequestLedgerPage,
  RequestLedgerSummary,
  RequestPerformance,
  SessionCoverageRow,
  StoredRequest,
} from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MetricsRequestLedgerSection from "@/components/metrics/MetricsRequestLedgerSection.vue";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSessionRequestUsage: vi.fn(),
    getRequestPerformance: vi.fn(),
    getSessionStoreStatus: vi.fn(),
  });
});

const usage = vi.mocked(getSessionRequestUsage);
const performance = vi.mocked(getRequestPerformance);
const status = vi.mocked(getSessionStoreStatus);

function makeRequest(overrides: Partial<StoredRequest> = {}): StoredRequest {
  return {
    sourceId: "src",
    generation: "gen-1",
    sourceRowId: 4021,
    sessionId: "s1",
    sourceTurnIndex: 3,
    agentId: null,
    parentToolCallId: null,
    model: "gpt-5.6-luna",
    inputTokens: 148_934,
    outputTokens: 1_284,
    // A recorded zero: the request reused nothing, which is not "unrecorded".
    cacheReadTokens: 0,
    cacheWriteTokens: null,
    reasoningTokens: 640,
    totalNanoAiu: "9007199254740993",
    requestMultiplier: "1",
    durationMs: 4845,
    timeToFirstTokenMs: 3306.5,
    // Never recorded on this row.
    outputTtftMs: null,
    interTokenLatencyMs: 6.52,
    initiator: "user",
    apiEndpoint: "ws:/responses",
    reasoningEffort: "high",
    finishReason: "tool_calls",
    contentFilterTriggered: false,
    copilotUsageModel: null,
    billingItemsStatus: "complete",
    billingCheck: "exact",
    recordedAt: "2026-09-20T10:14:52.317Z",
    invalidFields: [],
    rowFingerprint: "fp-4021",
    billingItems: [
      {
        ordinal: 0,
        tokenType: "input",
        tokenCount: 1_734,
        batchSize: 1_000_000,
        costPerBatch: "1250000.0000001",
        billingModel: null,
      },
    ],
    ...overrides,
  };
}

function makePage(overrides: Partial<RequestLedgerPage> = {}): RequestLedgerPage {
  return {
    requests: [makeRequest()],
    nextCursor: null,
    generation: "gen-1",
    available: true,
    cursorExpired: false,
    ...overrides,
  };
}

function makeCoverage(overrides: Partial<SessionCoverageRow> = {}): SessionCoverageRow {
  return {
    sessionId: "s1",
    generation: "gen-1",
    availability: "ready",
    freshness: "current",
    requestRows: 1,
    requestRowsRejected: 0,
    workRefRows: 0,
    workRefRowsRejected: 0,
    billingAbsent: 0,
    billingPartial: 0,
    billingInvalid: 0,
    fieldCoverageJson: null,
    missingColumns: [],
    reconciliationStatus: "scopeDifference",
    reconciliationScope: "excludingCompaction",
    reconciliationMetrics: ["requests", "inputTokens"],
    reconciliationDifferences: null,
    readAt: "2026-09-20T10:30:00.000Z",
    revision: 1,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<RequestLedgerSummary> = {}): RequestLedgerSummary {
  return {
    requestCount: 1,
    totalNanoAiu: "9007199254740993",
    chargedRequests: 1,
    unchargedRequests: 0,
    unreadableCharges: 0,
    facets: {
      models: ["gpt-5.6-luna"],
      agentIds: [],
      initiators: ["user"],
      reasoningEfforts: ["high"],
      finishReasons: ["tool_calls"],
    },
    ...overrides,
  };
}

function respond(
  page = makePage(),
  coverage: SessionCoverageRow | null = makeCoverage(),
  summary: RequestLedgerSummary | null = makeSummary(),
) {
  return { enabled: true, page, coverage, summary };
}

const distribution = (median: number | null, valid: number) => ({
  median,
  p95: null,
  min: median,
  max: median,
  coverage: { valid, missing: 0, invalid: 0 },
});

function makePerformance(): RequestPerformance {
  return {
    requestCount: 12,
    sessionCount: 1,
    durationMs: distribution(4845, 12),
    timeToFirstTokenMs: distribution(3306.5, 12),
    outputTtftMs: distribution(null, 0),
    interTokenLatencyMs: distribution(6.52, 12),
    cache: {
      requestsReportingReuse: 11,
      requestsWithCounter: 12,
      tokenWeightedRatio: 0.9,
      cacheReadTokens: 900,
      inputTokens: 1000,
      inconsistentRows: 0,
    },
  };
}

async function mountExpanded(hasShutdownTotals = false) {
  const wrapper = mount(MetricsRequestLedgerSection, {
    props: { sessionId: "s1", hasShutdownTotals },
    global: { stubs: { teleport: true } },
  });
  await wrapper.get("[aria-controls]").trigger("click");
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setupPinia();
  usage.mockReset();
  performance.mockReset();
  status.mockReset();
  usage.mockResolvedValue(respond());
  performance.mockResolvedValue({
    enabled: true,
    available: false,
    performance: null,
    coverage: null,
  });
  status.mockResolvedValue({
    enabled: true,
    resolvedPath: null,
    source: null,
    lastRefreshError: null,
  });
});

describe("MetricsRequestLedgerSection", () => {
  it("stays collapsed until asked for, then reads the store once", async () => {
    const wrapper = mount(MetricsRequestLedgerSection, {
      props: { sessionId: "s1" },
      global: { stubs: { teleport: true } },
    });
    await flushPromises();

    const toggle = wrapper.get("[aria-controls]");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(usage).not.toHaveBeenCalled();

    await toggle.trigger("click");
    await flushPromises();
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(usage).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="request-ledger-table"]').exists()).toBe(true);
  });

  it("distinguishes a recorded zero from a value that was never recorded", async () => {
    const wrapper = await mountExpanded();
    const cells = wrapper.get('[data-testid="request-ledger-table"]').findAll("tbody td");
    const texts = cells.map((cell) => cell.text());

    expect(texts).toContain("0");
    const missing = wrapper.get('[data-testid="request-ledger-table"] .ledger-missing');
    expect(missing.text()).toBe("—");
    expect(missing.attributes("title")).toContain("did not record");
    expect(missing.attributes("aria-label")).toBe("Not recorded");
  });

  it("says no source is available rather than showing an empty table", async () => {
    usage.mockResolvedValue(respond(makePage({ requests: [], available: false }), null));
    const wrapper = await mountExpanded();

    expect(wrapper.get('[data-testid="request-ledger-unavailable"]').text()).toContain(
      "No Copilot session store available",
    );
    expect(wrapper.find('[data-testid="request-ledger-table"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="request-ledger-empty"]').exists()).toBe(false);
  });

  it("says the session recorded nothing when the source was read and was empty", async () => {
    usage.mockResolvedValue(respond(makePage({ requests: [] }), makeCoverage({ requestRows: 0 })));
    const wrapper = await mountExpanded();

    expect(wrapper.get('[data-testid="request-ledger-empty"]').text()).toContain(
      "no model requests recorded for this session",
    );
    expect(wrapper.find('[data-testid="request-ledger-unavailable"]').exists()).toBe(false);
    // Zero-valued cards and an empty filter bar would only restate the sentence.
    expect(wrapper.find('[data-testid="request-ledger-credits"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "RequestLedgerFilters" }).exists()).toBe(false);
  });

  it("restarts and explains itself when the cursor outlives its source", async () => {
    usage
      .mockResolvedValueOnce(respond(makePage({ nextCursor: "c2" })))
      .mockResolvedValueOnce(respond(makePage({ requests: [], cursorExpired: true })))
      .mockResolvedValueOnce(respond(makePage({ nextCursor: "c2" })));
    const wrapper = await mountExpanded();

    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Next")
      ?.trigger("click");
    await flushPromises();

    const banner = wrapper.get('[data-testid="request-ledger-cursor-reset"]');
    expect(banner.text()).toContain("changed while paging");
    expect(wrapper.text()).toContain("Page 1");
  });

  it("surfaces rejected rows and invalid billing instead of implying a complete sum", async () => {
    usage.mockResolvedValue(
      respond(
        makePage(),
        makeCoverage({
          requestRows: 12,
          requestRowsRejected: 3,
          billingInvalid: 2,
          missingColumns: ["output_ttft_ms"],
        }),
      ),
    );
    const wrapper = await mountExpanded();

    const banner = wrapper.get('[data-testid="request-ledger-partial-coverage"]');
    expect(banner.text()).toContain("3 request rows were rejected");
    expect(banner.text()).toContain("2 requests had invalid billing items");
    expect(banner.text()).toContain("output_ttft_ms");
  });

  it("totals credits over the whole session and flags a partial sum", async () => {
    usage.mockResolvedValue(
      respond(
        makePage(),
        makeCoverage({ requestRows: 3 }),
        makeSummary({
          requestCount: 3,
          totalNanoAiu: "2500000000",
          chargedRequests: 2,
          unchargedRequests: 1,
        }),
      ),
    );
    const wrapper = await mountExpanded();

    const card = wrapper.get('[data-testid="request-ledger-credits"]');
    expect(card.text()).toContain("2.5 AIC");
    expect(card.text()).toContain("Recorded credits (partial)");
  });

  it("offers every recorded filter value, not only those on the page", async () => {
    usage.mockResolvedValue(
      respond(
        makePage(),
        makeCoverage(),
        makeSummary({ facets: { ...makeSummary().facets, agentIds: ["later-page-agent"] } }),
      ),
    );
    const wrapper = await mountExpanded();
    expect(wrapper.get('[data-testid="request-ledger-filters"]').text()).toContain(
      "later-page-agent",
    );
  });

  it("shows the session's median duration and cache reuse beside the counts", async () => {
    performance.mockResolvedValue({
      enabled: true,
      available: true,
      performance: makePerformance(),
      coverage: null,
    });
    const wrapper = await mountExpanded();
    expect(wrapper.text()).toContain("Median duration");
    expect(wrapper.text()).toContain("4.84s");
    expect(wrapper.text()).toContain("Cache reads / input");
    expect(wrapper.text()).toContain("90%");
  });

  it("names recorded requests apart from the shutdown totals", async () => {
    const withoutShutdown = await mountExpanded(false);
    expect(withoutShutdown.text()).toContain("Recorded requests so far");

    const withShutdown = await mountExpanded(true);
    expect(withShutdown.text()).toContain("Recorded requests");
    expect(withShutdown.text()).not.toContain("Recorded requests so far");
    expect(withShutdown.text()).toContain("come from the shutdown record");
  });

  it("reports the reconciliation verdict together with its scope", async () => {
    const wrapper = await mountExpanded(true);
    const summary = wrapper.get('[data-testid="request-ledger-reconciliation-summary"]');
    expect(summary.text()).toContain("Different accounting scope");
    expect(summary.text()).toContain("requests excluding compaction");
  });

  it("does not compare an in-progress session with shutdown totals it lacks", async () => {
    usage.mockResolvedValue(
      respond(
        makePage(),
        makeCoverage({
          freshness: "stale",
          reconciliationStatus: "unverified",
          reconciliationScope: null,
          reconciliationMetrics: [],
          reconciliationDifferences: "no shutdown snapshot",
        }),
      ),
    );
    const wrapper = await mountExpanded(false);

    expect(wrapper.text()).toContain("Recorded requests so far");
    expect(wrapper.find('[data-testid="request-ledger-reconciliation-summary"]').exists()).toBe(
      false,
    );
    // A live session going stale is routine, not a failed read.
    const sync = wrapper.get('[data-testid="request-ledger-sync"]');
    expect(sync.text()).toContain("refreshes automatically");
    expect(sync.find(".ledger__stale").exists()).toBe(false);
  });

  it("flags cached rows when the store could not be read", async () => {
    usage.mockResolvedValue(
      respond(makePage(), makeCoverage({ freshness: "stale", availability: "busy" })),
    );
    const wrapper = await mountExpanded();
    const sync = wrapper.get('[data-testid="request-ledger-sync"]');
    expect(sync.get(".ledger__stale").text()).toContain("could not be read");
  });

  it("expands a row with the exact recorded charge and both first-token metrics", async () => {
    const wrapper = await mountExpanded();
    await wrapper.get('[data-testid="request-ledger-table"] tbody button').trigger("click");
    await flushPromises();

    const drawer = wrapper.get('[data-testid="request-ledger-detail"]');
    // The exact string, not a float round-trip of it.
    expect(drawer.text()).toContain("9007199254740993");
    // The rate reads in credits; the exact recorded value stays one hover away.
    expect(drawer.text()).toContain("0.001 AIC");
    expect(drawer.find('[title*="1250000.0000001"]').exists()).toBe(true);
    expect(drawer.text()).toContain("Time to first token");
    expect(drawer.text()).toContain("First observable output");
    expect(drawer.text()).toContain("not a TracePilot turn index");
    expect(wrapper.find('[data-testid="request-ledger-agent-action"]').exists()).toBe(false);
  });

  it("expands a row in place and closes it from the row or when the row leaves", async () => {
    const wrapper = await mountExpanded();
    const toggle = wrapper.get('[data-testid="request-ledger-table"] tbody button');
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    // The detail is the table row directly beneath the request it explains.
    const rows = wrapper.findAll('[data-testid="request-ledger-table"] tbody tr');
    expect(rows[1].find('[data-testid="request-ledger-detail"]').exists()).toBe(true);
    await toggle.trigger("click");
    expect(wrapper.find('[data-testid="request-ledger-detail"]').exists()).toBe(false);

    await wrapper.get('[data-testid="request-ledger-table"] tbody tr').trigger("click");
    expect(wrapper.find('[data-testid="request-ledger-detail"]').exists()).toBe(true);

    usage.mockResolvedValue(respond(makePage({ requests: [makeRequest({ sourceRowId: 9999 })] })));
    await wrapper.findComponent({ name: "RequestLedgerFilters" }).vm.$emit("clear");
    await flushPromises();
    expect(wrapper.find('[data-testid="request-ledger-detail"]').exists()).toBe(false);
  });

  it("offers the agent action only when an agent was recorded", async () => {
    usage.mockResolvedValue(respond(makePage({ requests: [makeRequest({ agentId: "agent-a" })] })));
    const wrapper = await mountExpanded();
    await wrapper.get('[data-testid="request-ledger-table"] tbody button').trigger("click");
    await flushPromises();

    const action = wrapper.get('[data-testid="request-ledger-agent-action"]');
    expect(action.text()).toContain("Show this agent's requests");
    await action.trigger("click");
    await flushPromises();

    expect(usage.mock.calls.at(-1)?.[1]?.filters).toEqual({ agentIds: ["agent-a"] });
  });
});
