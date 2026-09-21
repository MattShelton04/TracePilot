import {
  getRequestPerformance,
  getSessionRequestUsage,
  getSessionStoreStatus,
} from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import type { RequestLedgerPage, SessionCoverageRow, StoredRequest } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useRequestLedger } from "@/composables/session/useRequestLedger";
import { usePreferencesStore } from "@/stores/preferences";
import { formatExactCredits } from "@/utils/requestLedger";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
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
    sourceRowId: 1,
    sessionId: "s1",
    sourceTurnIndex: 0,
    agentId: null,
    parentToolCallId: null,
    model: "gpt-5.6-luna",
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: null,
    reasoningTokens: null,
    totalNanoAiu: "1000000000",
    requestMultiplier: "1",
    durationMs: 1200,
    timeToFirstTokenMs: 400,
    outputTtftMs: null,
    interTokenLatencyMs: null,
    initiator: "user",
    apiEndpoint: "ws:/responses",
    reasoningEffort: "high",
    finishReason: "stop",
    contentFilterTriggered: false,
    copilotUsageModel: null,
    billingItemsStatus: "complete",
    billingCheck: "exact",
    recordedAt: "2026-09-20T10:14:52.317Z",
    invalidFields: [],
    rowFingerprint: "fp-1",
    billingItems: [],
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
    reconciliationStatus: "unverified",
    reconciliationScope: null,
    reconciliationMetrics: [],
    reconciliationDifferences: null,
    readAt: "2026-09-20T10:30:00.000Z",
    revision: 1,
    ...overrides,
  };
}

function respond(page: RequestLedgerPage, coverage: SessionCoverageRow | null = makeCoverage()) {
  return { enabled: true, page, coverage };
}

beforeEach(() => {
  setupPinia();
  usage.mockReset();
  performance.mockReset();
  status.mockReset();
  performance.mockResolvedValue({
    enabled: true,
    available: false,
    performance: null,
    coverage: null,
  });
  status.mockResolvedValue({ enabled: true, resolvedPath: null, source: null });
});

