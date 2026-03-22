import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { usePreferencesStore } from "../../stores/preferences";

describe("usePreferencesStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("initializes with dark theme by default", () => {
    const store = usePreferencesStore();
    expect(store.theme).toBe("dark");
  });

  it("initializes with no last viewed session", () => {
    const store = usePreferencesStore();
    expect(store.lastViewedSession).toBeNull();
  });

  it("can update theme", () => {
    const store = usePreferencesStore();
    store.theme = "light";
    expect(store.theme).toBe("light");
  });

  it("can set lastViewedSession", () => {
    const store = usePreferencesStore();
    store.lastViewedSession = "session-123";
    expect(store.lastViewedSession).toBe("session-123");
  });

  it("initializes contentMaxWidth with default (1200)", () => {
    const store = usePreferencesStore();
    expect(store.contentMaxWidth).toBe(1200);
  });

  it("initializes uiScale with default (1.0)", () => {
    const store = usePreferencesStore();
    expect(store.uiScale).toBe(1.0);
  });

  it("can update contentMaxWidth", () => {
    const store = usePreferencesStore();
    store.contentMaxWidth = 1600;
    expect(store.contentMaxWidth).toBe(1600);
  });

  it("can set contentMaxWidth to 0 for full width", () => {
    const store = usePreferencesStore();
    store.contentMaxWidth = 0;
    expect(store.contentMaxWidth).toBe(0);
  });

  it("can update uiScale", () => {
    const store = usePreferencesStore();
    store.uiScale = 1.2;
    expect(store.uiScale).toBe(1.2);
  });
});
