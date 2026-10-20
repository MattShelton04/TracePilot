import { refreshListPullRequests, refreshSessionPullRequests } from "@tracepilot/client";
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import type { PullRequestRef, PullRequestRefreshResult, SessionListItem } from "@tracepilot/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { useSessionPullRequestStatus } from "@/composables/useSessionPullRequestStatus";
import { useWindowRole } from "@/composables/useWindowRole";
import { usePreferencesStore } from "@/stores/preferences";
import { usePullRequestStatusStore } from "@/stores/pullRequestStatus";
import { useSessionsStore } from "@/stores/sessions";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock();
});

function ref(number: number, state: PullRequestRef["state"]): PullRequestRef {
  return {
    host: "github.com",
    owner: "example",
    repo: "orchard",
    number,
    url: `https://github.com/example/orchard/pull/${number}`,
    state,
  };
}

function result(fields: Partial<PullRequestRefreshResult> = {}): PullRequestRefreshResult {
  return { lookup: "ok", updated: [], linksChanged: false, ...fields };
}

function listItem(id: string, primary: PullRequestRef): SessionListItem {
  return {
    id,
    eventCount: 1,
    turnCount: 1,
    linkedPullRequests: { count: 1, primary },
  } as SessionListItem;
}

describe("pullRequestStatus store", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    vi.mocked(refreshSessionPullRequests).mockResolvedValue(result());
    vi.mocked(refreshListPullRequests).mockResolvedValue(result());
  });
  afterEach(() => {
    useWindowRole().role.value = "main";
  });

  it("looks a session up and records how the lookup went", async () => {
    vi.mocked(refreshSessionPullRequests).mockResolvedValue(result({ lookup: "signedOut" }));
    const store = usePullRequestStatusStore();
    const answer = await store.refreshSession("s1", true);
    expect(refreshSessionPullRequests).toHaveBeenCalledWith("s1", true);
    expect(answer?.lookup).toBe("signedOut");
    expect(store.lookup).toBe("signedOut");
    expect(store.notice).toBe("signedOut");
  });

  it("shows a running lookup per session and shares it with a second caller", async () => {
    const pending = createDeferred<PullRequestRefreshResult>();
    vi.mocked(refreshSessionPullRequests).mockReturnValueOnce(pending.promise);
    const store = usePullRequestStatusStore();
    const first = store.refreshSession("s1");
    const second = store.refreshSession("s1", true);
    expect(store.isRefreshing("s1")).toBe(true);
    expect(store.isRefreshing("s2")).toBe(false);
    pending.resolve(result());
    expect(await first).toEqual(await second);
    expect(refreshSessionPullRequests).toHaveBeenCalledTimes(1);
    expect(store.isRefreshing("s1")).toBe(false);
  });

  it("gives the session list the states GitHub reported", async () => {
    const sessions = useSessionsStore();
    sessions.sessions = [listItem("a", ref(1, null)), listItem("b", ref(2, "open"))];
    vi.mocked(refreshListPullRequests).mockResolvedValue(
      result({ updated: [ref(1, "merged"), ref(9, "closed")] }),
    );
    const store = usePullRequestStatusStore();
    await store.refreshList(["a", "b"]);
    expect(refreshListPullRequests).toHaveBeenCalledWith(["a", "b"]);
    expect(sessions.sessions.map((s) => s.linkedPullRequests?.primary.state)).toEqual([
      "merged",
      "open",
    ]);
    expect(store.lastListPollAt).not.toBeNull();
  });

  it("keeps the last lookup and logs when the call fails", async () => {
    vi.mocked(refreshSessionPullRequests).mockRejectedValueOnce(new Error("boom"));
    const store = usePullRequestStatusStore();
    expect(await store.refreshSession("s1")).toBeNull();
    expect(store.error).toContain("boom");
    expect(store.lookup).toBeNull();
    expect(store.isRefreshing("s1")).toBe(false);
  });

  it("never looks anything up from a pop-out or with the setting off", async () => {
    const store = usePullRequestStatusStore();
    useWindowRole().role.value = "viewer";
    expect(await store.refreshSession("s1")).toBeNull();
    await store.refreshList(["a"]);
    expect(store.notice).toBeNull();
    useWindowRole().role.value = "main";
    usePreferencesStore().pullRequestLookup = false;
    expect(await store.refreshSession("s1")).toBeNull();
    expect(refreshSessionPullRequests).not.toHaveBeenCalled();
    expect(refreshListPullRequests).not.toHaveBeenCalled();
    expect(store.notice).toBe("disabled");
  });

  it("forgets a lookup when the setting moves, and says nothing for ok or failed", async () => {
    vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(result({ lookup: "failed" }));
    const store = usePullRequestStatusStore();
    await store.refreshSession("s1");
    expect(store.notice).toBeNull();
    vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(result({ lookup: "notInstalled" }));
    await store.refreshSession("s1");
    expect(store.notice).toBe("notInstalled");
    const prefs = usePreferencesStore();
    prefs.pullRequestLookup = false;
    await nextTick();
    prefs.pullRequestLookup = true;
    await nextTick();
    expect(store.lookup).toBeNull();
    expect(store.notice).toBeNull();
  });
});

describe("useSessionPullRequestStatus", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
  });

  function target(sessionId: string | null = "s1") {
    return { sessionId, reloadPullRequests: vi.fn(async () => {}) };
  }

  it("reloads the session's pull requests when the lookup changed them", async () => {
    vi.mocked(refreshSessionPullRequests).mockResolvedValue(result({ updated: [ref(1, "open")] }));
    const detail = target();
    await useSessionPullRequestStatus(detail).refresh(true);
    expect(refreshSessionPullRequests).toHaveBeenCalledWith("s1", true);
    expect(detail.reloadPullRequests).toHaveBeenCalledTimes(1);
  });

  it("reloads when only a branch link changed, and not when nothing did", async () => {
    vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(result({ linksChanged: true }));
    const detail = target();
    const { refresh } = useSessionPullRequestStatus(detail);
    await refresh();
    expect(detail.reloadPullRequests).toHaveBeenCalledTimes(1);
    vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(result());
    await refresh();
    expect(detail.reloadPullRequests).toHaveBeenCalledTimes(1);
  });

  it("drops the answer when the session changed meanwhile", async () => {
    const pending = createDeferred<PullRequestRefreshResult>();
    vi.mocked(refreshSessionPullRequests).mockReturnValueOnce(pending.promise);
    const detail = target();
    const done = useSessionPullRequestStatus(detail).refresh();
    detail.sessionId = "s2";
    pending.resolve(result({ updated: [ref(1, "open")] }));
    await done;
    expect(detail.reloadPullRequests).not.toHaveBeenCalled();
  });

  it("skips a session that is no longer the one it was asked for", async () => {
    const detail = target("s2");
    await useSessionPullRequestStatus(detail).refresh(false, "s1");
    await useSessionPullRequestStatus(target(null)).refresh();
    expect(refreshSessionPullRequests).not.toHaveBeenCalled();
  });
});
