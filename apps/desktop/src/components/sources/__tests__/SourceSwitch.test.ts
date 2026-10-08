import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SourceSwitch from "../SourceSwitch.vue";

function render(modelValue: "copilot" | "claudeCode" | null = null) {
  return mount(SourceSwitch, {
    props: { modelValue, sources: ["copilot", "claudeCode"] },
    attachTo: document.body,
  });
}

describe("SourceSwitch", () => {
  it("names each option, logo included, and marks the selected source", () => {
    const wrapper = render("claudeCode");
    const options = wrapper.findAll('[role="radio"]');
    expect(options.map((o) => o.text())).toEqual(["All", "Copilot", "Claude"]);
    expect(options.map((o) => o.find("svg").exists())).toEqual([true, true, true]);
    expect(options[2].attributes("title")).toBe("Claude Code");
    expect(options[2].attributes("aria-checked")).toBe("true");
    expect(options[2].attributes("tabindex")).toBe("0");
    expect(options[0].attributes("tabindex")).toBe("-1");
    expect(wrapper.get('[role="radiogroup"]').attributes("data-active")).toBe("claudeCode");
    wrapper.unmount();
  });

  it("emits null for All and moves with the arrow, Home and End keys", async () => {
    const wrapper = render("copilot");
    const options = wrapper.findAll('[role="radio"]');
    await options[0].trigger("click");
    await options[1].trigger("keydown", { key: "ArrowRight" });
    await options[0].trigger("keydown", { key: "ArrowLeft" });
    await options[1].trigger("keydown", { key: "End" });
    await options[1].trigger("keydown", { key: "Home" });
    expect(wrapper.emitted("update:modelValue")).toEqual([
      [null],
      ["claudeCode"],
      ["claudeCode"],
      ["claudeCode"],
      [null],
    ]);
    wrapper.unmount();
  });
});
