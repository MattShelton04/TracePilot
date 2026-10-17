// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import "./setup";
import { STORAGE_KEYS } from "../../../config/storageKeys";
import { readAnalyticsFilters } from "../../../composables/usePersistedAnalyticsFilters";
import { useAnalyticsStore } from "../../../stores/analytics";
import { useSessionsStore } from "../../../stores/sessions";

function session(repository: string, source: SessionListItem["source"]): SessionListItem {
  return { id: `${repository}-${source}`, repository, source } as SessionListItem;
}

/** A fresh Pinia, as after an app restart; localStorage survives. */
function restart() {
  setupPinia();
  return useAnalyticsStore();
}

describe("analytics filter persistence", () => {
  it("restores the repository, source and custom range after a restart", async () => {
    const store = useAnalyticsStore();
    store.setRepo("org/app");
    store.setSource("claudeCode");
    store.setTimeRange("custom", "2026-01-01", "2026-02-01");
    await nextTick();

    const restored = restart();

    expect(restored.selectedRepo).toBe("org/app");
    expect(restored.selectedSource).toBe("claudeCode");
    expect(restored.selectedTimeRange).toBe("custom");
    expect(restored.dateRange).toEqual({ fromDate: "2026-01-01", toDate: "2026-02-01" });
  });

  it("keeps the custom bounds while a preset range is selected", async () => {
    const store = useAnalyticsStore();
    store.setTimeRange("custom", "2026-01-01", undefined);
    store.setTimeRange("30d");
    await nextTick();

    const restored = restart();

    expect(restored.selectedTimeRange).toBe("30d");
    expect(restored.customFromDate).toBe("2026-01-01");
  });

  it("falls back to defaults for unreadable or invalid stored filters", () => {
    localStorage.setItem(STORAGE_KEYS.analyticsFilters, "{not json");
    const broken = restart();
    expect(broken.selectedTimeRange).toBe("all");
    expect(broken.selectedRepo).toBeNull();

    expect(
      readAnalyticsFilters(
        JSON.stringify({ repo: 5, source: "codex", range: "1y", fromDate: "soon", toDate: 7 }),
      ),
    ).toEqual({ repo: null, source: null, range: "all", fromDate: undefined, toDate: undefined });
    expect(
      readAnalyticsFilters(
        JSON.stringify({ range: "custom", fromDate: "2026-03-01", toDate: "2026-02-01" }),
      ),
    ).toMatchObject({ range: "all", fromDate: undefined, toDate: undefined });
  });

  it("keeps a remembered repository until the session list is known, then drops a missing one", () => {
    localStorage.setItem(
      STORAGE_KEYS.analyticsFilters,
      JSON.stringify({ repo: "org/gone", source: "claudeCode", range: "7d" }),
    );
    const store = restart();
    expect(store.selectedRepo).toBe("org/gone");
    expect(store.selectedSource).toBe("claudeCode");

    useSessionsStore().sessions = [session("org/app", "claudeCode")];

    expect(store.selectedRepo).toBeNull();
    expect(store.selectedSource).toBe("claudeCode");
    expect(store.selectedTimeRange).toBe("7d");
  });

  it("keeps a remembered folder-only project once the session list loads", () => {
    localStorage.setItem(
      STORAGE_KEYS.analyticsFilters,
      JSON.stringify({ repo: "project:harbor", range: "7d" }),
    );
    const store = restart();

    useSessionsStore().sessions = [
      { id: "harbor", cwd: "C:\\synthetic\\harbor", source: "claudeCode" } as SessionListItem,
    ];

    expect(store.selectedRepo).toBe("project:harbor");
  });

  it("checks a remembered source at once when the session list is already loaded", () => {
    localStorage.setItem(
      STORAGE_KEYS.analyticsFilters,
      JSON.stringify({ repo: "org/app", source: "claudeCode" }),
    );
    setupPinia();
    useSessionsStore().sessions = [session("org/app", "copilot")];

    const store = useAnalyticsStore();

    expect(store.selectedRepo).toBe("org/app");
    expect(store.selectedSource).toBeNull();
  });

  it("$reset returns the filters to defaults and forgets them", async () => {
    const store = useAnalyticsStore();
    store.setRepo("org/app");
    store.setTimeRange("90d");
    await nextTick();

    store.$reset();
    await nextTick();

    const restored = restart();
    expect(restored.selectedRepo).toBeNull();
    expect(restored.selectedTimeRange).toBe("all");
  });
});
