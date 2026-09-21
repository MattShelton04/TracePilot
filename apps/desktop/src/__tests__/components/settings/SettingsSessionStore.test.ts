import type {
  EnrichmentRefreshResponse,
  SessionStoreStatusResponse,
  StoreAvailability,
  StoreSourceStatus,
} from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import SettingsSessionStore from "@/components/settings/SettingsSessionStore.vue";

const getSessionStoreStatus = vi.fn<() => Promise<SessionStoreStatusResponse>>();
const refreshSessionEnrichment = vi.fn<() => Promise<EnrichmentRefreshResponse>>();

const flags = reactive<Record<string, boolean>>({ sessionStoreEnrichment: true });
const toggleFeature = vi.fn((flag: string) => {
  flags[flag] = !flags[flag];
});

vi.mock("@tracepilot/client", () => ({
  getSessionStoreStatus: () => getSessionStoreStatus(),
  refreshSessionEnrichment: () => refreshSessionEnrichment(),
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    isFeatureEnabled: (flag: string) => flags[flag] === true,
    toggleFeature,
  }),
}));

function source(overrides: Partial<StoreSourceStatus> = {}): StoreSourceStatus {
  return {
    sourceId: "source-1",
    dbPath: "/home/user/.copilot/session-store.db",
    copilotHome: "/home/user/.copilot",
    generation: "gen-1",
    capabilityFingerprint: "fp",
    sourceSchemaVersion: 8,
    capabilities: ["requests", "workRefs"],
    availability: "ready",
    statusDetail: null,
    lastAttemptAt: "2026-09-20T10:14:52.317Z",
    lastSuccessAt: "2026-09-20T10:14:52.317Z",
    revision: 3,
    enrichmentVersion: 1,
    sessionsWithRequests: 18,
    totalRequests: 383,
    ...overrides,
  };
}

function statusFor(availability: StoreAvailability, overrides: Partial<StoreSourceStatus> = {}) {
  getSessionStoreStatus.mockResolvedValue({
    enabled: true,
    resolvedPath: "/home/user/.copilot/session-store.db",
    source: availability === "missing" ? null : source({ availability, ...overrides }),
  });
}

async function mountPanel() {
  const wrapper = mount(SettingsSessionStore);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  flags.sessionStoreEnrichment = true;
  getSessionStoreStatus.mockReset();
  refreshSessionEnrichment.mockReset();
  toggleFeature.mockClear();
  statusFor("ready");
  refreshSessionEnrichment.mockResolvedValue({
    availability: "ready",
    refreshed: 4,
    unchanged: 12,
    skipped: 1,
    detail: null,
  });
});

describe("SettingsSessionStore", () => {
  it("explains what the preference means and what switching it off removes", async () => {
    const wrapper = await mountPanel();

    const text = wrapper.text();
    expect(text).toMatch(/use this source when available/i);
    expect(text).toMatch(/a missing store never switches it off/i);
    expect(text).toMatch(/removes the cached enrichment/i);
    expect(text).toMatch(/session files are never modified/i);
    expect(
      wrapper
        .get('[role="switch"][aria-label="Use the Copilot session store when available"]')
        .attributes("aria-checked"),
    ).toBe("true");
  });

  it("applies the preference immediately so the purge promise is kept", async () => {
    const wrapper = await mountPanel();

    await wrapper
      .get('[role="switch"][aria-label="Use the Copilot session store when available"]')
      .trigger("click");
    await flushPromises();

    expect(toggleFeature).toHaveBeenCalledWith("sessionStoreEnrichment");
    expect(refreshSessionEnrichment).toHaveBeenCalledTimes(1);
    expect(flags.sessionStoreEnrichment).toBe(false);
    expect(wrapper.get(".store-availability-pill").text()).toBe("Off");
  });

  it("shows the resolved source, capabilities, last refresh and totals when ready", async () => {
    const wrapper = await mountPanel();

    expect(wrapper.get(".store-path").text()).toBe("/home/user/.copilot/session-store.db");
    expect(wrapper.get(".store-availability-pill").text()).toBe("Available");
    expect(wrapper.get(".store-capabilities").text()).toBe("Request detail, Linked work");
    expect(wrapper.get(".store-last-success").text()).not.toBe("Never");
    expect(wrapper.get(".store-totals").text()).toBe("383 requests across 18 sessions");
  });

  it("presents a missing store as informational, not as a failure", async () => {
    statusFor("missing");
    const wrapper = await mountPanel();

    expect(wrapper.get(".store-availability-pill").text()).toBe("Not installed");
    const text = wrapper.text();
    expect(text).toMatch(/versions before the store never create one/i);
    expect(text).toMatch(/setting stays on/i);
    expect(text).not.toMatch(/error|failed/i);
    // The path is still shown: it is where the store would be, not a claim it exists.
    expect(wrapper.get(".store-path").text()).toBe("/home/user/.copilot/session-store.db");
    expect(wrapper.get(".store-capabilities").text()).toBe("None reported");
    expect(wrapper.get(".store-last-success").text()).toBe("Never");
  });

  it("says a busy store keeps its cached data and will be retried", async () => {
    statusFor("busy", { statusDetail: "Locked by another reader" });
    const wrapper = await mountPanel();

    expect(wrapper.get(".store-availability-pill").text()).toBe("Busy");
    expect(wrapper.text()).toMatch(/cached enrichment is kept/i);
    expect(wrapper.text()).toContain("Locked by another reader");
  });

  it("reports the outcome of a manual retry and re-reads the status", async () => {
    const wrapper = await mountPanel();
    expect(getSessionStoreStatus).toHaveBeenCalledTimes(1);

    await wrapper.get(".store-retry-btn").trigger("click");
    await flushPromises();

    expect(refreshSessionEnrichment).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".store-refresh-result").text()).toBe(
      "4 refreshed, 12 unchanged, 1 skipped",
    );
    expect(getSessionStoreStatus).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed retry without clearing the panel", async () => {
    refreshSessionEnrichment.mockRejectedValueOnce(new Error("source locked"));
    const wrapper = await mountPanel();

    await wrapper.get(".store-retry-btn").trigger("click");
    await flushPromises();

    expect(wrapper.get(".store-refresh-result").text()).toContain("source locked");
    expect(wrapper.get(".store-path").text()).toBe("/home/user/.copilot/session-store.db");
  });
});
