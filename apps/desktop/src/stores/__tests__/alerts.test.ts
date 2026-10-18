import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { useAlertsStore } from "../alerts";

describe("alerts store drawer", () => {
  beforeEach(() => {
    localStorage.clear();
    setupPinia();
  });

  it("closeDrawer closes an open drawer and leaves a closed one closed", () => {
    const store = useAlertsStore();
    store.toggleDrawer();
    expect(store.drawerOpen).toBe(true);

    store.closeDrawer();
    expect(store.drawerOpen).toBe(false);
    store.closeDrawer();
    expect(store.drawerOpen).toBe(false);
  });
});
