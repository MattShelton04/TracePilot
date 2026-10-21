import { refreshSessionPullRequests } from "@tracepilot/client";
import { flushPromises } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { useWindowRole } from "@/composables/useWindowRole";
import { usePreferencesStore } from "@/stores/preferences";
import { createStore, mountPanel } from "./sessionDetailPanelFixtures";

// The panel asks GitHub about the session's pull requests once per open and
// per manual refresh, in the main window only.
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
