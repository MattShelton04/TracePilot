import { setupPinia } from "@tracepilot/test-utils";
import type { PullRequestState, SessionPullRequest } from "@tracepilot/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, type Ref, ref } from "vue";
import { makePullRequest } from "@/__tests__/utils/pullRequestFixtures";
import {
  SESSION_POLL_INTERVAL_MS,
  sessionPollDue,
  useSessionPullRequestPoll,
} from "@/composables/useSessionPullRequestPoll";
import { useWindowRole } from "@/composables/useWindowRole";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../__tests__/mocks/client");
  return createClientMock();
});

function pr(number: number, state: PullRequestState | null): SessionPullRequest {
  return makePullRequest(number, ["created"], {
    status: state ? ({ state } as SessionPullRequest["status"]) : null,
  });
}

describe("sessionPollDue", () => {
  it("is due while any pull request may still change", () => {
    expect(sessionPollDue([pr(1, "merged"), pr(2, "open")])).toBe(true);
    expect(sessionPollDue([pr(1, "draft")])).toBe(true);
    expect(sessionPollDue([pr(1, null)])).toBe(true);
    expect(sessionPollDue([pr(1, "merged"), pr(2, "closed")])).toBe(false);
    expect(sessionPollDue([])).toBe(false);
  });
});

describe("useSessionPullRequestPoll", () => {
  let sessionId: Ref<string | null>;
  let pullRequests: Ref<SessionPullRequest[]>;
  let active: Ref<boolean>;
  let refresh: ReturnType<typeof vi.fn<() => Promise<null>>>;
  let scope: ReturnType<typeof effectScope>;
  let hidden = false;

  function start() {
    scope = effectScope();
    scope.run(() =>
      useSessionPullRequestPoll({
        sessionId: () => sessionId.value,
        pullRequests: () => pullRequests.value,
        active: () => active.value,
        refresh,
      }),
    );
  }

  beforeEach(() => {
    setupPinia();
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    sessionId = ref("s1");
    pullRequests = ref([pr(1, "open")]);
    active = ref(true);
    refresh = vi.fn(async () => null);
  });

  afterEach(() => {
    scope?.stop();
    useWindowRole().role.value = "main";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks a minute after the open, then once a minute", async () => {
    start();
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("stops once every pull request is merged or closed, and restarts on reopen", async () => {
    start();
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    pullRequests.value = [pr(1, "merged")];
    await nextTick();
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(1);
    pullRequests.value = [pr(1, "open")];
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("asks nothing for a session with no pull requests", async () => {
    pullRequests.value = [];
    start();
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("pauses in the background and resumes on focus once a minute has passed", async () => {
    start();
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("waits while the detail is off screen", async () => {
    active.value = false;
    start();
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
    active.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("starts the minute again for another session", async () => {
    start();
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS - 10_000);
    sessionId.value = "s2";
    await nextTick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS - 10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never asks from a pop-out or with the setting off, and stops when disposed", async () => {
    useWindowRole().role.value = "viewer";
    start();
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 2);
    scope.stop();
    useWindowRole().role.value = "main";
    usePreferencesStore().pullRequestLookup = false;
    start();
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();

    scope.stop();
    usePreferencesStore().pullRequestLookup = true;
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
  });
});
