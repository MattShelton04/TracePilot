// biome-ignore-all assist/source/organizeImports: mocks must register before the store import.
import type { PullRequestSessionLink } from "@tracepilot/types";
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePullRequest } from "@/__tests__/utils/pullRequestFixtures";

const mocks = vi.hoisted(() => ({ counts: vi.fn(), sessions: vi.fn() }));
const listeners = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn(async (event: string, handler: () => void) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  }),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("@/__tests__/mocks/client");
  return createClientMock({
    getSessionPullRequestRelatedCounts: (...args: unknown[]) => mocks.counts(...args),
    getPullRequestSessions: (...args: unknown[]) => mocks.sessions(...args),
  });
});

import { IPC_EVENTS } from "@tracepilot/client";
import { pullRequestSignature, usePullRequestSessionsStore } from "../pullRequestSessions";

const finishIndexPass = () => listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();

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
    listeners.clear();
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

  it("counts again after a failed load, for the same pull requests", async () => {
    const store = usePullRequestSessionsStore();
    mocks.counts.mockRejectedValueOnce(new Error("busy")).mockResolvedValue([count(2)]);
    await store.loadRelatedCounts("s1", [pr]);
    expect(store.relatedCount("s1", pr)).toBe(0);

    await store.loadRelatedCounts("s1", [{ ...pr }]);
    expect(mocks.counts).toHaveBeenCalledTimes(2);
    expect(store.relatedCount("s1", pr)).toBe(2);
    await store.loadRelatedCounts("s1", [{ ...pr }]);
    expect(mocks.counts).toHaveBeenCalledTimes(2);
  });

  it("counts again after an index pass, keeping the old counts until the new ones land", async () => {
    const store = usePullRequestSessionsStore();
    await store.watchIndexUpdates();
    mocks.counts.mockResolvedValueOnce([count(0)]);
    await store.loadRelatedCounts("s1", [pr]);
    const revision = store.revision;

    finishIndexPass();
    expect(store.revision).toBe(revision + 1);
    const fresh = createDeferred<unknown>();
    mocks.counts.mockImplementationOnce(() => fresh.promise);
    const loading = store.loadRelatedCounts("s1", [{ ...pr }]);
    expect(store.relatedCount("s1", pr)).toBe(0);
    expect(store.hasEntry("s1")).toBe(true);

    fresh.resolve([count(1)]);
    await loading;
    expect(store.relatedCount("s1", pr)).toBe(1);
    // Once is enough per pass.
    await store.loadRelatedCounts("s1", [pr]);
    expect(mocks.counts).toHaveBeenCalledTimes(2);
  });

  it("drops counts asked for before an index pass that land after the reload's", async () => {
    const store = usePullRequestSessionsStore();
    await store.watchIndexUpdates();
    const old = createDeferred<unknown>();
    mocks.counts.mockImplementationOnce(() => old.promise).mockResolvedValueOnce([count(1)]);
    const first = store.loadRelatedCounts("s1", [pr]);
    finishIndexPass();
    await store.loadRelatedCounts("s1", [pr]);
    old.resolve([count(0)]);
    await first;
    expect(store.relatedCount("s1", pr)).toBe(1);
  });

  it("loads an outdated menu list again on its next open, showing the old one meanwhile", async () => {
    const store = usePullRequestSessionsStore();
    await store.watchIndexUpdates();
    mocks.counts.mockResolvedValue([count(1)]);
    mocks.sessions.mockResolvedValueOnce([link("s2")]);
    await store.loadRelatedCounts("s1", [pr]);
    await store.loadRelatedSessions("s1", pr);
    await store.loadRelatedSessions("s1", pr);
    expect(mocks.sessions).toHaveBeenCalledTimes(1);

    finishIndexPass();
    const fresh = createDeferred<PullRequestSessionLink[]>();
    mocks.sessions.mockImplementationOnce(() => fresh.promise);
    const loading = store.loadRelatedSessions("s1", pr);
    expect(store.relatedSessions("s1", pr)).toMatchObject({
      status: "ready",
      sessions: [link("s2")],
    });
    fresh.resolve([link("s2"), link("s3")]);
    await loading;
    expect(store.relatedSessions("s1", pr)?.sessions.map((s) => s.sessionId)).toEqual(["s2", "s3"]);
    await store.loadRelatedSessions("s1", pr);
    expect(mocks.sessions).toHaveBeenCalledTimes(2);
  });

  it("keeps an outdated menu list when its reload fails, and tries again on the next open", async () => {
    const store = usePullRequestSessionsStore();
    await store.watchIndexUpdates();
    mocks.counts.mockResolvedValue([count(1)]);
    mocks.sessions.mockResolvedValueOnce([link("s2")]);
    await store.loadRelatedCounts("s1", [pr]);
    await store.loadRelatedSessions("s1", pr);

    finishIndexPass();
    mocks.sessions.mockRejectedValueOnce(new Error("busy")).mockResolvedValueOnce([link("s3")]);
    await store.loadRelatedSessions("s1", pr);
    expect(store.relatedSessions("s1", pr)).toMatchObject({ status: "ready", error: null });
    expect(store.relatedSessions("s1", pr)?.sessions.map((s) => s.sessionId)).toEqual(["s2"]);
    await store.loadRelatedSessions("s1", pr);
    expect(store.relatedSessions("s1", pr)?.sessions.map((s) => s.sessionId)).toEqual(["s3"]);
  });

  it("drops a menu list asked for before an index pass that lands after the reload's", async () => {
    const store = usePullRequestSessionsStore();
    await store.watchIndexUpdates();
    mocks.counts.mockResolvedValue([count(1)]);
    await store.loadRelatedCounts("s1", [pr]);
    const old = createDeferred<PullRequestSessionLink[]>();
    mocks.sessions.mockImplementationOnce(() => old.promise).mockResolvedValueOnce([link("s3")]);
    const first = store.loadRelatedSessions("s1", pr);
    finishIndexPass();
    await store.loadRelatedSessions("s1", pr);
    old.resolve([link("s2")]);
    await first;
    expect(store.relatedSessions("s1", pr)?.sessions.map((s) => s.sessionId)).toEqual(["s3"]);
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
