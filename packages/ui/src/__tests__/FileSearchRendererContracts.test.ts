import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApplyPatchRenderer from "../components/renderers/ApplyPatchRenderer.vue";
import CodeBlock from "../components/renderers/CodeBlock.vue";
import CreateFileRenderer from "../components/renderers/CreateFileRenderer.vue";
import EditDiffRenderer from "../components/renderers/EditDiffRenderer.vue";
import GlobTreeRenderer from "../components/renderers/GlobTreeRenderer.vue";
import GrepResultRenderer from "../components/renderers/GrepResultRenderer.vue";
import ViewCodeRenderer from "../components/renderers/ViewCodeRenderer.vue";
import { normalizeViewedSource } from "../utils/toolFileContent";
import { normalizeGlobPaths, parseSearchResults } from "../utils/toolSearchResults";

afterEach(() => vi.unstubAllGlobals());
const failed: TurnToolCall = { toolName: "edit", isComplete: true, success: false };

describe("file result contracts", () => {
  it("shows the CLI line numbers once and preserves the real range start", () => {
    const wrapper = mount(ViewCodeRenderer, {
      props: {
        content: "41. const a = 1;\r\n42. const b = 2;",
        args: { path: "src/app.ts", view_range: [41, 42] },
      },
    });
    expect(wrapper.findAll(".code-line-number").map((line) => line.text())).toEqual(["41", "42"]);
    expect(wrapper.findAll(".code-line-content pre").map((line) => line.text())).toEqual([
      "const a = 1;",
      "const b = 2;",
    ]);
    expect(normalizeViewedSource("1. one\n3. three").code).toBe("1. one\n3. three");
  });

  it("keeps extensionless file content as source and rejects invalid ranges", () => {
    const wrapper = mount(ViewCodeRenderer, {
      props: {
        content: "export VALUE=1",
        args: { path: "/project/LICENSE", view_range: [-4, "bad"] },
      },
    });
    expect(wrapper.find(".code-block").exists()).toBe(true);
    expect(wrapper.find(".code-line-number").text()).toBe("1");
  });

  it("preserves failed edit/create feedback beside the proposed source", () => {
    const edit = mount(EditDiffRenderer, {
      props: {
        tc: failed,
        content: "Replacement was not applied",
        args: { old_str: "old", new_str: "new" },
      },
    });
    expect(edit.find(".rs--error").exists()).toBe(true);
    expect(edit.text()).toContain("Proposed change");
    expect(edit.text()).toContain("Replacement was not applied");
    const create = mount(CreateFileRenderer, {
      props: {
        tc: { ...failed, toolName: "create" },
        content: "File already exists",
        args: { path: "a.ts", file_text: "proposed" },
      },
    });
    expect(create.text()).toContain("Proposed file");
    expect(create.text()).toContain("File already exists");
    expect(create.text()).toContain("proposed");
  });

  it("represents an empty replacement as removals without a phantom added row", () => {
    const wrapper = mount(EditDiffRenderer, {
      props: { content: "Applied", args: { old_str: "one\ntwo\n", new_str: "" } },
    });
    expect(wrapper.findAll(".diff-line--removed")).toHaveLength(2);
    expect(wrapper.findAll(".diff-line--added")).toHaveLength(0);
    expect(wrapper.text()).toContain("Removed text");
  });

  it("shows an empty submitted file with zero lines", () => {
    const wrapper = mount(CreateFileRenderer, {
      props: { content: "Created", args: { file_text: "" } },
    });
    expect(wrapper.text()).toContain("0 lines");
    expect(wrapper.findAll(".code-line")).toHaveLength(0);
    expect(wrapper.text()).toContain("Empty file");
  });

  it("retains patch failure text and uses proposed operation labels before success", async () => {
    const patch = "*** Begin Patch\n*** Update File: a.ts\n@@ context\n-old\n+new\n*** End Patch";
    const wrapper = mount(ApplyPatchRenderer, {
      props: {
        content: "Context did not match",
        args: {},
        tc: { ...failed, toolName: "apply_patch", arguments: patch },
      },
    });
    expect(wrapper.text()).toContain("Context did not match");
    expect(wrapper.text()).toContain("Proposed update");
    expect(wrapper.find(".patch-line--hunk").text()).toBe("@@ context");
    await wrapper.get(".patch-raw-toggle").trigger("click");
    expect(wrapper.get(".patch-raw-toggle").attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(".patch-raw").text()).toContain("*** Begin Patch");
  });
});

