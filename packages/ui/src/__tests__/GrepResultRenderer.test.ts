import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GrepResultRenderer from "../components/renderers/GrepResultRenderer.vue";

describe("GrepResultRenderer", () => {
  it("parses file:line:content format correctly", () => {
    const content = [
      "src/app.ts:10:const x = 1;",
      "src/app.ts:20:const y = 2;",
      "src/utils.ts:5:export function foo() {}",
    ].join("\n");

    const wrapper = mount(GrepResultRenderer, {
      props: {
        content,
        args: { pattern: "const", output_mode: "content" },
      },
    });

    expect(wrapper.text()).toContain("3 matches");
    expect(wrapper.text()).toContain("2 files");
    expect(wrapper.findAll(".grep-file-group")).toHaveLength(2);
  });

  it("renders files_with_matches mode as file list", () => {
    const content = "src/a.ts\nsrc/b.ts\nsrc/c.ts";

    const wrapper = mount(GrepResultRenderer, {
      props: {
        content,
        args: { pattern: "test", output_mode: "files_with_matches" },
      },
    });

    expect(wrapper.findAll(".grep-file-item")).toHaveLength(3);
  });

  it("handles Windows drive-letter paths correctly", () => {
    const content = "C:\\src\\file.ts:matched text here";

    const wrapper = mount(GrepResultRenderer, {
      props: {
        content,
        args: { pattern: "matched", output_mode: "content" },
      },
    });

    // The file path should be parsed correctly, not split on drive letter colon
    expect(wrapper.text()).toContain("C:\\src\\file.ts");
    expect(wrapper.text()).toContain("matched text here");
  });

  it("renders count mode with per-file counts and correct totals", () => {
    const content = [
      "src/app.ts:15",
      "src/utils.ts:8",
      "src/main.ts:3",
    ].join("\n");

    const wrapper = mount(GrepResultRenderer, {
      props: {
        content,
        args: { pattern: "test", output_mode: "count" },
      },
    });

    // Total should be 15+8+3=26, not 3 files
    expect(wrapper.text()).toContain("26 matches");
    expect(wrapper.text()).toContain("3 files");
    // Per-file counts should be visible
    expect(wrapper.text()).toContain("15");
    expect(wrapper.text()).toContain("8");
    expect(wrapper.text()).toContain("3");
  });

  it("handles empty content", () => {
    const wrapper = mount(GrepResultRenderer, {
      props: {
        content: "",
        args: { pattern: "test" },
      },
    });

    expect(wrapper.text()).toContain("0 matches");
  });
});
