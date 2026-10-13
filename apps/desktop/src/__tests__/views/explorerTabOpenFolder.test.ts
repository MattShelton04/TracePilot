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
  setup:
    (_, { slots }) =>
    () =>
      h("div", slots["after-header"]?.()),
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
    localStorage.clear();
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

describe("ExplorerTab scratchpad area", () => {
  // Its scratchpad lives in Claude Code's temp folder, browsed on its own.
  const SCRATCHPAD = "/tmp/claude-1000/-work-app/claude-session/scratchpad";
  const shot: SessionFileEntry = {
    path: "shots/home.png",
    name: "home.png",
    sizeBytes: 2048,
    isDirectory: false,
    fileType: "image",
  };

  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    mocks.sessionListFiles.mockImplementation(async (_id: string, area: string) =>
      area === "scratchpad"
        ? {
            root: SCRATCHPAD,
            area,
            areas: ["session", "scratchpad"],
            entries: [shot],
            truncated: false,
          }
        : { root: CLAUDE_ROOT, area, areas: ["session", "scratchpad"], entries, truncated: false },
    );
    mocks.openInExplorer.mockResolvedValue(undefined);
  });

  function areaButtons(wrapper: Awaited<ReturnType<typeof mountTab>>) {
    return wrapper.findAll(".explorer-areas button");
  }

  it("opens on the scratchpad and resolves its files under its own folder", async () => {
    const wrapper = await mountTab();
    expect(mocks.sessionListFiles).toHaveBeenLastCalledWith("claude-session", "scratchpad");
    const [scratchpad, session] = areaButtons(wrapper);
    expect(scratchpad.text()).toBe("Scratchpad");
    expect(scratchpad.attributes("aria-checked")).toBe("true");
    expect(session.attributes("aria-checked")).toBe("false");

    await openMenu(wrapper, shot);
    menuItem("Open Containing Folder").click();
    await flushPromises();
    expect(mocks.openInExplorer).toHaveBeenCalledWith(`${SCRATCHPAD}/shots`);
  });

  it("switches to the session's own files and remembers the choice", async () => {
    let wrapper = await mountTab();
    await areaButtons(wrapper)[1].trigger("click");
    await flushPromises();
    expect(mocks.sessionListFiles).toHaveBeenLastCalledWith("claude-session", "session");
    expect(areaButtons(wrapper)[1].attributes("aria-checked")).toBe("true");

    wrapper.unmount();
    wrapper = await mountTab();
    expect(mocks.sessionListFiles).toHaveBeenLastCalledWith("claude-session", "session");
  });

  it("shows no switch for a session without a scratchpad", async () => {
    mocks.sessionListFiles.mockResolvedValue({
      root: CLAUDE_ROOT,
      area: "session",
      areas: ["session"],
      entries,
      truncated: true,
    });
    const wrapper = await mountTab();
    expect(areaButtons(wrapper)).toHaveLength(0);
    expect(wrapper.find(".explorer-truncated").exists()).toBe(true);
  });
});
