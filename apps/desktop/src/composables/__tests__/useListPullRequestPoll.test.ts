import { refreshListPullRequests } from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import type { PullRequestState, SessionListItem } from "@tracepilot/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, type Ref, ref } from "vue";
import {
  LIST_POLL_INTERVAL_MS,
  LIST_POLL_MAX_SESSIONS,
  listPollCandidates,
  useListPullRequestPoll,
} from "@/composables/useListPullRequestPoll";
import { useWindowRole } from "@/composables/useWindowRole";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../__tests__/mocks/client");
  return createClientMock();
});

function item(id: string, state: PullRequestState | null | "none"): SessionListItem {
  return {
    id,
    eventCount: 1,
    turnCount: 1,
    linkedPullRequests:
      state === "none"
        ? null
        : {
            count: 1,
            primary: {
              host: "github.com",
              owner: "example",
              repo: "orchard",
              number: id.length,
              url: "https://github.com/example/orchard/pull/1",
              state,
            },
          },
  } as SessionListItem;
}

describe("listPollCandidates", () => {
  it("names sessions whose primary pull request may still change, in order", () => {
    expect(
      listPollCandidates([
        item("a", "open"),
        item("b", "merged"),
        item("c", null),
        item("d", "closed"),
        item("e", "draft"),
        item("f", "none"),
      ]),
    ).toEqual(["a", "c", "e"]);
  });

  it("caps how many one lookup names", () => {
    const many = Array.from({ length: LIST_POLL_MAX_SESSIONS + 20 }, (_, i) => item(`s${i}`, null));
    const ids = listPollCandidates(many);
    expect(ids).toHaveLength(LIST_POLL_MAX_SESSIONS);
    expect(ids[0]).toBe("s0");
  });
});

describe("useListPullRequestPoll", () => {
  let sessions: Ref<SessionListItem[]>;
  let scope: ReturnType<typeof effectScope>;
  let hidden = false;

  function start() {
    scope = effectScope();
    scope.run(() => useListPullRequestPoll(() => sessions.value));
  }

  beforeEach(() => {
    setupPinia();
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    sessions = ref([item("a", "open"), item("b", "merged"), item("c", null)]);
  });

  afterEach(() => {
    scope?.stop();
    useWindowRole().role.value = "main";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks at once, then at most once a minute", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(1);
    expect(refreshListPullRequests).toHaveBeenLastCalledWith(["a", "c"]);

    // The list changing re-arms the timer but doesn't ask early.
    sessions.value = [...sessions.value, item("d", "open")];
    await nextTick();
    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS - 1_000);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(2);
    expect(refreshListPullRequests).toHaveBeenLastCalledWith(["a", "c", "d"]);

    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS * 3);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(5);
  });

  it("pauses while the window is in the background and resumes on focus", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS * 5);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(1);

    // A minute has passed: coming back asks at once.
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(2);

    // Back again within the minute: it waits for the minute.
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(10_000);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS - 10_000);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(3);

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS * 2);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(3);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(4);
  });

  it("doesn't start while the window has no focus", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    start();
    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS * 2);
    expect(refreshListPullRequests).not.toHaveBeenCalled();
  });

  it("stops when unmounted", async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    scope.stop();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS * 3);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(1);
  });

  it("asks nothing with no open pull requests, and starts when one appears", async () => {
    sessions.value = [item("b", "merged"), item("f", "none")];
    start();
    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS * 2);
    expect(refreshListPullRequests).not.toHaveBeenCalled();
    sessions.value = [item("a", null)];
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshListPullRequests).toHaveBeenCalledWith(["a"]);
  });

  it("runs only in the main window, with the setting on", async () => {
    useWindowRole().role.value = "viewer";
    start();
    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS * 2);
    scope.stop();
    useWindowRole().role.value = "main";
    usePreferencesStore().pullRequestLookup = false;
    start();
    await vi.advanceTimersByTimeAsync(LIST_POLL_INTERVAL_MS * 2);
    expect(refreshListPullRequests).not.toHaveBeenCalled();

    // Turning it on starts the poll.
    usePreferencesStore().pullRequestLookup = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshListPullRequests).toHaveBeenCalledTimes(1);
  });
});
