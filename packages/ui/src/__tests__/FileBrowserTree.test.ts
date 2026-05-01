import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { FileBrowserEntry } from "../components/FileBrowserTree.vue";
import FileBrowserTree from "../components/FileBrowserTree.vue";

const rootEntries: FileBrowserEntry[] = [
  { path: "events.jsonl", name: "events.jsonl", sizeBytes: 1024, isDirectory: false },
  { path: "workspace.yaml", name: "workspace.yaml", sizeBytes: 256, isDirectory: false },
  { path: "session.db", name: "session.db", sizeBytes: 4096, isDirectory: false },
];

const nestedEntries: FileBrowserEntry[] = [
  { path: "files", name: "files", sizeBytes: 0, isDirectory: true },
  { path: "files/plan.md", name: "plan.md", sizeBytes: 800, isDirectory: false },
  { path: "files/notes.md", name: "notes.md", sizeBytes: 300, isDirectory: false },
  { path: "events.jsonl", name: "events.jsonl", sizeBytes: 512, isDirectory: false },
];

const deeplyNestedEntries: FileBrowserEntry[] = [
  { path: "folder", name: "folder", sizeBytes: 0, isDirectory: true },
  { path: "folder/folder2", name: "folder2", sizeBytes: 0, isDirectory: true },
  { path: "file.txt", name: "file.txt", sizeBytes: 128, isDirectory: false },
  { path: "folder/abc.txt", name: "abc.txt", sizeBytes: 256, isDirectory: false },
  { path: "folder/folder2/xyz.txt", name: "xyz.txt", sizeBytes: 512, isDirectory: false },
];

describe("FileBrowserTree", () => {
  it("renders loading state", () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: [], loading: true },
    });
    expect(wrapper.text()).toContain("Loading files");
  });

  it("renders empty state when no entries", () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: [], loading: false },
    });
    expect(wrapper.text()).toContain("No files");
  });

  it("renders root-level files", () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: rootEntries },
    });
    expect(wrapper.text()).toContain("events.jsonl");
    expect(wrapper.text()).toContain("workspace.yaml");
    expect(wrapper.text()).toContain("session.db");
  });

  it("shows file count in title", () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: rootEntries },
    });
    // 3 files → count badge shows "3"
    expect(wrapper.text()).toContain("3");
  });

  it("uses custom title when provided", () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: [], title: "Session Files" },
    });
    expect(wrapper.text()).toContain("Session Files");
  });

  it("emits viewFile with path when a file is clicked", async () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: rootEntries },
    });

    const items = wrapper.findAll(".fb-tree__item");
    await items[0].trigger("click");

    expect(wrapper.emitted("viewFile")).toBeTruthy();
    expect(wrapper.emitted("viewFile")![0]).toEqual(["events.jsonl"]);
  });

  it("renders folder and nested files", () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: nestedEntries },
    });

    expect(wrapper.text()).toContain("files");
    // Files under folder should be visible initially (folder starts expanded)
    expect(wrapper.text()).toContain("plan.md");
    expect(wrapper.text()).toContain("notes.md");
  });

  it("renders nested folders under their parent instead of as top-level path groups", () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: deeplyNestedEntries },
    });

    const folderRows = wrapper.findAll(".fb-tree__folder");
    expect(folderRows.map((row) => row.find(".fb-tree__folder-name").text())).toEqual([
      "folder",
      "folder2",
    ]);
    expect(folderRows.map((row) => row.attributes("data-depth"))).toEqual(["0", "1"]);

    const fileRows = wrapper.findAll(".fb-tree__item");
    expect(fileRows.map((row) => row.find(".fb-tree__name").text())).toEqual([
      "file.txt",
      "abc.txt",
      "xyz.txt",
    ]);
    expect(fileRows.map((row) => row.attributes("data-depth"))).toEqual(["0", "1", "2"]);
  });

  it("toggles folder collapse on click", async () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: nestedEntries },
    });

    // Initially expanded — nested items visible
    expect(wrapper.text()).toContain("plan.md");

    // Click folder to collapse
    const folderBtn = wrapper.find(".fb-tree__folder");
    await folderBtn.trigger("click");

    // Nested items should no longer be visible
    expect(wrapper.text()).not.toContain("plan.md");
    expect(wrapper.text()).not.toContain("notes.md");

    // Click again to expand
    await folderBtn.trigger("click");
    expect(wrapper.text()).toContain("plan.md");
  });

  it("highlights selected file", () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: rootEntries, selectedPath: "workspace.yaml" },
    });

    const items = wrapper.findAll(".fb-tree__item");
    const selected = items.find((item) => item.text().includes("workspace.yaml"));
    expect(selected?.classes()).toContain("fb-tree__item--selected");
  });

  it("formats file sizes correctly", () => {
    const wrapper = mount(FileBrowserTree, {
      props: {
        entries: [
          { path: "small.txt", name: "small.txt", sizeBytes: 500, isDirectory: false },
          { path: "medium.json", name: "medium.json", sizeBytes: 2048, isDirectory: false },
          { path: "large.jsonl", name: "large.jsonl", sizeBytes: 1_100_000, isDirectory: false },
        ],
      },
    });

    expect(wrapper.text()).toContain("500 B");
    expect(wrapper.text()).toContain("2.0 KB");
    expect(wrapper.text()).toContain("1.0 MB");
  });

  it("emits viewFile on Enter key press", async () => {
    const wrapper = mount(FileBrowserTree, {
      props: { entries: rootEntries },
    });

    const items = wrapper.findAll(".fb-tree__item");
    await items[0].trigger("keyup.enter");

    expect(wrapper.emitted("viewFile")).toBeTruthy();
    expect(wrapper.emitted("viewFile")![0]).toEqual(["events.jsonl"]);
  });
});
