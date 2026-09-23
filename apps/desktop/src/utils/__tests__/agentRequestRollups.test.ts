import type { AgentRequestRollup } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { cacheReadRatio, joinAgentRequestRollups } from "@/utils/agentRequestRollups";
import type { AgentUsageRow } from "@/utils/agentUsageRows";
import { formatExactCredits } from "@/utils/requestLedger";

function row(id: string, parentId: string | null, depth: number): AgentUsageRow {
  const numbers = {
    credits: null,
    apiMs: null,
    requests: null,
    tokens: {
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      uncached: null,
      notCached: null,
      reasoning: null,
      total: null,
      cacheRatio: null,
      inconsistent: false,
    },
    tools: 0,
    partial: true,
  } as unknown as AgentUsageRow["own"];
  return {
    id,
    name: id,
    parentId,
    depth,
    status: "done",
    models: {},
    modelNames: "",
    own: numbers,
    branch: numbers,
  };
}

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

describe("joinAgentRequestRollups", () => {
  it("accumulates distinct rollups for one agent without losing requests", () => {
    const join = joinAgentRequestRollups(
      [row("agent-a", null, 0)],
      [
        rollup({ agentId: "agent-a", runKey: "one", requestCount: 2, ownNanoAiu: "1" }),
        rollup({ agentId: "agent-a", runKey: "two", requestCount: 3, ownNanoAiu: "2" }),
      ],
    );
    expect(join.byRow.get("agent-a")?.own.requestCount).toBe(5);
    expect(join.byRow.get("agent-a")?.own.nanoAiu).toEqual({ units: 3n, scale: 0 });
  });

  it("keeps non-exact attribution out of an agent's own totals", () => {
    const join = joinAgentRequestRollups(
      [row("agent-a", null, 0)],
      [rollup({ agentId: "agent-a", requestCount: 2, unattributedRequests: 2 })],
    );
    expect(join.byRow.get("agent-a")?.own.requestCount).toBe(0);
    expect(join.attribution.unmatched?.requestCount).toBe(2);
  });

  it("marks branch credits incomplete when a descendant's charge is missing", () => {
    const join = joinAgentRequestRollups(
      [row("main", null, 0), row("child", "main", 1)],
      [
        rollup({ agentId: "main", requestCount: 1, ownNanoAiu: "100" }),
        rollup({ agentId: "child", requestCount: 1 }),
      ],
    );
    expect(join.byRow.get("main")?.branch.unparsedCredits).toBe(1);
  });

  it("adds nano-AIU totals exactly, past the range binary floats can hold", () => {
    // Each total is above Number.MAX_SAFE_INTEGER; Number() would round both
    // operands before they were ever added.
    const rows = [row("main", null, 0), row("agent-a", "main", 1)];
    const join = joinAgentRequestRollups(rows, [
      rollup({ agentId: "main", requestCount: 1, ownNanoAiu: "9007199254740993" }),
      rollup({ agentId: "agent-a", requestCount: 1, ownNanoAiu: "9007199254740993" }),
    ]);

    const main = join.byRow.get("main");
    expect(main?.own.nanoAiu).toEqual({ units: 9_007_199_254_740_993n, scale: 0 });
    expect(main?.branch.nanoAiu).toEqual({ units: 18_014_398_509_481_986n, scale: 0 });
    // The same figure via Number() would land on ...4992, one unit adrift.
    expect(Number("9007199254740993")).toBe(9_007_199_254_740_992);
    expect(formatExactCredits(main?.branch.nanoAiu ?? null)).toBe("18,014,399 AIC");
  });

  it("keeps fractional nano-AIU strings exact when summing a branch", () => {
    const rows = [row("main", null, 0), row("agent-a", "main", 1)];
    const join = joinAgentRequestRollups(rows, [
      rollup({ agentId: "main", requestCount: 1, ownNanoAiu: "104812500" }),
      rollup({ agentId: "agent-a", requestCount: 1, ownNanoAiu: "0.3" }),
    ]);

    expect(join.byRow.get("main")?.branch.nanoAiu).toEqual({ units: 1_048_125_003n, scale: 1 });
  });

  it("sums each descendant into a branch exactly once", () => {
    const rows = [row("main", null, 0), row("agent-a", "main", 1), row("agent-b", "agent-a", 2)];
    const join = joinAgentRequestRollups(rows, [
      rollup({ agentId: "main", requestCount: 2, ownNanoAiu: "1000000000" }),
      rollup({ agentId: "agent-a", requestCount: 3, ownNanoAiu: "2000000000" }),
      rollup({ agentId: "agent-b", requestCount: 5, ownNanoAiu: "4000000000" }),
    ]);

    expect(join.byRow.get("main")?.own.requestCount).toBe(2);
    expect(join.byRow.get("main")?.branch.requestCount).toBe(10);
    expect(join.byRow.get("agent-a")?.branch.requestCount).toBe(8);
    expect(join.byRow.get("agent-b")?.branch.requestCount).toBe(5);
    expect(join.byRow.get("main")?.branch.nanoAiu).toEqual({ units: 7_000_000_000n, scale: 0 });
  });

  it("never attributes one roll-up to two rows", () => {
    // One roll-up carries both identities, and the breakdown happens to have a
    // row under each. Counting it twice would inflate the session's requests.
    const rows = [row("agent-a", null, 0), row("run-1", null, 0)];
    const join = joinAgentRequestRollups(rows, [
      rollup({ runKey: "run-1", agentId: "agent-a", requestCount: 4, ownNanoAiu: "5000000000" }),
    ]);

    expect(join.byRow.get("agent-a")?.own.requestCount).toBe(4);
    expect(join.byRow.get("run-1")?.own.requestCount).toBe(0);
    expect(join.byRow.get("run-1")?.own.nanoAiu).toBeNull();
    expect(join.attribution.unmatchedRollups).toBe(0);
  });

  it("keeps unattributed requests visible instead of folding them into an agent", () => {
    const rows = [row("main", null, 0)];
    const join = joinAgentRequestRollups(rows, [
      rollup({ agentId: "main", requestCount: 3, ownNanoAiu: "1000000000" }),
      rollup({ requestCount: 2, ownNanoAiu: "4474355000", unattributedRequests: 2 }),
    ]);

    expect(join.attribution.unattributedRequests).toBe(2);
    expect(join.attribution.unmatched?.requestCount).toBe(2);
    expect(formatExactCredits(join.attribution.unmatched?.nanoAiu ?? null)).toBe("4.47 AIC");
    // The identified agent keeps only its own work.
    expect(join.byRow.get("main")?.own.requestCount).toBe(3);
    expect(join.byRow.get("main")?.branch.requestCount).toBe(3);
  });

  it("counts roll-ups whose run has no row rather than dropping them", () => {
    const join = joinAgentRequestRollups(
      [row("main", null, 0)],
      [rollup({ runKey: "run-ghost", requestCount: 7, ownNanoAiu: "1000000000" })],
    );

    expect(join.attribution.unmatchedRollups).toBe(1);
    expect(join.byRow.get("main")?.own.requestCount).toBe(0);
  });

  it("reports no figures when the source recorded nothing", () => {
    expect(joinAgentRequestRollups([row("main", null, 0)], []).hasFigures).toBe(false);
  });

  it("flags an unreadable charge instead of silently dropping it from a sum", () => {
    const join = joinAgentRequestRollups(
      [row("main", null, 0)],
      [rollup({ agentId: "main", requestCount: 1, ownNanoAiu: "not-a-number" })],
    );

    expect(join.byRow.get("main")?.own.nanoAiu).toBeNull();
    expect(join.byRow.get("main")?.own.unparsedCredits).toBe(1);
  });
});

describe("cacheReadRatio", () => {
  it("returns null rather than an impossible ratio when counters contradict", () => {
    expect(
      cacheReadRatio({
        requestCount: 1,
        nanoAiu: null,
        unparsedCredits: 0,
        cacheReadTokens: 200,
        inputTokens: 100,
      }),
    ).toBeNull();
  });

  it("keeps a recorded zero as a zero ratio", () => {
    expect(
      cacheReadRatio({
        requestCount: 1,
        nanoAiu: null,
        unparsedCredits: 0,
        cacheReadTokens: 0,
        inputTokens: 100,
      }),
    ).toBe(0);
  });

  it("has nothing to divide when no input was recorded", () => {
    expect(
      cacheReadRatio({
        requestCount: 1,
        nanoAiu: null,
        unparsedCredits: 0,
        cacheReadTokens: 0,
        inputTokens: 0,
      }),
    ).toBeNull();
  });
});
