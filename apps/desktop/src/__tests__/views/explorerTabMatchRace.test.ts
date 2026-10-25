import { createDeferred, type Deferred, setupPinia } from "@tracepilot/test-utils";
import type { SessionFileEntry, SessionFileSearchResponse } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import ExplorerTab from "../../views/tabs/ExplorerTab.vue";

const mocks = vi.hoisted(() => ({
  sessionListFiles: vi.fn(),
  sessionReadFile: vi.fn(),
  sessionSearchFiles: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    openInExplorer: vi.fn(),
    sessionListFiles: mocks.sessionListFiles,
    sessionReadFile: mocks.sessionReadFile,
    sessionSearchFiles: mocks.sessionSearchFiles,
  });
});

vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => ({ sessionId: "copilot-session" }),
}));

const LARGE = 2 * 1_024 * 1_024;
const entries: SessionFileEntry[] = [
  {
    path: "workspace.yaml",
    name: "workspace.yaml",
    sizeBytes: 40,
    isDirectory: false,
    fileType: "yaml",
  },
  {
    path: "events.jsonl",
    name: "events.jsonl",
    sizeBytes: LARGE,
    isDirectory: false,
    fileType: "jsonl",
  },
  // Large enough to offer "load more", but its match is inside the first chunk.
  { path: "plan.md", name: "plan.md", sizeBytes: LARGE, isDirectory: false, fileType: "markdown" },
];

const search: SessionFileSearchResponse = {
  matches: [
    { path: "events.jsonl", lineNumber: 40, excerpt: '{"cwd":"/synthetic/orchard"}' },
    { path: "plan.md", lineNumber: 2, excerpt: "cwd: /synthetic/orchard" },
  ],
  scannedFiles: 3,
  skippedFiles: 0,
  truncated: false,
};

const TreeStub = defineComponent({
  name: "FileBrowserTree",
  emits: ["contextmenu-entry", "view-file"],
  setup:
    (_props, { slots, emit }) =>
    () =>
      h("div", [
        h("button", {
          class: "tree-open-workspace",
          onClick: () => emit("view-file", "workspace.yaml"),
        }),
        slots["header-actions"]?.(),
        slots["after-header"]?.(),
      ]),
});

const ViewerStub = defineComponent({
  name: "FileContentViewer",
  props: {
    filePath: { type: String, default: undefined },
    searchRequestId: { type: Number, default: 0 },
    initialSearchLine: { type: Number, default: 0 },
  },
  setup: (props) => () =>
    h("div", {
      class: "viewer-stub",
      "data-path": props.filePath,
      "data-request": props.searchRequestId,
      "data-line": props.initialSearchLine,
    }),
});

/** Each read of a path waits on its own deferred, keyed `path` or `path:full`. */
let reads: Map<string, Deferred<string>>;

async function searchContent(query: string) {
  const wrapper = mount(ExplorerTab, {
    global: { stubs: { FileBrowserTree: TreeStub, FileContentViewer: ViewerStub } },
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

function viewer(wrapper: ReturnType<typeof mount>) {
  const el = wrapper.get(".viewer-stub").element as HTMLElement;
  return { path: el.dataset.path, request: el.dataset.request, line: el.dataset.line };
}

enableAutoUnmount(afterEach);

describe("ExplorerTab content-search match races", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    reads = new Map();
    mocks.sessionListFiles.mockResolvedValue({ root: "/synthetic/session", entries });
    mocks.sessionSearchFiles.mockResolvedValue(search);
    mocks.sessionReadFile.mockImplementation((_id: string, path: string, full: boolean) => {
      // The auto-opened workspace.yaml answers at once; every other read waits.
      if (path === "workspace.yaml") {
        return Promise.resolve("cwd: /synthetic/orchard\n");
      }
      const deferred = createDeferred<string>();
      reads.set(full ? `${path}:full` : path, deferred);
      return deferred.promise;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("jumps to the newer match's line when an older match's file read finishes last", async () => {
    const wrapper = await searchContent("cwd");
    const results = wrapper.findAll(".explorer-result");
    await results[0].trigger("click"); // events.jsonl L40
    await results[1].trigger("click"); // plan.md L2

    reads.get("plan.md")?.resolve("intro\ncwd: /synthetic/orchard\nend");
    await flushPromises();
    expect(viewer(wrapper)).toMatchObject({ path: "plan.md", line: "2" });
    const request = viewer(wrapper).request;

    reads.get("events.jsonl")?.resolve('{"cwd":"/synthetic/orchard"}');
    await flushPromises();
    reads.get("plan.md:full")?.resolve("intro\ncwd: /synthetic/orchard\nend");
    await flushPromises();

    // The older click neither re-aims the viewer nor loads the newer file in full.
    expect(viewer(wrapper)).toEqual({ path: "plan.md", request, line: "2" });
    expect(mocks.sessionReadFile).not.toHaveBeenCalledWith(
      "copilot-session",
      "plan.md",
      true,
      expect.anything(),
    );
  });

  it("leaves a file opened from the tree alone when an earlier match finishes late", async () => {
    const wrapper = await searchContent("cwd");
    const before = viewer(wrapper).request;
    await wrapper.findAll(".explorer-result")[0].trigger("click"); // events.jsonl L40
    // workspace.yaml was auto-opened, so it reopens from the cache at once.
    await wrapper.get(".tree-open-workspace").trigger("click");

    reads.get("events.jsonl")?.resolve('{"cwd":"/synthetic/orchard"}');
    await flushPromises();

    expect(viewer(wrapper)).toEqual({ path: "workspace.yaml", request: before, line: "0" });
  });

  it("still loads a large file in full to reach a match past its first chunk", async () => {
    const wrapper = await searchContent("cwd");
    await wrapper.findAll(".explorer-result")[0].trigger("click"); // events.jsonl L40
    reads.get("events.jsonl")?.resolve('{"cwd":"/synthetic/orchard"}');
    await flushPromises();
    expect(mocks.sessionReadFile).toHaveBeenCalledWith(
      "copilot-session",
      "events.jsonl",
      true,
      expect.anything(),
    );

    reads.get("events.jsonl:full")?.resolve(Array.from({ length: 50 }, () => "{}").join("\n"));
    await flushPromises();
    expect(viewer(wrapper)).toMatchObject({ path: "events.jsonl", line: "40" });
  });
});
