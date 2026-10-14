import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { runStorageKeyMigrations } from "@/config/storageKeysMigration";

describe("storage key registry", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("all values are unique", () => {
    const values = Object.values(STORAGE_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("all values share the `tracepilot` namespace prefix", () => {
    for (const value of Object.values(STORAGE_KEYS)) {
      expect(value.startsWith("tracepilot")).toBe(true);
    }
  });

  it("keeps session tab view choices under the dash-form key", () => {
    expect(STORAGE_KEYS.sessionTabViews).toBe("tracepilot-session-tab-views");
  });

  it("STORAGE_KEYS is frozen", () => {
    expect(Object.isFrozen(STORAGE_KEYS)).toBe(true);
  });

  it("migration runner does not throw on a fresh localStorage", () => {
    expect(() => runStorageKeyMigrations()).not.toThrow();
  });

  it("migration runner is idempotent", () => {
    localStorage.setItem(STORAGE_KEYS.theme, "dark");
    localStorage.setItem(STORAGE_KEYS.lastSession, "session-1");
    runStorageKeyMigrations();
    runStorageKeyMigrations();
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEYS.lastSession)).toBe("session-1");
  });

  it("keeps the analytics filter and export option keys stable", () => {
    expect(STORAGE_KEYS.analyticsFilters).toBe("tracepilot-analytics-filters");
    expect(STORAGE_KEYS.exportOptions).toBe("tracepilot-export-options");
  });
});
