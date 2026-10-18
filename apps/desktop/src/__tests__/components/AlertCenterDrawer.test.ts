import { setupPinia } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AlertCenterDrawer from "@/components/chrome/AlertCenterDrawer.vue";
import { useAlertsStore } from "@/stores/alerts";

enableAutoUnmount(afterEach);
beforeEach(() => {
  setupPinia();
  document.body.innerHTML = "";
});

describe("AlertCenterDrawer shortcut", () => {
  it("toggles with Ctrl+Shift+A while focus is in a text field or native select", async () => {
    const field = document.createElement("input");
    const select = document.createElement("select");
    select.append(new Option("All Repos"));
    document.body.append(field, select);
    mount(AlertCenterDrawer, { attachTo: document.body });
    const alerts = useAlertsStore();

    for (const target of [field, select]) {
      target.focus();
      const event = new KeyboardEvent("keydown", {
        key: "A",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      await flushPromises();
      expect(event.defaultPrevented).toBe(true);
      expect(alerts.drawerOpen).toBe(true);
      alerts.drawerOpen = false;
      await flushPromises();
    }
  });
});
