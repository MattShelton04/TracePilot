import { setupPinia } from "@tracepilot/test-utils";
import type { SessionFileEntry } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import ExplorerTab from "../../views/tabs/ExplorerTab.vue";

const mocks = vi.hoisted(() => ({
  sessionListFiles: vi.fn(),
  sessionReadFile: vi.fn(),
  copy: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    openInExplorer: vi.fn(),
    sessionListFiles: mocks.sessionListFiles,
    sessionReadFile: mocks.sessionReadFile,
    sessionSearchFiles: vi.fn(),
  });
});

vi.mock("@tracepilot/ui", async (original) => {
  const module = await original<typeof import("@tracepilot/ui")>();
  return {
    ...module,
    useClipboard: () => ({ ...module.useClipboard(), copy: mocks.copy }),
    useToast: () => ({
      ...module.useToast(),
      success: mocks.toastSuccess,
      warning: mocks.toastWarning,
      error: mocks.toastError,
    }),
  };
});

vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => ({ sessionId: "claude-session" }),
}));

const CLAUDE_ROOT = "/home/user/.claude/projects/-work-app/claude-session";
const SCRATCHPAD = "/tmp/claude-1000/-work-app/claude-session/scratchpad";
const notes: SessionFileEntry = {
  path: "notes.md",
  name: "notes.md",
  sizeBytes: 64,
  isDirectory: false,
  fileType: "markdown",
};
const bigLog: SessionFileEntry = {
  path: "big.log",
  name: "big.log",
  sizeBytes: 40 * 1024 * 1024,
  isDirectory: false,
  fileType: "text",
};

// Mirrors the backend: each area has its own files, and a read is capped at
// 1 MiB unless `full` asks for the larger 16 MiB limit.
const PREVIEW_CAP = 1024 * 1024;
const FULL_CAP = 16 * 1024 * 1024;
const footer = (cap: number) => `\n\n[... file truncated — showing first ${cap} bytes ...]`;

function readFile(_id: string, path: string, full = false, area = "session") {
  if (area === "scratchpad" && path === "notes.md") return Promise.resolve("scratch notes");
  // Same-named in both areas, so this case isolates the size cap from the area.
  if (path === "big.log") {
    return Promise.resolve(`log lines${footer(full ? FULL_CAP : PREVIEW_CAP)}`);
  }
  return Promise.reject({ code: "NOT_FOUND", message: `File not found: ${path}` });
}

const TreeStub = defineComponent({
  name: "FileBrowserTree",
  emits: ["contextmenu-entry", "view-file"],
  setup:
    (_, { slots }) =>
    () =>
      h("div", slots["after-header"]?.()),
});

async function copyContents(entry: SessionFileEntry) {
  const wrapper = mount(ExplorerTab, {
    global: { stubs: { FileBrowserTree: TreeStub, FileContentViewer: true } },
  });
  await flushPromises();
  const event = new MouseEvent("contextmenu", { clientX: 10, clientY: 10 });
  wrapper.findComponent(TreeStub).vm.$emit("contextmenu-entry", event, entry);
  await flushPromises();
  const item = [...document.querySelectorAll<HTMLButtonElement>(".ctx-item")].find(
    (button) => button.textContent?.trim() === "Copy File Contents",
  );
  if (!item) throw new Error('No "Copy File Contents" menu item');
  item.click();
  await flushPromises();
  return wrapper;
}

enableAutoUnmount(afterEach);

describe("ExplorerTab copy file contents", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    // A Claude Code session opens the Explorer on its scratchpad.
    mocks.sessionListFiles.mockImplementation(async (_id: string, area: string) => ({
      root: area === "scratchpad" ? SCRATCHPAD : CLAUDE_ROOT,
      area,
      areas: ["session", "scratchpad"],
      entries: area === "scratchpad" ? [notes, bigLog] : [],
      truncated: false,
    }));
    mocks.sessionReadFile.mockImplementation(readFile);
    mocks.copy.mockResolvedValue(true);
  });

  it("reads a scratchpad file from the scratchpad, not the session folder", async () => {
    await copyContents(notes);

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.copy).toHaveBeenCalledWith("scratch notes");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Copied file contents to clipboard");
  });

  it("warns instead of claiming success when the file is too large to copy in full", async () => {
    await copyContents(bigLog);

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Copied only the first 16 MB of big.log; the file is too large to copy in full",
    );
    expect(mocks.sessionReadFile).toHaveBeenCalledWith(
      "claude-session",
      "big.log",
      true,
      "scratchpad",
    );
    expect(mocks.copy).toHaveBeenCalledWith(`log lines${footer(FULL_CAP)}`);
  });

  it("reports a failed read without copying anything", async () => {
    mocks.sessionReadFile.mockRejectedValue({ code: "IO", message: "Access is denied" });
    await copyContents(notes);

    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Access is denied");
  });
});
