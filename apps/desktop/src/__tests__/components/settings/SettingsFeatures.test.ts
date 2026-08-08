import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import SettingsAlerts from "@/components/settings/SettingsAlerts.vue";
import SettingsExperimental from "@/components/settings/SettingsExperimental.vue";
import SettingsGeneral from "@/components/settings/SettingsGeneral.vue";
import SettingsToolVisualization from "@/components/settings/SettingsToolVisualization.vue";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock();
});

vi.mock("@/composables/useAlertDispatcher", () => ({
  dispatchTestAlert: vi.fn(),
}));

enableAutoUnmount(afterEach);

function tooltipTexts(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('[data-tp-component="Tooltip"]').flatMap((trigger) => {
    const id = trigger.attributes("aria-describedby");
    const text = id ? document.getElementById(id)?.textContent : undefined;
    return text ? [text] : [];
  });
}

describe("settings feature groups", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("shows recommended and experimental features in the requested order", async () => {
    const wrapper = mount(SettingsExperimental);
    await flushPromises();

    const groups = wrapper.findAll(".feature-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.find(".feature-group-title").text()).toBe("Recommended");
    expect(groups[0]!.findAll(".setting-label").map((label) => label.text())).toEqual([
      "Skills",
      "Export",
      "Exact Context Capture",
    ]);
    expect(groups[1]!.find(".feature-group-title").text()).toBe("Experimental");
    expect(groups[1]!.findAll(".setting-label").map((label) => label.text())).toEqual([
      "MCP Servers",
      "Session Replay",
      "Copilot SDK Bridge",
      "Config Injector",
    ]);
  });

  it("explains the experimental stability risk and defaults MCP and Config Injector off", async () => {
    const wrapper = mount(SettingsExperimental);
    await flushPromises();

    const tooltips = tooltipTexts(wrapper);
    expect(tooltips).toContain("Stable features that extend TracePilot.");
    expect(tooltips).toContain("Experimental features are likely to be buggy or unstable.");
    expect(
      wrapper.get('[role="switch"][aria-label="MCP Servers"]').attributes("aria-checked"),
    ).toBe("false");
    expect(
      wrapper.get('[role="switch"][aria-label="Config Injector"]').attributes("aria-checked"),
    ).toBe("false");
  });

  it("gives Alerts & Notifications the same experimental disclaimer", async () => {
    const wrapper = mount(SettingsAlerts);
    await flushPromises();

    expect(wrapper.get(".feature-group-title").text()).toBe("Experimental");
    expect(tooltipTexts(wrapper)).toContain(
      "Experimental features are likely to be buggy or unstable.",
    );
    expect(wrapper.find(".alerts-experimental-panel").exists()).toBe(true);
  });
});

describe("recent sessions setting", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("shows Reset before the count without a sessions unit label", async () => {
    const wrapper = mount(SettingsGeneral);
    await flushPromises();

    const preferences = usePreferencesStore();
    preferences.sessionCacheSize += 1;
    await nextTick();

    const controls = wrapper
      .findAll(".setting-control-group")
      .find((group) => group.find('input[aria-label="Recent sessions kept ready"]').exists());
    expect(controls).toBeDefined();
    expect(controls!.text()).toBe("Reset");
    expect(controls!.element.children[0]?.textContent?.trim()).toBe("Reset");
    expect(controls!.element.children[1]?.tagName).toBe("INPUT");
  });
});

describe("rich tool rendering settings", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("keeps per-tool overrides collapsed until requested", async () => {
    const wrapper = mount(SettingsToolVisualization);
    await flushPromises();

    const details = wrapper.get("details.tool-overrides");
    expect(details.attributes("open")).toBeUndefined();
    expect(wrapper.find(".tool-viz-grid").exists()).toBe(false);
    expect(wrapper.get(".tool-overrides-count").text()).toBe("Using defaults");

    (details.element as HTMLDetailsElement).open = true;
    await details.trigger("toggle");

    expect(wrapper.find(".tool-viz-grid").exists()).toBe(true);
  });

  it("summarizes customized overrides while collapsed", async () => {
    const wrapper = mount(SettingsToolVisualization);
    await flushPromises();

    const preferences = usePreferencesStore();
    preferences.setToolRenderingOverride("view", false);
    await nextTick();

    expect(wrapper.get(".tool-overrides-count").text()).toBe("1 customized");
  });
});
