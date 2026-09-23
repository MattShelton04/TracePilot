import { describe, expect, it } from "vitest";
import {
  formatExactCredits,
  itemChargeNanoAiu,
  millisecondCell,
  reconciliationSentence,
  staleNote,
} from "@/utils/requestLedger";

describe("itemChargeNanoAiu", () => {
  it("charges count × rate ÷ batch without rounding through floats", () => {
    // 19,323 cache-write tokens at 125 AIC per million.
    const charge = itemChargeNanoAiu({
      tokenCount: 19_323,
      batchSize: 1_000_000,
      costPerBatch: "125000000000",
    });
    expect(formatExactCredits(charge)).toBe("2.42 AIC");
  });

  it("keeps a decimal rate's digits", () => {
    const charge = itemChargeNanoAiu({
      tokenCount: 2,
      batchSize: 1,
      costPerBatch: "0.5",
    });
    expect(charge).toEqual({ units: 10_000_000n, scale: 7 }); // exactly 1
  });

  it("refuses to compute from a missing or unusable input", () => {
    const base = { tokenCount: 1, batchSize: 1_000_000, costPerBatch: "1" };
    expect(itemChargeNanoAiu({ ...base, tokenCount: null })).toBeNull();
    expect(itemChargeNanoAiu({ ...base, batchSize: 0 })).toBeNull();
    expect(itemChargeNanoAiu({ ...base, costPerBatch: "n/a" })).toBeNull();
  });
});

describe("millisecondCell", () => {
  it("scales precision with magnitude", () => {
    expect(millisecondCell(6.52).text).toBe("6.5ms");
    expect(millisecondCell(949.6).text).toBe("950ms");
    expect(millisecondCell(4845).text).toBe("4.84s");
    expect(millisecondCell(999.7).text).toBe("1.00s");
  });
});

describe("reconciliationSentence", () => {
  const base = {
    reconciliationStatus: "unverified" as const,
    reconciliationScope: null,
    reconciliationMetrics: [],
    reconciliationDifferences: null,
  };

  it("explains a session that has no shutdown yet", () => {
    expect(
      reconciliationSentence({ ...base, reconciliationDifferences: "no shutdown snapshot" }),
    ).toBe("Not compared: the session has no shutdown totals yet.");
  });

  it("explains a live session that moved on since its requests were read", () => {
    expect(
      reconciliationSentence({
        ...base,
        reconciliationDifferences: "event log changed; refresh required",
      }),
    ).toMatch(/has changed since/);
  });

  it("names the verdict with its scope and metrics", () => {
    expect(
      reconciliationSentence({
        reconciliationStatus: "reconciled",
        reconciliationScope: "allRequests",
        reconciliationMetrics: ["requests", "nanoAiu"],
        reconciliationDifferences: null,
      }),
    ).toBe(
      "Reconciled against the shutdown totals, over all recorded requests (compared request count, AI credits).",
    );
  });
});

describe("staleNote", () => {
  it("treats a stale row behind a readable store as routine", () => {
    expect(staleNote({ freshness: "stale", availability: "ready" }, "ready")).toMatchObject({
      attention: false,
    });
  });

  it("flags a stale row the store could not refresh", () => {
    expect(staleNote({ freshness: "stale", availability: "ready" }, "busy")).toMatchObject({
      attention: true,
    });
  });

  it("says nothing about current rows", () => {
    expect(staleNote({ freshness: "current", availability: "ready" }, "ready")).toBeNull();
  });
});
