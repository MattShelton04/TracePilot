import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { useAnalyticsStore } from "@/stores/analytics";
import { usePreferencesStore } from "@/stores/preferences";
import * as client from "@tracepilot/client";

vi.mock("@tracepilot/client", () => ({
  getAnalytics: vi.fn(),
  getToolAnalysis: vi.fn(),
  getCodeImpact: vi.fn(),
  listSessions: vi.fn(), // Mocked for available repos
}));

describe("stores/analytics", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(client.getAnalytics).mockResolvedValue({} as any);
    vi.mocked(client.getToolAnalysis).mockResolvedValue({} as any);
    vi.mocked(client.getCodeImpact).mockResolvedValue({} as any);
  });

  it("clears cache and re-fetches when hideEmptySessions preference changes", async () => {
    const analyticsStore = useAnalyticsStore();
    const prefsStore = usePreferencesStore();
    prefsStore.hideEmptySessions = false; // Reset preference

    // Initial fetch
    await analyticsStore.fetchAnalytics();
    expect(client.getAnalytics).toHaveBeenCalledTimes(1);
    expect(client.getAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ hideEmpty: false }),
    );

    vi.clearAllMocks();

    // Change preference
    prefsStore.hideEmptySessions = true;
    // Wait for the watcher to trigger
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should have re-fetched all analytics data
    expect(client.getAnalytics).toHaveBeenCalledTimes(1);
    expect(client.getAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ hideEmpty: true }),
    );
    expect(client.getToolAnalysis).toHaveBeenCalledTimes(1);
    expect(client.getToolAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ hideEmpty: true }),
    );
    expect(client.getCodeImpact).toHaveBeenCalledTimes(1);
    expect(client.getCodeImpact).toHaveBeenCalledWith(
      expect.objectContaining({ hideEmpty: true }),
    );
  });
});
