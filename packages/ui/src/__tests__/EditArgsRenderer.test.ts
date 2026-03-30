import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EditArgsRenderer from "../components/renderers/EditArgsRenderer.vue";

describe("EditArgsRenderer", () => {
  it("shows file path", () => {
    const wrapper = mount(EditArgsRenderer, {
      props: {
        args: { path: "src/main.ts", old_str: "foo", new_str: "bar" },
      },
    });
    expect(wrapper.find(".edit-args-path").text()).toBe("src/main.ts");
  });

  it("shows old_str with 'Find' label", () => {
    const wrapper = mount(EditArgsRenderer, {
      props: {
        args: { path: "test.ts", old_str: "old code", new_str: "new code" },
      },
    });
    const labels = wrapper.findAll(".edit-args-label");
    expect(labels.some((l) => l.text() === "Find")).toBe(true);
    expect(wrapper.find(".edit-args-code--old").text()).toBe("old code");
  });

  it("shows new_str with 'Replace' label", () => {
    const wrapper = mount(EditArgsRenderer, {
      props: {
        args: { path: "test.ts", old_str: "old", new_str: "new code" },
      },
    });
    const labels = wrapper.findAll(".edit-args-label");
    expect(labels.some((l) => l.text() === "Replace")).toBe(true);
    expect(wrapper.find(".edit-args-code--new").text()).toBe("new code");
  });

  it("truncates long strings", () => {
    const longStr = "x".repeat(600);
    const wrapper = mount(EditArgsRenderer, {
      props: {
        args: { path: "test.ts", old_str: longStr, new_str: "short" },
      },
    });
    const oldText = wrapper.find(".edit-args-code--old").text();
    expect(oldText.length).toBeLessThan(600);
    expect(oldText).toContain("…");
  });
});
