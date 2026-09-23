import type { CacheObservation } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { makeWindow } from "@/utils/__tests__/promptCacheFixtures";
import { buildObservationView, observationsByWindow } from "@/utils/cacheObservations";

function observation(overrides: Partial<CacheObservation> = {}): CacheObservation {
  return {
    windowIndex: 0,
    sourceRowId: 4021,
    model: "gpt-5.6-luna",
    recordedAt: "2026-09-12T00:10:02.000Z",
    cacheReadTokens: 12_480,
    cacheWriteTokens: 0,
    inputTokens: 96_210,
    attribution: "validated",
    comparison: "agrees",
    ...overrides,
  };
}

describe("observationsByWindow", () => {
  it("indexes by window, and leaves unmatched windows out entirely", () => {
    const byWindow = observationsByWindow([
      observation({ windowIndex: 1 }),
      observation({ windowIndex: 3 }),
    ]);
    expect([...byWindow.keys()]).toEqual([1, 3]);
    // A window with no entry is the normal case: no reliable association.
    expect(byWindow.get(2)).toBeUndefined();
  });

  it("keeps the first entry for a window rather than the last", () => {
    const byWindow = observationsByWindow([
      observation({ windowIndex: 1, sourceRowId: 10 }),
      observation({ windowIndex: 1, sourceRowId: 11 }),
    ]);
    expect(byWindow.get(1)?.sourceRowId).toBe(10);
  });
});

describe("buildObservationView", () => {
  it("pairs the prediction with the recorded counters without rewriting it", () => {
    const window = makeWindow({ outcome: "expired", confidence: "predicted" });
    const view = buildObservationView(window, observation({ comparison: "differs" }));

    expect(view.pairing).toBe(
      "Predicted expired; the resuming request recorded 12,480 cache reads.",
    );
    // The window's own prediction is untouched by the observation.
    expect(window.outcome).toBe("expired");
    expect(window.confidence).toBe("predicted");
  });

  it("draws out a disagreement rather than smoothing it over", () => {
    const view = buildObservationView(
      makeWindow({ outcome: "expired" }),
      observation({ comparison: "differs" }),
    );

    expect(view.comparisonLabel).toBe("Recorded: differs");
    expect(view.tone).toBe("warning");
    expect(view.comparisonNote).toContain("says more than either figure alone");
    expect(view.comparisonNote).toContain("left as it was recorded");
  });

  it("calls agreement consistent, never proof that the prefix had expired", () => {
    const view = buildObservationView(
      makeWindow({ outcome: "expired" }),
      observation({ comparison: "agrees", cacheReadTokens: 0 }),
    );

    expect(view.comparisonLabel).toBe("Recorded: agrees");
    expect(view.tone).toBe("neutral");
    expect(view.comparisonNote).toContain("Consistent, not proven");
    expect(view.comparisonNote).toContain("no reuse was recorded");
    expect(view.comparisonNote).toContain("never");
    expect(view.pairing).toBe("Predicted expired; the resuming request recorded no cache reads.");
  });

  it("keeps an absent counter apart from a recorded zero", () => {
    const view = buildObservationView(
      makeWindow({ outcome: "warm" }),
      observation({ cacheReadTokens: null }),
    );

    expect(view.pairing).toBe(
      "Predicted warm; the resuming request recorded no cache-read counter.",
    );
    expect(view.rows).toContainEqual({ label: "Recorded cache reads", value: "Not recorded" });
  });

  it("never claims the pair was matched by identity when it was not", () => {
    const validated = buildObservationView(makeWindow(), observation());
    expect(validated.rows).toContainEqual({
      label: "Match",
      value: "Matched on order, interval and model, not by a shared identifier.",
    });

    const ambiguous = buildObservationView(makeWindow(), observation({ attribution: "ambiguous" }));
    expect(ambiguous.rows.find((row) => row.label === "Match")?.value).toContain("ambiguous");
  });

  it("never describes a cost difference as savings", () => {
    const view = buildObservationView(makeWindow(), observation());
    const text = [view.pairing, view.comparisonNote, ...view.rows.map((row) => row.value)].join(
      " ",
    );
    expect(text.toLowerCase()).not.toContain("saving");
    expect(text.toLowerCase()).not.toContain("actual");
  });
});
