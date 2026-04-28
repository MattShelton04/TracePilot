import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ApplyPatchRenderer from "../components/renderers/ApplyPatchRenderer.vue";

function makeTc(argumentsValue: unknown): TurnToolCall {
  return {
    toolName: "apply_patch",
    arguments: argumentsValue,
    isComplete: true,
  };
}

describe("ApplyPatchRenderer", () => {
  it("renders update patches as explicit diff lines", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/app.ts",
      "@@",
      "-const oldValue = 1;",
      "+const newValue = 2;",
      " const keep = true;",
      "*** End Patch",
    ].join("\n");

    const wrapper = mount(ApplyPatchRenderer, {
      props: {
        content: "Done",
        args: {},
        tc: makeTc(patch),
      },
    });

    expect(wrapper.text()).toContain("src/app.ts");
    expect(wrapper.text()).toContain("Updated");
    expect(wrapper.text()).toContain("+1");
    expect(wrapper.text()).toContain("-1");
    expect(wrapper.find(".patch-line--added").text()).toContain("const newValue = 2;");
    expect(wrapper.find(".patch-line--removed").text()).toContain("const oldValue = 1;");
  });

  it("renders add-file patches with stripped plus prefixes", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export const answer = 42;",
      "+console.log(answer);",
      "*** End Patch",
    ].join("\n");

    const wrapper = mount(ApplyPatchRenderer, {
      props: {
        content: "Done",
        args: {},
        tc: makeTc(patch),
      },
    });

    expect(wrapper.text()).toContain("Added");
    expect(wrapper.text()).toContain("src/new.ts");
    expect(wrapper.text()).toContain("export const answer = 42;");
    expect(wrapper.text()).not.toContain("+export const answer");
  });

  it("renders multiple file cards from a single patch", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      "-a",
      "+b",
      "*** Delete File: src/dead.ts",
      "*** End Patch",
    ].join("\n");

    const wrapper = mount(ApplyPatchRenderer, {
      props: {
        content: "Done",
        args: {},
        tc: makeTc(patch),
      },
    });

    expect(wrapper.text()).toContain("2 files");
    expect(wrapper.findAll(".patch-file-card")).toHaveLength(2);
    expect(wrapper.text()).toContain("This patch deletes");
  });

  it("falls back when no patch string is available", () => {
    const wrapper = mount(ApplyPatchRenderer, {
      props: {
        content: "Applied patch",
        args: {},
        tc: makeTc({}),
      },
    });

    expect(wrapper.find(".patch-fallback").exists()).toBe(true);
    expect(wrapper.text()).toContain("Applied patch");
  });
});
