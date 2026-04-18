import { useAsyncGuard } from "@tracepilot/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const mockGetSessionTurns = vi.fn();
const mockCheckSessionFreshness = vi.fn();

vi.mock("@tracepilot/client", () => ({
  getSessionTurns: (...args: unknown[]) => mockGetSessionTurns(...args),
  checkSessionFreshness: (...args: unknown[]) => mockCheckSessionFreshness(...args),
}));

import { useSessionTurnsRefresh } from "@/composables/session/useSessionTurnsRefresh";

type Turn = {
  turnIndex: number;
  userMessage?: string;
  assistantMessages: unknown[];
  toolCalls: Array<{
    toolName: string;
    isSubagent?: boolean;
    isComplete?: boolean;
  }>;
  isComplete?: boolean;
};

const mkTurn = (i: number, overrides: Partial<Turn> = {}): Turn => ({
  turnIndex: i,
  userMessage: `turn-${i}`,
  assistantMessages: [],
  toolCalls: [],
  isComplete: true,
  ...overrides,
});

const mkFixture = (turns: Turn[], size = 100, mtime = 1000) => ({
  turns,
  eventsFileSize: size,
  eventsFileMtime: mtime,
});

function setup() {
  const sessionId = ref<string | null>("sess-1");
  const loaded = ref<Set<string>>(new Set());
  const guard = useAsyncGuard();
  const refresh = useSessionTurnsRefresh({ sessionId, loaded, guard });
  return { sessionId, loaded, guard, refresh };
}

describe("useSessionTurnsRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 0, eventsFileMtime: null });
  });

  it("loadTurns populates turns and events fingerprint", async () => {
    const { refresh } = setup();
    mockGetSessionTurns.mockResolvedValue(mkFixture([mkTurn(0)], 42, 999));
    await refresh.loadTurns();
    expect(refresh.turns.value).toHaveLength(1);
    expect(refresh.turnsError.value).toBeNull();
    expect(refresh.getEventsFingerprint()).toEqual({ size: 42, mtime: 999 });
    expect(refresh.turnsVersion.value).toBe(1);
  });

  it("loadTurns stores error and leaves turns empty on failure", async () => {
    const { refresh } = setup();
    mockGetSessionTurns.mockRejectedValue(new Error("boom"));
    await refresh.loadTurns();
    expect(refresh.turnsError.value).toBe("boom");
    expect(refresh.turns.value).toEqual([]);
  });

  it("replaceTurns bumps version when data changes (empty -> populated)", () => {
    const { refresh } = setup();
    const before = refresh.turnsVersion.value;
    refresh.replaceTurns([mkTurn(0)] as never);
    expect(refresh.turnsVersion.value).toBe(before + 1);
  });

  it("replaceTurns does not bump version when empty stays empty", () => {
    const { refresh } = setup();
    const before = refresh.turnsVersion.value;
    refresh.replaceTurns([]);
    expect(refresh.turnsVersion.value).toBe(before);
  });

  it("mergeTurns appends new turns without replacing unchanged ones", () => {
    const { refresh } = setup();
    refresh.replaceTurns([mkTurn(0), mkTurn(1)] as never);
    const versionAfterReplace = refresh.turnsVersion.value;
    refresh.mergeTurns([mkTurn(0), mkTurn(1), mkTurn(2)] as never);
    expect(refresh.turns.value).toHaveLength(3);
    expect(refresh.turnsVersion.value).toBeGreaterThan(versionAfterReplace);
  });

  it("refreshTurns short-circuits when freshness matches cached fingerprint", async () => {
    const { refresh, guard } = setup();
    mockGetSessionTurns.mockResolvedValue(mkFixture([mkTurn(0)], 50, 77));
    await refresh.loadTurns();
    mockGetSessionTurns.mockClear();

    mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 50, eventsFileMtime: 77 });
    await refresh.refreshTurns("sess-1", guard.current());
    expect(mockGetSessionTurns).not.toHaveBeenCalled();
  });

  it("refreshTurns fetches and merges when freshness differs", async () => {
    const { refresh, guard } = setup();
    mockGetSessionTurns.mockResolvedValue(mkFixture([mkTurn(0)], 50, 77));
    await refresh.loadTurns();

    mockCheckSessionFreshness.mockResolvedValue({ eventsFileSize: 120, eventsFileMtime: 888 });
    mockGetSessionTurns.mockResolvedValue(mkFixture([mkTurn(0), mkTurn(1)], 120, 888));
    await refresh.refreshTurns("sess-1", guard.current());
    expect(refresh.turns.value).toHaveLength(2);
    expect(refresh.getEventsFingerprint()).toEqual({ size: 120, mtime: 888 });
  });

  it("resetTurns clears turns and fingerprint", () => {
    const { refresh } = setup();
    refresh.replaceTurns([mkTurn(0)] as never);
    refresh.setEventsFingerprint({ size: 10, mtime: 5 });
    refresh.resetTurns();
    expect(refresh.turns.value).toEqual([]);
    expect(refresh.getEventsFingerprint()).toEqual({ size: 0, mtime: null });
  });
});
