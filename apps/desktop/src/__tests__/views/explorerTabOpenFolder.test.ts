import { setupPinia } from "@tracepilot/test-utils";
import type { SessionFileEntry } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import ExplorerTab from "../../views/tabs/ExplorerTab.vue";

const mocks = vi.hoisted(() => ({
  openInExplorer: vi.fn(),
  sessionListFiles: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    openInExplorer: mocks.openInExplorer,
    sessionListFiles: mocks.sessionListFiles,
    sessionReadFile: vi.fn().mockResolvedValue(""),
    sessionSearchFiles: vi.fn(),
  });
});

vi.mock("@tracepilot/ui", async (original) => {
  const module = await original<typeof import("@tracepilot/ui")>();
  return {
    ...module,
    useToast: () => ({ ...module.useToast(), error: mocks.toastError }),
  };
});

vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => ({ sessionId: "claude-session" }),
}));

// A Claude Code session: its browsable folders sit in the transcript's own
// directory, not under the configured Copilot session-state directory.
const CLAUDE_ROOT = "/home/user/.claude/projects/-work-app/claude-session";
const entries: SessionFileEntry[] = [
  { path: "subagents", name: "subagents", sizeBytes: 0, isDirectory: true, fileType: "binary" },
  {
    path: "subagents/agent-a.jsonl",
    name: "agent-a.jsonl",
    sizeBytes: 12,
    isDirectory: false,
    fileType: "jsonl",
  },
];

const TreeStub = defineComponent({
  name: "FileBrowserTree",
  emits: ["contextmenu-entry", "view-file"],
  setup: () => () => h("div"),
});

async function mountTab() {
  const wrapper = mount(ExplorerTab, {
    global: { stubs: { FileBrowserTree: TreeStub, FileContentViewer: true } },
  });
  await flushPromises();
  return wrapper;
}

async function openMenu(wrapper: Awaited<ReturnType<typeof mountTab>>, entry: SessionFileEntry) {
  const event = new MouseEvent("contextmenu", { clientX: 10, clientY: 10 });
  wrapper.findComponent(TreeStub).vm.$emit("contextmenu-entry", event, entry);
  await flushPromises();
}

function menuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLButtonElement>(".ctx-item")].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!item) throw new Error(`No "${label}" menu item`);
  return item;
}

enableAutoUnmount(afterEach);

describe("ExplorerTab folder actions", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    mocks.sessionListFiles.mockResolvedValue({ root: CLAUDE_ROOT, entries });
    mocks.openInExplorer.mockResolvedValue(undefined);
  });

  it("opens a file's containing folder under the session's own root", async () => {
    const wrapper = await mountTab();
    await openMenu(wrapper, entries[1]);
    menuItem("Open Containing Folder").click();
    await flushPromises();

    expect(mocks.openInExplorer).toHaveBeenCalledWith(`${CLAUDE_ROOT}/subagents`);
  });

  it("opens a folder under the session's own root", async () => {
    const wrapper = await mountTab();
    await openMenu(wrapper, entries[0]);
    menuItem("Open Folder").click();
    await flushPromises();

    expect(mocks.openInExplorer).toHaveBeenCalledWith(`${CLAUDE_ROOT}/subagents`);
  });

  it("shows a backend refusal as readable text", async () => {
    mocks.openInExplorer.mockRejectedValue({
      code: "VALIDATION",
      message: "Refusing to open path",
    });
    const wrapper = await mountTab();
    await openMenu(wrapper, entries[0]);
    menuItem("Open Folder").click();
    await flushPromises();

    expect(mocks.toastError).toHaveBeenCalledWith("Refusing to open path");
  });
});
