import { flushPromises } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HIDDEN_LIVENESS_POLL_MS } from "@/composables/useVisibleAutoRefresh";
import { usePreferencesStore } from "@/stores/preferences";
import { mountPanel } from "./sessionDetailPanelFixtures";

// The running state a panel reports to its session tab's live dot, while the
// tab is in the background and when a running check fails.
const mocks = vi.hoisted(() => ({
  getSessionLiveness: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({ getSessionLiveness: mocks.getSessionLiveness });
});

const RUNNING = { state: "running", pid: 7, status: null };

describe("SessionDetailPanel running state for its tab", () => {
  let pinia: Pinia;
  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    // Config hydration must finish first; auto-refresh stays off throughout.
    await usePreferencesStore(pinia).whenReady;
    await flushPromises();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const lastEmitted = (wrapper: ReturnType<typeof mountPanel>) =>
    wrapper.emitted("update:isActive")?.at(-1);

  it("clears a background tab's live state once its session ends", async () => {
    mocks.getSessionLiveness.mockResolvedValue(RUNNING);
    const wrapper = mountPanel(pinia, undefined, { refreshEnabled: false });
    await flushPromises();
    expect(lastEmitted(wrapper)).toEqual([true]);

    mocks.getSessionLiveness.mockResolvedValue({ state: "idle" });
    await vi.advanceTimersByTimeAsync(HIDDEN_LIVENESS_POLL_MS);
    expect(lastEmitted(wrapper)).toEqual([false]);

    // Once idle, the hidden tab stops asking.
    const calls = mocks.getSessionLiveness.mock.calls.length;
    await vi.advanceTimersByTimeAsync(HIDDEN_LIVENESS_POLL_MS * 4);
    expect(mocks.getSessionLiveness).toHaveBeenCalledTimes(calls);
    wrapper.unmount();
  });

  it("never re-checks an idle session while its tab is in the background", async () => {
    mocks.getSessionLiveness.mockResolvedValue({ state: "idle" });
    const wrapper = mountPanel(pinia, undefined, { refreshEnabled: false });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(HIDDEN_LIVENESS_POLL_MS * 10);

    expect(mocks.getSessionLiveness).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("leaves a shown tab's running checks to its refreshing", async () => {
    mocks.getSessionLiveness.mockResolvedValue(RUNNING);
    const wrapper = mountPanel(pinia, undefined, { refreshEnabled: true });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(HIDDEN_LIVENESS_POLL_MS * 4);

    // A running Copilot session with auto-refresh off: only the mount checked.
    expect(mocks.getSessionLiveness).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("reports a session whose running check fails as no longer live", async () => {
    mocks.getSessionLiveness.mockResolvedValue(RUNNING);
    const wrapper = mountPanel(pinia, undefined, { refreshEnabled: true });
    await flushPromises();
    expect(lastEmitted(wrapper)).toEqual([true]);

    mocks.getSessionLiveness.mockRejectedValue(new Error("lock file unreadable"));
    await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();
    await flushPromises();

    expect(wrapper.find(".active-badge-inline").exists()).toBe(false);
    expect(lastEmitted(wrapper)).toEqual([false]);
    wrapper.unmount();
  });
});
