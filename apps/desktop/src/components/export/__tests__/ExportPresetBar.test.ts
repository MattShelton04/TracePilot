import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ExportPresetBar from "../ExportPresetBar.vue";

describe("ExportPresetBar", () => {
  it("emits apply when a preset button is clicked", async () => {
    const presets = [
      { id: "p1", label: "P1", icon: "📦", description: "", format: "json", sections: [] },
    ];
    const wrapper = mount(ExportPresetBar, {
      props: { allPresets: presets as never, customPresets: [], activePreset: null },
    });
    await wrapper.find(".preset-btn").trigger("click");
    expect(wrapper.emitted("apply")?.[0]).toEqual(["p1"]);
    wrapper.unmount();
  });

  it("gives a custom preset a separate, named delete button", async () => {
    const custom = {
      id: "custom-1",
      label: "Share",
      icon: "⭐",
      description: "Custom preset: Share",
      format: "markdown",
      sections: [],
    };
    const wrapper = mount(ExportPresetBar, {
      props: {
        allPresets: [custom] as never,
        customPresets: [custom] as never,
        activePreset: null,
      },
      attachTo: document.body,
    });
    const del = wrapper.find<HTMLButtonElement>('button[aria-label="Delete preset Share"]');
    expect(del.exists()).toBe(true);
    // Not nested inside the apply button, so Tab reaches it on its own.
    expect(del.element.parentElement?.closest("button")).toBeNull();
    del.element.focus();
    expect(document.activeElement).toBe(del.element);

    await del.trigger("click");
    expect(wrapper.emitted("delete")?.[0]).toEqual(["custom-1"]);
    expect(wrapper.emitted("apply")).toBeUndefined();

    await wrapper.find(".preset-custom-apply").trigger("click");
    expect(wrapper.emitted("apply")?.[0]).toEqual(["custom-1"]);
    wrapper.unmount();
  });

  it("emits save with trimmed preset name", async () => {
    const wrapper = mount(ExportPresetBar, {
      props: { allPresets: [], customPresets: [], activePreset: null },
    });
    await wrapper.find(".preset-save-btn").trigger("click");
    const input = wrapper.find<HTMLInputElement>(".save-preset-input");
    await input.setValue("  My Preset  ");
    await wrapper.find(".btn-primary").trigger("click");
    expect(wrapper.emitted("save")?.[0]).toEqual(["My Preset"]);
    wrapper.unmount();
  });
});
