import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import LucideIconPicker from "../components/LucideIconPicker.vue";

describe("LucideIconPicker", () => {
  it("renders trigger with placeholder icon when no value", () => {
    const w = mount(LucideIconPicker, {
      props: { modelValue: null },
      global: { stubs: { Teleport: true } },
    });
    const trigger = w.find(".lip__trigger");
    expect(trigger.exists()).toBe(true);
    expect(trigger.attributes("aria-expanded")).toBe("false");
  });

  it("opens modal when trigger clicked", async () => {
    const w = mount(LucideIconPicker, {
      props: { modelValue: null },
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    });
    await w.find(".lip__trigger").trigger("click");
    await nextTick();
    expect(w.find(".lip__picker").exists()).toBe(true);
    expect(w.find(".lip__grid").exists()).toBe(true);
    w.unmount();
  });

  it("filters tiles by query", async () => {
    const w = mount(LucideIconPicker, {
      props: { modelValue: null, catalogue: ["rocket", "bot", "compass"] },
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    });
    await w.find(".lip__trigger").trigger("click");
    await nextTick();
    const search = w.find(".lip__search");
    await search.setValue("ro");
    expect(w.findAll(".lip__tile").length).toBe(1);
    w.unmount();
  });

  it("emits update:modelValue when tile selected", async () => {
    const w = mount(LucideIconPicker, {
      props: { modelValue: null, catalogue: ["rocket", "bot"] },
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    });
    await w.find(".lip__trigger").trigger("click");
    await nextTick();
    await w.findAll(".lip__tile")[0].trigger("click");
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["rocket"]);
    w.unmount();
  });

  it("emits null when clear pressed", async () => {
    const w = mount(LucideIconPicker, {
      props: { modelValue: "rocket", catalogue: ["rocket", "bot"] },
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    });
    await w.find(".lip__trigger").trigger("click");
    await nextTick();
    await w.find(".lip__clear").trigger("click");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([null]);
    w.unmount();
  });
});
