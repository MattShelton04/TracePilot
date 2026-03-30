import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EditDiffRenderer from "../components/renderers/EditDiffRenderer.vue";

describe("EditDiffRenderer", () => {
  const baseArgs = { path: "/src/file.ts", old_str: "hello world", new_str: "hello universe" };

  it("renders a diff when old_str and new_str are provided", () => {
    const wrapper = mount(EditDiffRenderer, {
      props: {
        content: "File edited successfully",
        args: baseArgs,
      },
    });
    expect(wrapper.find(".edit-diff-body").exists()).toBe(true);
    // New line-based diff table
    expect(wrapper.find(".diff-table").exists()).toBe(true);
    const html = wrapper.html();
    expect(html).toContain("world");
    expect(html).toContain("universe");
  });

  it("shows delete-only view when new_str is missing", () => {
    const wrapper = mount(EditDiffRenderer, {
      props: {
        content: "File edited",
        args: { path: "/file.ts", old_str: "removed code" },
      },
    });
    // Delete view now uses diff-table with diff-line--removed rows
    expect(wrapper.find(".diff-line--removed").exists()).toBe(true);
    expect(wrapper.text()).toContain("removed code");
  });

  it("falls back to plain display when neither old_str nor new_str is provided", () => {
    const wrapper = mount(EditDiffRenderer, {
      props: {
        content: "Some result",
        args: { path: "/file.ts" },
      },
    });
    expect(wrapper.find(".diff-table").exists()).toBe(false);
    expect(wrapper.find(".edit-diff-fallback").exists()).toBe(true);
  });

  it("falls back to simple blocks for very large inputs", () => {
    // Create multiline input that exceeds line-level LCS threshold (100K)
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i} content here`);
    const largeOld = lines.join("\n");
    const largeNew = lines.map((l, i) => `changed ${i} content here`).join("\n");

    const wrapper = mount(EditDiffRenderer, {
      props: {
        content: "File edited",
        args: { path: "/file.ts", old_str: largeOld, new_str: largeNew },
      },
    });

    // Should still render without crashing
    expect(wrapper.find(".edit-diff-body").exists()).toBe(true);
    // Line-based diff should show removed and added lines
    const removedLines = wrapper.findAll(".diff-line--removed");
    const addedLines = wrapper.findAll(".diff-line--added");
    expect(removedLines.length).toBeGreaterThan(0);
    expect(addedLines.length).toBeGreaterThan(0);
  });

  it("supports unified and split diff modes", async () => {
    const wrapper = mount(EditDiffRenderer, {
      props: {
        content: "File edited",
        args: baseArgs,
      },
    });
    // Default is unified
    const tabs = wrapper.findAll(".edit-diff-tab");
    expect(tabs.length).toBe(2);
    expect(tabs[0].text()).toBe("Unified");
    expect(tabs[1].text()).toBe("Split");
    // Click split
    await tabs[1].trigger("click");
    expect(wrapper.find(".diff-split").exists()).toBe(true);
  });

  it("shows Modified badge", () => {
    const wrapper = mount(EditDiffRenderer, {
      props: {
        content: "File edited",
        args: baseArgs,
      },
    });
    expect(wrapper.find(".edit-diff-badge--modified").exists()).toBe(true);
    expect(wrapper.text()).toContain("Modified");
  });

  it("handles truncated content with load-full event", () => {
    const wrapper = mount(EditDiffRenderer, {
      props: {
        content: "partial...",
        args: baseArgs,
        isTruncated: true,
      },
    });
    expect(wrapper.text()).toContain("Output was truncated");
  });
});
