import { setupPinia } from "@tracepilot/test-utils";
import type { SessionFileEntry, SessionSource } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { NAVIGATE_SESSION_TAB_KEY } from "@/composables/useSessionTabNavigation";
import ExplorerTab from "../../views/tabs/ExplorerTab.vue";

const mocks = vi.hoisted(() => ({
  sessionListFiles: vi.fn(),
  navigateToTab: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    sessionListFiles: mocks.sessionListFiles,
    sessionReadFile: vi.fn().mockResolvedValue(""),
    sessionSearchFiles: vi.fn(),
  });
});

const context = reactive({
  sessionId: "claude-session",
  detail: { id: "claude-session", source: "claudeCode" as SessionSource },
  plan: null as { content: string } | null,
  loadPlan: vi.fn(),
});

vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => context,
}));

const ROOT = "/home/user/.claude/projects/-work-app/claude-session";
const empty = { root: ROOT, area: "session", areas: ["session"], entries: [] };
const subagent: SessionFileEntry = {
  path: "subagents/agent-a.jsonl",
  name: "agent-a.jsonl",
  sizeBytes: 12,
  isDirectory: false,
  fileType: "jsonl",
};

async function mountTab() {
  const wrapper = mount(ExplorerTab, {
    global: { provide: { [NAVIGATE_SESSION_TAB_KEY as symbol]: mocks.navigateToTab } },
  });
  await flushPromises();
  return wrapper;
}

const button = (wrapper: Awaited<ReturnType<typeof mountTab>>, label: string) =>
  wrapper.findAll("button").find((b) => b.text() === label);

enableAutoUnmount(afterEach);

describe("ExplorerTab with no session files", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    context.detail = { id: "claude-session", source: "claudeCode" };
    context.plan = null;
    context.loadPlan.mockImplementation(() => {
      context.plan = { content: "# Plan" };
    });
    mocks.sessionListFiles.mockResolvedValue(empty);
  });

  it("shows one empty state that leads to a Claude Code session's plan", async () => {
    const wrapper = await mountTab();

    expect(context.loadPlan).toHaveBeenCalled();
    const state = wrapper.get('[data-tp-component="EmptyState"]');
    expect(state.text()).toContain("No session files");
    expect(state.text()).toContain(
      "This session has no subagent transcripts, saved tool outputs or scratchpad files. Its plan is on the Overview tab.",
    );
    // The empty tree and the idle file reader no longer contradict it.
    expect(wrapper.text()).not.toContain("Select a file to view its contents");
    expect(wrapper.find(".fb-tree").exists()).toBe(false);

    await button(wrapper, "View plan")?.trigger("click");
    expect(mocks.navigateToTab).toHaveBeenCalledWith("overview");
  });

  it("offers no plan link when the session has none", async () => {
    context.loadPlan.mockImplementation(() => {});
    const wrapper = await mountTab();

    expect(wrapper.get('[data-tp-component="EmptyState"]').text()).not.toContain("plan");
    expect(button(wrapper, "View plan")).toBeUndefined();
  });

  it("describes a Copilot session's folder without Claude Code's areas", async () => {
    context.detail = { id: "claude-session", source: "copilot" };
    context.loadPlan.mockImplementation(() => {});
    const wrapper = await mountTab();

    expect(wrapper.get('[data-tp-component="EmptyState"]').text()).toContain(
      "This session's folder has no files to browse.",
    );
  });

  it("shows the file tree once a refresh finds files", async () => {
    const wrapper = await mountTab();
    mocks.sessionListFiles.mockResolvedValue({ ...empty, entries: [subagent] });

    await button(wrapper, "Refresh")?.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-tp-component="EmptyState"]').exists()).toBe(false);
    expect(wrapper.find(".fb-tree").exists()).toBe(true);
    expect(wrapper.text()).toContain("agent-a.jsonl");
  });

  it("keeps a listing error in the tree with its Retry, not the empty state", async () => {
    mocks.sessionListFiles.mockRejectedValue(new Error("Session folder unreadable"));
    const wrapper = await mountTab();

    expect(wrapper.find('[data-tp-component="EmptyState"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Session folder unreadable");
    expect(button(wrapper, "Retry")).toBeDefined();
    // The error stands alone: no empty tree or idle reader contradicts it.
    expect(wrapper.text()).not.toContain("No files");
    expect(wrapper.text()).not.toContain("Select a file to view its contents");

    mocks.sessionListFiles.mockResolvedValue({ ...empty, entries: [subagent] });
    await button(wrapper, "Retry")?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("Session folder unreadable");
    expect(wrapper.text()).toContain("agent-a.jsonl");
    expect(wrapper.text()).toContain("Select a file to view its contents");
  });
});