describe("useRequestLedger", () => {
  it("loads the first page and keeps the credit sum exact beyond float precision", async () => {
    // Both totals exceed Number.MAX_SAFE_INTEGER; Number() would round them.
    usage.mockResolvedValue(
      respond(
        makePage({
          requests: [
            makeRequest({ totalNanoAiu: "9007199254740993" }),
            makeRequest({ sourceRowId: 2, totalNanoAiu: "9007199254740993" }),
          ],
        }),
      ),
    );

    const ledger = useRequestLedger(() => "s1");
    await flushPromises();

    expect(ledger.requests.value).toHaveLength(2);
    expect(ledger.pageCredits.value.total).toEqual({ units: 18014398509481986n, scale: 0 });
    // The same sum through `Number()` loses the last two nano units.
    expect(BigInt(Number("9007199254740993") * 2)).not.toBe(18014398509481986n);
    expect(formatExactCredits(ledger.pageCredits.value.total)).toBe("18,014,399 AIC");
    expect(ledger.pageCredits.value.counted).toBe(2);
  });

  it("counts rows with no recorded charge apart from rows that recorded one", async () => {
    usage.mockResolvedValue(
      respond(
        makePage({
          requests: [
            makeRequest({ totalNanoAiu: null }),
            makeRequest({ sourceRowId: 2, totalNanoAiu: "not-a-number" }),
            makeRequest({ sourceRowId: 3, totalNanoAiu: "500000000" }),
          ],
        }),
      ),
    );

    const ledger = useRequestLedger(() => "s1");
    await flushPromises();

    expect(ledger.pageCredits.value).toMatchObject({ counted: 1, missing: 1, unparsed: 1 });
    expect(formatExactCredits(ledger.pageCredits.value.total)).toBe("0.5 AIC");
  });

  it("separates an unavailable source from an empty page", async () => {
    usage.mockResolvedValue(respond(makePage({ requests: [], available: false }), null));
    const unavailable = useRequestLedger(() => "s1");
    await flushPromises();
    expect(unavailable.available.value).toBe(false);
    expect(unavailable.isEmpty.value).toBe(false);

    usage.mockResolvedValue(respond(makePage({ requests: [] })));
    const empty = useRequestLedger(() => "s2");
    await flushPromises();
    expect(empty.available.value).toBe(true);
    expect(empty.isEmpty.value).toBe(true);
  });

  it("restarts at page one when a cursor outlives its source generation", async () => {
    const first = makeRequest({ sourceRowId: 10 });
    const replaced = makeRequest({ sourceRowId: 99, generation: "gen-2" });
    usage
      .mockResolvedValueOnce(respond(makePage({ requests: [first], nextCursor: "cursor-2" })))
      .mockResolvedValueOnce(respond(makePage({ requests: [], cursorExpired: true })))
      .mockResolvedValueOnce(respond(makePage({ requests: [replaced], generation: "gen-2" })));

    const ledger = useRequestLedger(() => "s1");
    await flushPromises();
    await ledger.nextPage();
    await flushPromises();

    expect(ledger.cursorReset.value).toBe(true);
    expect(ledger.pageNumber.value).toBe(1);
    // The expired page is never merged with the replacement.
    expect(ledger.requests.value).toEqual([replaced]);
    expect(usage.mock.calls[2]?.[1]).toMatchObject({ cursor: null });
  });

  it("pages forward and back over the cursor chain", async () => {
    const one = makeRequest({ sourceRowId: 1 });
    const two = makeRequest({ sourceRowId: 2 });
    usage
      .mockResolvedValueOnce(respond(makePage({ requests: [one], nextCursor: "c2" })))
      .mockResolvedValueOnce(respond(makePage({ requests: [two], nextCursor: null })))
      .mockResolvedValueOnce(respond(makePage({ requests: [one], nextCursor: "c2" })));

    const ledger = useRequestLedger(() => "s1");
    await flushPromises();
    expect(ledger.hasPreviousPage.value).toBe(false);

    await ledger.nextPage();
    expect(usage.mock.calls[1]?.[1]).toMatchObject({ cursor: "c2" });
    expect(ledger.pageNumber.value).toBe(2);
    expect(ledger.hasNextPage.value).toBe(false);

    await ledger.previousPage();
    expect(usage.mock.calls[2]?.[1]).toMatchObject({ cursor: null });
    expect(ledger.pageNumber.value).toBe(1);
  });

  it("sends only the filters that were set and restarts paging when they change", async () => {
    usage.mockResolvedValue(respond(makePage({ nextCursor: "c2" })));
    const ledger = useRequestLedger(() => "s1");
    await flushPromises();
    expect(usage.mock.calls[0]?.[1]).toMatchObject({ filters: undefined });

    await ledger.nextPage();
    ledger.filters.model = "gpt-5.6-luna";
    ledger.filters.cacheReuse = "none";
    await ledger.applyFilters();

    const last = usage.mock.calls.at(-1)?.[1];
    expect(last).toMatchObject({ cursor: null });
    // "recorded no reuse" is false, not null: unrecorded counters are neither.
    expect(last?.filters).toEqual({ models: ["gpt-5.6-luna"], reportsCacheReuse: false });
    expect(ledger.pageNumber.value).toBe(1);
    expect(ledger.activeFilterCount.value).toBe(2);
  });

  it("offers filter options from the pages seen so far", async () => {
    usage.mockResolvedValue(
      respond(
        makePage({
          requests: [
            makeRequest({ agentId: "agent-a", initiator: "user" }),
            makeRequest({ sourceRowId: 2, agentId: null, initiator: "sub-agent" }),
          ],
        }),
      ),
    );
    const ledger = useRequestLedger(() => "s1");
    await flushPromises();

    expect(ledger.filterOptions.value.agentIds).toEqual(["agent-a"]);
    expect(ledger.filterOptions.value.initiators).toEqual(["sub-agent", "user"]);

    await ledger.setAgentFilter("agent-a");
    expect(usage.mock.calls.at(-1)?.[1]?.filters).toEqual({ agentIds: ["agent-a"] });
  });

  it("reads nothing while the feature is off", async () => {
    usage.mockResolvedValue(respond(makePage()));
    const prefs = usePreferencesStore();
    // The store hydrates from config on creation, which would overwrite a flag
    // set before that read resolved.
    await flushPromises();
    prefs.featureFlags.sessionStoreEnrichment = false;

    const disabled = useRequestLedger(() => "s1");
    await flushPromises();
    expect(disabled.enabled.value).toBe(false);
    expect(usage).not.toHaveBeenCalled();
  });

  it("reads nothing until the section is expanded", async () => {
    usage.mockResolvedValue(respond(makePage()));
    const active = ref(false);
    const collapsed = useRequestLedger(
      () => "s2",
      () => active.value,
    );
    await flushPromises();
    expect(usage).not.toHaveBeenCalled();

    active.value = true;
    await flushPromises();
    expect(usage).toHaveBeenCalledTimes(1);
    expect(collapsed.loaded.value).toBe(true);
  });

  it("surfaces a failed read instead of an empty ledger", async () => {
    usage.mockRejectedValue(new Error("store is locked"));
    const ledger = useRequestLedger(() => "s1");
    await flushPromises();

    expect(ledger.error.value).toBe("store is locked");
    expect(ledger.loaded.value).toBe(false);
    expect(ledger.available.value).toBe(false);
  });
});
