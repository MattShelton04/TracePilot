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
});
