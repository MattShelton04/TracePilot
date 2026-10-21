import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MetricsCodeChanges from "../MetricsCodeChanges.vue";

const names = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('[role="treeitem"] .changes__name').map((node) => node.text());

describe("MetricsCodeChanges", () => {
  it("shows changed files as a tree relative to the repository", async () => {
    const wrapper = mount(MetricsCodeChanges, {
      props: {
        metrics: {
          codeChanges: {
            filesModified: [
              "C:\\repo\\src\\b.ts",
              "C:\\repo\\src\\a.ts",
              "C:\\repo\\README.md",
              "C:\\repo\\docs\\guide\\intro.md",
            ],
            linesAdded: 1200,
            linesRemoved: 30,
          },
        },
        roots: ["C:\\repo"],
      },
    });
    expect(wrapper.text()).toContain("+1,200");
    expect(wrapper.text()).toContain("−30");
    expect(wrapper.text()).toContain("4 files");
    // Folders first, single-child chains compacted, then files.
    expect(names(wrapper)).toEqual([
      "docs/guide/",
      "intro.md",
      "src/",
      "a.ts",
      "b.ts",
      "README.md",
    ]);
    await wrapper.get('button[role="treeitem"]').trigger("click");
    expect(names(wrapper)).toEqual(["docs/guide/", "src/", "a.ts", "b.ts", "README.md"]);
    await wrapper.get("input").setValue("intro");
    expect(names(wrapper)).toEqual(["docs/guide/", "intro.md"]);
    expect(wrapper.text()).toContain("1 of 4 files");
    await wrapper.get("input").setValue("absent");
    expect(wrapper.text()).toContain("No files match this path.");
  });

  it("counts a file recorded under several spellings once", async () => {
    const wrapper = mount(MetricsCodeChanges, {
      props: {
        metrics: {
          codeChanges: {
            filesModified: [
              "C:\\git\\repo\\src\\a.ts",
              "C:/git/repo/src/a.ts",
              "c:\\git\\repo\\src\\a.ts",
              "C:\\git\\repo\\src\\b.ts",
            ],
            linesAdded: 3,
          },
        },
        roots: ["C:\\git\\repo"],
      },
    });
    expect(names(wrapper)).toEqual(["src/", "a.ts", "b.ts"]);
    expect(wrapper.text()).toContain("2 files");
    await wrapper.get("input").setValue("a.ts");
    expect(wrapper.text()).toContain("1 of 2 files");
  });

  it("opens only the top level of a long tree and bounds the rows", async () => {
    const files = Array.from({ length: 3000 }, (_, i) => `src/module-${i % 30}/file-${i}.ts`);
    const wrapper = mount(MetricsCodeChanges, {
      props: { metrics: { codeChanges: { filesModified: files, linesAdded: 9000 } } },
    });
    // `src` is open; its 30 folders are not.
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(31);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Expand all")
      ?.trigger("click");
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(200);
    const more = wrapper.findAll("button").find((button) => button.text().startsWith("Show"));
    expect(more?.text()).toBe("Show 2,831 more rows");
    await wrapper.get("input").setValue("file-2999.ts");
    expect(names(wrapper)).toEqual(["src/module-29/", "file-2999.ts"]);
  });

  it("keeps the user's open and closed folders across a refresh", async () => {
    const metrics = (filesModified: string[]) => ({
      codeChanges: { filesModified, linesAdded: 10, linesRemoved: 2 },
    });
    const wrapper = mount(MetricsCodeChanges, {
      props: {
        metrics: metrics(["/repo/src/b.ts", "/repo/src/a.ts", "/repo/README.md"]),
        roots: ["/repo"],
      },
    });
    await wrapper.get('button[role="treeitem"]').trigger("click");
    expect(names(wrapper)).toEqual(["src/", "README.md"]);
    // A refresh replaces the metrics snapshot and the roots array, same content.
    await wrapper.setProps({
      metrics: metrics(["/repo/src/b.ts", "/repo/src/a.ts", "/repo/README.md"]),
      roots: ["/repo"],
    });
    expect(names(wrapper)).toEqual(["src/", "README.md"]);
    // A folder that first appears in a refresh still opens by default.
    await wrapper.setProps({
      metrics: metrics(["/repo/src/b.ts", "/repo/src/a.ts", "/repo/README.md", "/repo/docs/c.md"]),
    });
    expect(names(wrapper)).toEqual(["docs/", "c.md", "src/", "README.md"]);
  });

  it("says when only line counts were recorded", () => {
    const wrapper = mount(MetricsCodeChanges, {
      props: { metrics: { codeChanges: { filesModified: [], linesAdded: 5, linesRemoved: 1 } } },
    });
    expect(wrapper.text()).toContain("No file list recorded");
    expect(wrapper.find("input").exists()).toBe(false);
  });
});
