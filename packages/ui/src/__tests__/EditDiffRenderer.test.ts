import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
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
    expect(wrapper.find(".edit-diff-inline").exists()).toBe(true);
    // Should show removed and added segments
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
    expect(wrapper.find(".edit-diff-deleted").exists()).toBe(true);
    expect(wrapper.text()).toContain("removed code");
  });

  it("falls back to plain display when neither old_str nor new_str is provided", () => {
    const wrapper = mount(EditDiffRenderer, {
      props: {
        content: "Some result",
        args: { path: "/file.ts" },
      },
    });
    expect(wrapper.find(".edit-diff-inline").exists()).toBe(false);
    expect(wrapper.find(".edit-diff-deleted").exists()).toBe(false);
    expect(wrapper.find(".edit-diff-fallback").exists()).toBe(true);
  });

  it("falls back to simple blocks for very large inputs", () => {
    // Create inputs large enough to exceed MAX_DIFF_COMPLEXITY (4M)
    const largeOld = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(" ");
    const largeNew = Array.from({ length: 3000 }, (_, i) => `changed${i}`).join(" ");

    const wrapper = mount(EditDiffRenderer, {
      props: {
        content: "File edited",
        args: { path: "/file.ts", old_str: largeOld, new_str: largeNew },
      },
    });

    // Should still render without crashing
    expect(wrapper.find(".edit-diff-body").exists()).toBe(true);
    // Falls back to simple removed/added blocks (whole old text removed, whole new text added)
    const removedSegments = wrapper.findAll(".diff-removed");
    const addedSegments = wrapper.findAll(".diff-added");
    expect(removedSegments.length).toBeGreaterThan(0);
    expect(addedSegments.length).toBeGreaterThan(0);
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
