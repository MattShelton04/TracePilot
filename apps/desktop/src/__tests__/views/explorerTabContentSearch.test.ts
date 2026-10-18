import { setupPinia } from "@tracepilot/test-utils";
import type { SessionFileEntry, SessionFileSearchResponse } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import ExplorerTab from "../../views/tabs/ExplorerTab.vue";

const mocks = vi.hoisted(() => ({
  sessionListFiles: vi.fn(),
  sessionSearchFiles: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    openInExplorer: vi.fn(),
    sessionListFiles: mocks.sessionListFiles,
    sessionReadFile: vi.fn().mockResolvedValue(""),
    sessionSearchFiles: mocks.sessionSearchFiles,
  });
});

vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => ({ sessionId: "copilot-session" }),
}));

const entries: SessionFileEntry[] = [
  {
    path: "events.jsonl",
    name: "events.jsonl",
    sizeBytes: 90,
    isDirectory: false,
    fileType: "jsonl",
  },
  {
    path: "workspace.yaml",
    name: "workspace.yaml",
    sizeBytes: 40,
    isDirectory: false,
    fileType: "yaml",
  },
  { path: "plan.md", name: "plan.md", sizeBytes: 20, isDirectory: false, fileType: "markdown" },
];

/** Renders the tree's title and the slots the tab fills. */
const TreeStub = defineComponent({
  name: "FileBrowserTree",
  props: { title: { type: String, default: "" }, entries: { type: Array, default: () => [] } },
  emits: ["contextmenu-entry", "view-file"],
  setup:
    (props, { slots }) =>
    () =>
      h("div", [
        h("h4", { class: "tree-title" }, props.title),
        slots["header-actions"]?.(),
        slots["after-header"]?.(),
      ]),
});

async function searchContent(query: string) {
  const wrapper = mount(ExplorerTab, {
    global: { stubs: { FileBrowserTree: TreeStub, FileContentViewer: true } },
  });
  await flushPromises();
  await wrapper.get('[aria-label="Search files"]').trigger("click");
  await wrapper
    .findAll('[role="radio"]')
    .find((b) => b.text() === "Content")
    ?.trigger("click");
  await wrapper.get('input[aria-label="Search file contents"]').setValue(query);
  await vi.advanceTimersByTimeAsync(400);
  await flushPromises();
  return wrapper;
}

enableAutoUnmount(afterEach);

describe("ExplorerTab content search summary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    mocks.sessionListFiles.mockResolvedValue({ root: "/synthetic/session", entries });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("doesn't title every file a match, and counts matches, files and searched files apart", async () => {
    mocks.sessionSearchFiles.mockResolvedValue({
      matches: [{ path: "workspace.yaml", lineNumber: 4, excerpt: "cwd: /synthetic/orchard" }],
      scannedFiles: 2,
      skippedFiles: 1,
      truncated: false,
    } satisfies SessionFileSearchResponse);
    const wrapper = await searchContent("cwd");

    expect(mocks.sessionSearchFiles).toHaveBeenCalled();
    // The list isn't filtered by content, so it isn't "Matching Files".
    expect(wrapper.get(".tree-title").text()).toBe("Session Files");
    expect(wrapper.get(".explorer-results__meta").text()).toBe(
      "1 match in 1 file · 2 files searched",
    );
  });

  it("pluralises several matches across files", async () => {
    mocks.sessionSearchFiles.mockResolvedValue({
      matches: [
        { path: "workspace.yaml", lineNumber: 4, excerpt: "cwd: a" },
        { path: "workspace.yaml", lineNumber: 6, excerpt: "cwd: b" },
        { path: "plan.md", lineNumber: 1, excerpt: "cwd: c" },
      ],
      scannedFiles: 3,
      skippedFiles: 1,
      truncated: true,
    } satisfies SessionFileSearchResponse);
    const wrapper = await searchContent("cwd");
    expect(wrapper.get(".explorer-results__meta").text()).toBe(
      "3 matches in 2 files · 3 files searched · bounded results",
    );
  });

  it("still titles a name filter's results as matching files", async () => {
    const wrapper = mount(ExplorerTab, {
      global: { stubs: { FileBrowserTree: TreeStub, FileContentViewer: true } },
    });
    await flushPromises();
    await wrapper.get('[aria-label="Search files"]').trigger("click");
    await wrapper.get('input[aria-label="Filter file names and paths"]').setValue("yaml");
    expect(wrapper.get(".tree-title").text()).toBe("Matching Files");
  });
});