describe("bounded complete code access", () => {
  it("pages every long patch row without losing its final changes", async () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      ...Array.from({ length: 501 }, (_, i) => `+line ${i + 1}`),
      "*** End Patch",
    ].join("\n");
    const wrapper = mount(ApplyPatchRenderer, {
      props: {
        content: "Applied",
        args: {},
        tc: { toolName: "apply_patch", isComplete: true, arguments: patch },
      },
    });
    expect(wrapper.findAll(".patch-line")).toHaveLength(500);
    await wrapper.get(".patch-pager button:last-child").trigger("click");
    expect(wrapper.findAll(".patch-line")).toHaveLength(1);
    expect(wrapper.find(".patch-line").text()).toContain("line 501");
    await wrapper.get(".patch-pager button:first-of-type").trigger("click");
    expect(wrapper.find(".patch-line").text()).toContain("line 1");
  });

  it("allows manual navigation after centering a search result", async () => {
    const wrapper = mount(CodeBlock, {
      props: {
        code: Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n"),
        maxLines: 10,
        searchQuery: "line 80",
        activeSearchLine: 80,
        activeSearchColumn: 0,
      },
    });
    expect(wrapper.find('[data-line-number="80"]').exists()).toBe(true);
    await wrapper.get(".code-block-collapsed button:nth-of-type(3)").trigger("click");
    expect(wrapper.find('[data-line-number="81"]').exists()).toBe(true);
    expect(wrapper.find('[data-line-number="80"]').exists()).toBe(false);
    await wrapper.get(".code-block-collapsed button:nth-of-type(1)").trigger("click");
    expect(wrapper.find('[data-line-number="1"]').exists()).toBe(true);
  });

  it("offers every long-line character and full copy without tokenizing it all", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const source = `${"x".repeat(1000)}END`;
    const wrapper = mount(CodeBlock, { props: { code: source, maxLineCharacters: 1000 } });
    expect(wrapper.get("pre").text()).toHaveLength(1000);
    await wrapper.get('[aria-label="Next characters in line 1"]').trigger("click");
    expect(wrapper.get("pre").text()).toBe("END");
    await wrapper.get(".code-line-controls button:last-child").trigger("click");
    expect(writeText).toHaveBeenCalledWith(source);
    expect(wrapper.find(".code-copy-state").text()).toBe("Line 1 copied");
  });
});

describe("search result integrity", () => {
  it("only highlights literal text with the requested case semantics", async () => {
    const wrapper = mount(GrepResultRenderer, {
      props: { content: "a.ts:1:Match match", args: { pattern: "Match", output_mode: "content" } },
    });
    expect(wrapper.findAll(".grep-highlight")).toHaveLength(1);
    await wrapper.setProps({ args: { pattern: "Match", output_mode: "content", "-i": true } });
    expect(wrapper.findAll(".grep-highlight")).toHaveLength(2);
  });

  it("parses root-level counts and context while preserving unknown output", () => {
    expect(
      parseSearchResults("app.ts:3\r\nconstructor:4", "count").matches.map((row) => row.text),
    ).toEqual(["3", "4"]);
    const parsed = parseSearchResults(
      "app.ts-2-context\napp.ts:3:match\nNote: search limited",
      "content",
    );
    expect(parsed.matches[0]).toMatchObject({ file: "app.ts", isContext: true, lineNum: 2 });
    expect(parsed.notices).toEqual(["Note: search limited"]);
  });

  it("handles prototype-like filenames, complete long matches and regex patterns safely", () => {
    const wrapper = mount(GrepResultRenderer, {
      props: {
        args: { pattern: "(a+)+$", output_mode: "content" },
        content: `constructor:1:${"a".repeat(1000)}TAIL\n__proto__:2:more`,
      },
    });
    expect(wrapper.findAll(".grep-file-group")).toHaveLength(2);
    expect(wrapper.find(".grep-line-text").text()).toContain("TAIL");
    expect(wrapper.find(".grep-highlight").exists()).toBe(false);
  });

  it("keeps empty messages out of filenames and counts files rather than imaginary matches", () => {
    const wrapper = mount(GrepResultRenderer, {
      props: { args: {}, content: "No matches found." },
    });
    expect(wrapper.findAll(".grep-file-item")).toHaveLength(0);
    expect(wrapper.text()).toContain("No matches found");
    expect(wrapper.text()).toContain("0 matching files");
  });

  it("normalizes CRLF and duplicates without stripping a partial root prefix", () => {
    expect(
      normalizeGlobPaths("/repo/a.ts\r\n/repo/a.ts\n/repo-old/b.ts\nNo files found.", "/repo"),
    ).toEqual({ paths: ["a.ts", "/repo-old/b.ts"], notices: [] });
    expect(normalizeGlobPaths("C:\\Repo\\src\\a.ts\nC:/Repo/src/a.ts", "c:/repo").paths).toEqual([
      "src/a.ts",
    ]);
  });

  it("uses keyboard-accessible native folder disclosures and retains file paths", async () => {
    const wrapper = mount(GlobTreeRenderer, {
      props: { content: "/repo/src/app.ts\n/repo/src/nested/test.ts", args: { path: "/repo" } },
    });
    const folder = wrapper.get("button.glob-dir");
    expect(folder.attributes("aria-expanded")).toBe("true");
    expect(wrapper.findAll(".glob-file")).toHaveLength(2);
    await folder.trigger("click");
    expect(folder.attributes("aria-expanded")).toBe("false");
    expect(wrapper.findAll(".glob-file")).toHaveLength(0);
    await folder.trigger("click");
    expect(wrapper.get(".glob-file").attributes("title")).toContain("src/");
  });
});
