import { flushPromises } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionDetailInstance,
  type SessionDetailContext,
  toSessionDetailContext,
} from "@/composables/useSessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { createStore, mountPanel } from "./sessionDetailPanelFixtures";

// A failed first load of the session's detail: the panel shows no header or
// Refresh button, so its error alert must offer the way back.
const mocks = vi.hoisted(() => ({
  getSessionLiveness: vi.fn(),
  getSessionDetail: vi.fn(),
  checkSessionFreshness: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSessionLiveness: mocks.getSessionLiveness,
    getSessionDetail: mocks.getSessionDetail,
    checkSessionFreshness: mocks.checkSessionFreshness,
  });
});

const DETAIL = { ...createStore().detail!, summary: "Recovered Session" };
const NOT_FOUND = { code: "CORE", message: "Session not found: session-1" };

describe("SessionDetailPanel failed first load", () => {
  // See SessionDetailPanelRefresh.test.ts for why every mount names its pinia.
  let pinia: Pinia;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    mocks.getSessionLiveness.mockResolvedValue({ state: "idle" });
    mocks.checkSessionFreshness.mockResolvedValue({ sourceVersion: "v1" });
  });

  function realStore(): SessionDetailContext {
    return toSessionDetailContext(createSessionDetailInstance());
  }

  it("retries from the error alert and shows the session once it loads", async () => {
    mocks.getSessionDetail
      .mockRejectedValueOnce(new Error("The process cannot access the file"))
      .mockResolvedValue(DETAIL);
    const wrapper = mountPanel(pinia, realStore());
    await flushPromises();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.text()).toContain("The process cannot access the file");
    const retry = alert.findAll("button").find((b) => b.text() === "Retry");
    expect(retry).toBeDefined();

    await retry!.trigger("click");
    await flushPromises();

    expect(mocks.getSessionDetail).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Recovered Session");
  });

  it("says a missing session's files are gone, and finds it again on retry", async () => {
    mocks.getSessionDetail.mockRejectedValueOnce(NOT_FOUND).mockResolvedValue(DETAIL);
    mocks.getSessionLiveness.mockRejectedValueOnce(NOT_FOUND);
    const wrapper = mountPanel(pinia, realStore());
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain(
      "This session's files no longer exist.",
    );
    await wrapper.find('[role="alert"] button').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Recovered Session");
  });

  it("auto-refresh retries a failed first load without hiding the error meanwhile", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const prefs = usePreferencesStore(pinia);
      await flushPromises(); // let config hydration finish before overriding it
      prefs.autoRefreshEnabled = true;
      prefs.autoRefreshIntervalSeconds = 5;
      let resolveRetry!: (value: typeof DETAIL) => void;
      mocks.getSessionDetail
        .mockRejectedValueOnce(new Error("Failed to read events.jsonl"))
        .mockImplementationOnce(() => new Promise((resolve) => (resolveRetry = resolve)));
      const wrapper = mountPanel(pinia, realStore(), { refreshEnabled: true });
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(mocks.getSessionDetail).toHaveBeenCalledTimes(2);
      // The silent retry leaves the error up until it knows the answer.
      expect(wrapper.find('[role="alert"]').text()).toContain("Failed to read events.jsonl");

      resolveRetry(DETAIL);
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("Recovered Session");
    } finally {
      vi.useRealTimers();
    }
  });
});
