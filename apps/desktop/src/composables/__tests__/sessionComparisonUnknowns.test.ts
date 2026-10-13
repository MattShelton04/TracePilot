import { setupPinia } from "@tracepilot/test-utils";
import type {
  ConversationTurn,
  SessionDetail,
  ShutdownMetrics,
  TurnToolCall,
} from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

// Compare shows a value it does not know as "—", never as a number.

vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({ sessions: [], fetchSessions: vi.fn(async () => {}) }),
}));
vi.mock("@/stores/preferences", async () => {
  const { calculateTokenCost } =
    await vi.importActual<typeof import("@tracepilot/types")>("@tracepilot/types");
  const price = (model: string, input: number, cache: number, output: number) =>
    calculateTokenCost(model, { inputTokens: input, cacheReadTokens: cache, outputTokens: output });
  return {
    usePreferencesStore: () => ({
      computeUsageBasedCostBreakdown: price,
      computeWholesaleCostBreakdown: price,
    }),
  };
});
vi.mock("@tracepilot/client", () => ({
  getSessionDetail: vi.fn(),
  getShutdownMetrics: vi.fn(),
  getSessionTurns: vi.fn(),
}));

import { type NormMode, type SessionData, useSessionComparison } from "../useSessionComparison";
import { filesModified, linesChanged, sessionDurationMs, successRate } from "../useSessionMetrics";

function turnWith(...outcomes: Array<boolean | undefined>): ConversationTurn {
  return {
    turnIndex: 0,
    assistantMessages: [],
    isComplete: true,
    toolCalls: outcomes.map(
      (success) => ({ toolName: "bash", success, isComplete: success != null }) as TurnToolCall,
    ),
  };
}

function compared(a: Partial<SessionData>, b: Partial<SessionData> = {}, mode: NormMode = "raw") {
  const host = mount(
    defineComponent({ setup: () => ({ comp: useSessionComparison() }), template: "<div />" }),
  );
  const comp = host.vm.comp;
  comp.compared = true;
  comp.normMode = mode;
  Object.assign(comp.dataA, a);
  Object.assign(comp.dataB, b);
  return (label: string) => comp.metricsRows.find((row) => row.label.startsWith(label));
}

const at = (createdAt?: string, updatedAt?: string) =>
  ({ id: "s", hasPlan: false, hasCheckpoints: false, createdAt, updatedAt }) as SessionDetail;

const unknown = { valueA: "—", rawA: null, delta: "—" };

describe("Compare keeps unknown values unknown", () => {
  beforeEach(() => setupPinia());

  it("rates success over completed calls, as the Tools page does", () => {
    // One pending call of four does not count as a failure.
    expect(successRate([turnWith(true, true, true, undefined)])).toBe(1);
    expect(successRate([turnWith(true, false, undefined)])).toBe(0.5);
    // No completed call has no success rate.
    expect(successRate([])).toBeNull();
    expect(successRate([turnWith(undefined)])).toBeNull();

    const row = compared({ turns: [] }, { turns: [turnWith(true, false)] });
    expect(row("Success Rate")).toMatchObject({ ...unknown, valueB: "50%", rawB: 0.5 });
  });

  it("shows code changes as unknown without a change record", () => {
    expect([linesChanged(null), filesModified(null)]).toEqual([null, null]);
    expect([linesChanged({ codeChanges: {} }), filesModified({ codeChanges: {} })]).toEqual([
      null,
      null,
    ]);
    // A recorded empty change set is a real zero.
    const none = { codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] } };
    expect([linesChanged(none), filesModified(none)]).toEqual([0, 0]);

    // A Copilot session that has not shut down has no change record.
    const changed: ShutdownMetrics = {
      codeChanges: { linesAdded: 3, linesRemoved: 1, filesModified: ["src/a.ts"] },
    };
    const row = compared({ metrics: null }, { metrics: changed });
    expect(row("Files Modified")).toMatchObject({ ...unknown, valueB: "1", rawB: 1 });
    expect(row("Lines Changed")).toMatchObject({ ...unknown, valueB: "4", rawB: 4 });
  });

  it("shows an unknown session span as unknown", () => {
    expect(sessionDurationMs(at("2026-10-01T00:00:00Z"))).toBeNull();
    expect(sessionDurationMs(at("2026-10-01T00:00:00Z", "2026-10-01T00:02:00Z"))).toBe(120_000);

    const metrics: ShutdownMetrics = {
      modelMetrics: { model: { usage: { inputTokens: 100, outputTokens: 20 } } },
    };
    const row = compared(
      { detail: at("2026-10-01T00:00:00Z"), metrics },
      { detail: at("2026-10-01T00:00:00Z", "2026-10-01T00:02:00Z"), metrics },
    );
    expect(row("Session Span")).toMatchObject({ ...unknown, valueB: "2m 0s" });
    expect(row("Total Tokens")).toMatchObject({ rawA: 120, rawB: 120 });
  });

  it("does not divide by an unknown span in per-minute mode", () => {
    const metrics: ShutdownMetrics = {
      modelMetrics: { model: { usage: { inputTokens: 100, outputTokens: 20 } } },
    };
    const row = compared(
      { detail: at("2026-10-01T00:00:00Z"), metrics },
      { detail: at("2026-10-01T00:00:00Z", "2026-10-01T00:02:00Z"), metrics },
      "per-minute",
    );
    expect(row("Total Tokens")).toMatchObject({ ...unknown, valueB: "60.0", rawB: 60 });
  });

  it("shows a Claude Code session's last snapshot cost as a lower bound, as Overview does", () => {
    const partial: ShutdownMetrics = {
      modelMetrics: {},
      coverage: {
        partial: true,
        snapshotLine: 3,
        recordedCalls: 2,
        tailCalls: 1,
        snapshotCost: { amount: 0.25, unit: "usd", basis: "providerEstimate" },
      },
    };
    const row = compared(
      { detail: { id: "a", source: "claudeCode" } as SessionDetail, metrics: partial },
      { detail: { id: "b", source: "claudeCode" } as SessionDetail, metrics: partial },
    );
    // A lower bound is shown but never compared.
    expect(row("Estimated Cost")).toMatchObject({
      valueA: "≥ $0.25",
      valueB: "≥ $0.25",
      rawA: null,
      rawB: null,
      delta: "—",
    });
  });
});
