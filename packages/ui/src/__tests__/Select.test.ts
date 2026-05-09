import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Select from "../components/Select.vue";

const opts = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
  { value: "c", label: "Cherry", disabled: true },
];

describe("Select", () => {
  it("renders options and current value", () => {
    const w = mount(Select, { props: { modelValue: "a", options: opts } });
    const optionEls = w.findAll("option");
    expect(optionEls.length).toBe(3);
    expect((w.element as HTMLSelectElement).value).toBe("a");
  });

  it("emits update:modelValue on change", async () => {
    const w = mount(Select, { props: { modelValue: "a", options: opts } });
    await w.setValue("b");
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["b"]);
  });

  it("renders placeholder as disabled first option", () => {
    const w = mount(Select, {
      props: { modelValue: "", options: opts, placeholder: "Pick…" },
    });
    const first = w.findAll("option")[0];
    expect(first.text()).toBe("Pick…");
    expect(first.attributes("disabled")).toBeDefined();
  });

  it("applies size class", () => {
    const w = mount(Select, { props: { modelValue: "a", options: opts, size: "sm" } });
    expect(w.classes()).toContain("tp-select--sm");
  });

  it("respects disabled option", () => {
    const w = mount(Select, { props: { modelValue: "a", options: opts } });
    const cherry = w.findAll("option").find((o) => o.attributes("value") === "c");
    expect(cherry?.attributes("disabled")).toBeDefined();
  });
});
