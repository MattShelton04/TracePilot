// biome-ignore-all assist/source/organizeImports: mocks must register before the store import.
import type { PullRequestSessionLink } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePullRequest } from "@/__tests__/utils/pullRequestFixtures";

const mocks = vi.hoisted(() => ({ counts: vi.fn(), sessions: vi.fn() }));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("@/__tests__/mocks/client");
  return createClientMock({
    getSessionPullRequestRelatedCounts: (...args: unknown[]) => mocks.counts(...args),
    getPullRequestSessions: (...args: unknown[]) => mocks.sessions(...args),
  });
});

import { pullRequestSignature, usePullRequestSessionsStore } from "../pullRequestSessions";

const pr = makePullRequest(1046, ["created"], { primary: true });
const other = makePullRequest(7, ["reviewed"]);

const count = (otherSessionCount: number, number = pr.number) => ({
  host: pr.host,
  owner: pr.owner,
  repo: pr.repo,
  number,
  otherSessionCount,
});

const link = (sessionId: string): PullRequestSessionLink => ({
  sessionId,
  summary: null,
  repository: null,
  source: "copilot",
  updatedAt: null,
  roles: ["updated"],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("pullRequestSessions store", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    mocks.counts.mockResolvedValue([]);
  });

  it("signs a list by its pull requests, whatever their order or case", () => {
    expect(pullRequestSignature([pr, other])).toBe(
      pullRequestSignature([
        { ...other, title: "x" },
        { ...pr, owner: "EXAMPLE" },
      ]),
    );
    expect(pullRequestSignature([pr])).not.toBe(pullRequestSignature([pr, other]));
  });

  it("counts once per set of pull requests, and not at all for none", async () => {
    const store = usePullRequestSessionsStore();
    mocks.counts.mockResolvedValue([count(2)]);
    await store.loadRelatedCounts("s1", []);
    expect(mocks.counts).not.toHaveBeenCalled();
    expect(store.hasEntry("s1")).toBe(false);

    await store.loadRelatedCounts("s1", [pr]);
    // A refresh: new arrays and objects, same pull requests.
    await store.loadRelatedCounts("s1", [{ ...pr }]);
    await store.loadRelatedCounts("s1", [{ ...pr, title: "Renamed" }]);
    expect(mocks.counts).toHaveBeenCalledTimes(1);
    expect(store.relatedCount("s1", { ...pr, owner: "EXAMPLE" })).toBe(2);
  });

  it("keeps a listed pull request's menu when the set changes, and drops an unlisted one's", async () => {
    const store = usePullRequestSessionsStore();
    mocks.counts.mockResolvedValue([count(1), count(1, 7)]);
    mocks.sessions.mockResolvedValue([link("s2")]);
    await store.loadRelatedCounts("s1", [pr, other]);
    await store.loadRelatedSessions("s1", pr);
    await store.loadRelatedSessions("s1", other);

    const next = deferred<unknown>();
    mocks.counts.mockImplementationOnce(() => next.promise);
    const loading = store.loadRelatedCounts("s1", [pr, makePullRequest(8, ["merged"])]);
    // Until the new counts arrive, the old ones and every menu stay.
    expect(store.relatedCount("s1", other)).toBe(1);
    expect(store.relatedSessions("s1", other)?.status).toBe("ready");

    next.resolve([count(4)]);
    await loading;
    expect(store.relatedCount("s1", pr)).toBe(4);
    expect(store.relatedCount("s1", other)).toBe(0);
    expect(store.relatedSessions("s1", pr)?.status).toBe("ready");
    expect(store.relatedSessions("s1", other)).toBeNull();
  });

  it("drops counts that land after a newer set was asked for", async () => {
    const store = usePullRequestSessionsStore();
    const old = deferred<unknown>();
    mocks.counts.mockImplementationOnce(() => old.promise);
    mocks.counts.mockResolvedValueOnce([count(1)]);

    const first = store.loadRelatedCounts("s1", [pr, other]);
    await store.loadRelatedCounts("s1", [pr]);
    old.resolve([count(9)]);
    await first;
    expect(store.relatedCount("s1", pr)).toBe(1);
  });

  it("drops a session list that lands after its session's counts went", async () => {
    const store = usePullRequestSessionsStore();
    mocks.counts.mockResolvedValue([count(1)]);
    await store.loadRelatedCounts("s1", [pr]);
    const old = deferred<PullRequestSessionLink[]>();
    mocks.sessions.mockImplementationOnce(() => old.promise);
    const pending = store.loadRelatedSessions("s1", pr);

    await store.loadRelatedCounts("s1", []);
    await store.loadRelatedCounts("s1", [pr]);
    old.resolve([link("s2")]);
    await pending;
    expect(store.relatedSessions("s1", pr)).toBeNull();
  });

  it("keeps each open session's counts apart", async () => {
    const store = usePullRequestSessionsStore();
    mocks.counts.mockResolvedValueOnce([count(1)]).mockResolvedValueOnce([count(4)]);
    await store.loadRelatedCounts("s1", [pr]);
    await store.loadRelatedCounts("s2", [pr]);
    expect(store.relatedCount("s1", pr)).toBe(1);
    expect(store.relatedCount("s2", pr)).toBe(4);
    expect(mocks.counts.mock.calls).toEqual([["s1"], ["s2"]]);
  });

  it("evicts the session used longest ago, not the one loaded first", async () => {
    const store = usePullRequestSessionsStore();
    for (let i = 0; i < 32; i++) await store.loadRelatedCounts(`s${i}`, [pr]);
    // s0 loaded first but is still on screen, reading its count.
    store.relatedCount("s0", pr);
    await store.loadRelatedCounts("s32", [pr]);
    expect(store.hasEntry("s0")).toBe(true);
    expect(store.hasEntry("s1")).toBe(false);
    expect(store.hasEntry("s32")).toBe(true);
  });
});
