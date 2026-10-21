import { refreshSessionPullRequests } from "@tracepilot/client";
import type { SessionPullRequest } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { makePullRequest } from "@/__tests__/utils/pullRequestFixtures";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { SESSION_POLL_INTERVAL_MS } from "@/composables/useSessionPullRequestPoll";
import { useWindowRole } from "@/composables/useWindowRole";
import { usePreferencesStore } from "@/stores/preferences";
import { createStore, mountPanel } from "./sessionDetailPanelFixtures";

// The panel asks GitHub about the session's pull requests per open, per
// manual refresh and on its poll, in the main window only.
const mocks = vi.hoisted(() => ({ getSessionLiveness: vi.fn() }));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({ getSessionLiveness: mocks.getSessionLiveness });
});

const changed = {
  lookup: "ok" as const,
  updated: [
    {
      host: "github.com",
      owner: "example",
      repo: "orchard",
      number: 1,
      url: "https://github.com/example/orchard/pull/1",
      state: "open" as const,
    },
  ],
  linksChanged: false,
};

function detailStore(): SessionDetailContext {
  const store = reactive(createStore()) as SessionDetailContext;
  vi.mocked(store.loadDetail).mockImplementation(async (id: string) => {
    store.sessionId = id;
  });
  return store;
}

describe("SessionDetailPanel pull request status", () => {
  let pinia: Pinia;
  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    mocks.getSessionLiveness.mockResolvedValue({ state: "idle" });
    vi.mocked(refreshSessionPullRequests).mockResolvedValue(changed);
    await flushPromises();
  });
  afterEach(() => {
    useWindowRole().role.value = "main";
  });

  it("looks the session up once it opens, then reloads what changed", async () => {
    const store = detailStore();
    mountPanel(pinia, store);
    await flushPromises();
    expect(store.loadPullRequests).toHaveBeenCalledTimes(1);
    expect(refreshSessionPullRequests).toHaveBeenCalledTimes(1);
    expect(refreshSessionPullRequests).toHaveBeenCalledWith("session-1", false);
    expect(store.reloadPullRequests).toHaveBeenCalledTimes(1);
  });

  it("asks again for another session and on a manual refresh", async () => {
    const store = detailStore();
    const wrapper = mountPanel(pinia, store);
    await flushPromises();
    await wrapper.setProps({ sessionId: "session-2" });
    await flushPromises();
    expect(refreshSessionPullRequests).toHaveBeenLastCalledWith("session-2", false);

    await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();
    await flushPromises();
    expect(refreshSessionPullRequests).toHaveBeenCalledTimes(3);
    expect(refreshSessionPullRequests).toHaveBeenLastCalledWith("session-2", false);
  });

  it("asks again each minute while an open pull request is on screen", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    try {
      const store = detailStore();
      store.pullRequests = [
        makePullRequest(1, ["created"], {
          status: { state: "open" } as NonNullable<SessionPullRequest["status"]>,
        }),
      ];
      const wrapper = mountPanel(pinia, store, { refreshEnabled: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshSessionPullRequests).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS);
      expect(refreshSessionPullRequests).toHaveBeenCalledTimes(2);
      expect(refreshSessionPullRequests).toHaveBeenLastCalledWith("session-1", false);

      // Off screen (another tab in front), it waits.
      await wrapper.setProps({ refreshEnabled: false });
      await vi.advanceTimersByTimeAsync(SESSION_POLL_INTERVAL_MS * 3);
      expect(refreshSessionPullRequests).toHaveBeenCalledTimes(2);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("never asks from a pop-out or with the setting off", async () => {
    useWindowRole().role.value = "viewer";
    mountPanel(pinia, detailStore());
    await flushPromises();
    useWindowRole().role.value = "main";
    usePreferencesStore(pinia).pullRequestLookup = false;
    mountPanel(pinia, detailStore());
    await flushPromises();
    expect(refreshSessionPullRequests).not.toHaveBeenCalled();
  });
});
