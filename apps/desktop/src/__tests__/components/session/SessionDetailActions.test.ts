import { flushPromises } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Router } from "vue-router";
import { usePreferencesStore } from "@/stores/preferences";
import { makeTimeline, makeWindow } from "@/utils/__tests__/promptCacheFixtures";
import {
  CLAUDE_PROJECT_FOLDER,
  createStore,
  mountForSource,
  mountPanel,
} from "./sessionDetailPanelFixtures";

// The session header's action bar, mounted through the panel that feeds it.
const mocks = vi.hoisted(() => ({
  getSessionLiveness: vi.fn(),
  openInExplorer: vi.fn(),
  resumeSessionInTerminal: vi.fn(),
  copy: vi.fn(),
  toastError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@tracepilot/ui", async (original) => {
  const module = await original<typeof import("@tracepilot/ui")>();
  const { ref } = await import("vue");
  const toast = module.useToast();
  return {
    ...module,
    useClipboard: () => ({ copy: mocks.copy, copied: ref(false) }),
    useToast: () => ({ ...toast, error: mocks.toastError }),
  };
});

vi.mock("@/utils/logger", async (original) => ({
  ...(await original<typeof import("@/utils/logger")>()),
  logError: mocks.logError,
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSessionLiveness: mocks.getSessionLiveness,
    openInExplorer: mocks.openInExplorer,
    resumeSessionInTerminal: mocks.resumeSessionInTerminal,
  });
});

describe("SessionDetailActions", () => {
  // Every mount and store lookup names this test's pinia; see
  // SessionDetailPanelRefresh.test.ts for why an earlier test's pinia leaks.
  let pinia: Pinia;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    mocks.getSessionLiveness.mockResolvedValue({ state: "idle" });
  });

  it("shows recorded cache expiry beside resume controls for an ended session", async () => {
    const prefs = usePreferencesStore(pinia);
    prefs.featureFlags.promptCacheInsights = true;
    const store = createStore();
    store.promptCache = makeTimeline([
      makeWindow({
        outcome: "sessionEnded",
        resumeAt: null,
        expiresAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      }),
    ]);
    const wrapper = mountPanel(pinia, store);
    await flushPromises();

    expect(wrapper.find(".active-badge-inline").exists()).toBe(false);
    expect(wrapper.get('[data-testid="prompt-cache-chip"]').text()).toContain(
      "Cache expired 12m ago",
    );
    expect(wrapper.text()).toContain("Resume");

    prefs.featureFlags.promptCacheInsights = false;
    await wrapper.setProps({ sessionId: "session-2" });
    expect(wrapper.find('[data-testid="prompt-cache-chip"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("exports the loaded session through the router, and offers Replay only behind its flag", async () => {
    const prefs = usePreferencesStore(pinia);
    await prefs.whenReady;
    await flushPromises();
    const router = { push: vi.fn() } as unknown as Router;
    const wrapper = mountPanel(pinia, createStore(), { router });
    await flushPromises();
    const button = (label: string) => wrapper.findAll("button").find((b) => b.text() === label);

    await button("Export")!.trigger("click");
    expect(router.push).toHaveBeenCalledExactlyOnceWith({
      name: "export",
      query: { sessionId: "session-1" },
    });
    expect(button("Replay")).toBeUndefined();

    prefs.featureFlags.sessionReplay = true;
    await flushPromises();
    await button("Replay")!.trigger("click");
    expect(router.push).toHaveBeenLastCalledWith({ name: "replay", params: { id: "session-1" } });

    prefs.featureFlags.exportView = false;
    await flushPromises();
    expect(button("Export")).toBeUndefined();
    wrapper.unmount();
  });

  it("offers no Export or Replay where no router is installed", async () => {
    const prefs = usePreferencesStore(pinia);
    await prefs.whenReady;
    prefs.featureFlags.sessionReplay = true;
    const wrapper = mountPanel(pinia, createStore(), { router: null });
    await flushPromises();
    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels).not.toContain("Export");
    expect(labels).not.toContain("Replay");
    wrapper.unmount();
  });

  it("resumes a Copilot session through the configured CLI command", async () => {
    const prefs = usePreferencesStore(pinia);
    // Config hydration must finish first, or it resets these preferences.
    await prefs.whenReady;
    await flushPromises();
    prefs.cliCommand = "gh copilot";
    const wrapper = mountForSource(pinia, "copilot");
    await flushPromises();

    await wrapper.get('[title="Copy: gh copilot --resume session-1"]').trigger("click");
    expect(mocks.copy).toHaveBeenCalledWith("gh copilot --resume session-1");
    await wrapper.get('[title="Resume session session-1 in a new terminal"]').trigger("click");
    expect(mocks.resumeSessionInTerminal).toHaveBeenCalledWith("session-1", "gh copilot");
    wrapper.unmount();
  });

  it("lets the backend pick the default Copilot CLI when the setting is blank", async () => {
    const prefs = usePreferencesStore(pinia);
    // Config hydration must finish first, or it resets these preferences.
    await prefs.whenReady;
    await flushPromises();
    prefs.cliCommand = "  ";
    const wrapper = mountForSource(pinia, "copilot");
    await flushPromises();

    await wrapper.get('[title="Copy: copilot --resume session-1"]').trigger("click");
    await wrapper.get('[title="Resume session session-1 in a new terminal"]').trigger("click");
    // A blank command would fail the backend's "must not be empty" check.
    expect(mocks.resumeSessionInTerminal).toHaveBeenCalledWith("session-1", undefined);

    prefs.cliCommand = " gh copilot ";
    await flushPromises();
    await wrapper.get('[title="Resume session session-1 in a new terminal"]').trigger("click");
    expect(mocks.resumeSessionInTerminal).toHaveBeenLastCalledWith("session-1", "gh copilot");
    wrapper.unmount();
  });

  it("resumes a Claude Code session through its own CLI command, not Copilot's", async () => {
    const prefs = usePreferencesStore(pinia);
    // Config hydration must finish first, or it resets these preferences.
    await prefs.whenReady;
    await flushPromises();
    prefs.cliCommand = "gh copilot";
    prefs.claudeCliCommand = "npx claude";
    const wrapper = mountForSource(pinia, "claudeCode");
    await flushPromises();

    await wrapper.get('[title="Copy: npx claude --resume session-1"]').trigger("click");
    expect(mocks.copy).toHaveBeenCalledWith("npx claude --resume session-1");
    await wrapper.get('[title="Resume session session-1 in a new terminal"]').trigger("click");
    // The backend picks the Claude Code CLI; the Copilot preference is not sent.
    expect(mocks.resumeSessionInTerminal).toHaveBeenCalledWith("session-1", undefined);
    wrapper.unmount();
  });

  it.each([
    [
      "Win32",
      "C:\\work\\o'hare",
      "Set-Location -LiteralPath 'C:\\work\\o''hare'; claude --resume session-1",
    ],
    ["MacIntel", "/Users/me/o'hare", "cd '/Users/me/o'\\''hare' && claude --resume session-1"],
  ])("copies a command that starts in the session's directory on %s", async (platform, cwd, command) => {
    const platformSpy = vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    const wrapper = mountForSource(pinia, "claudeCode");
    const store = wrapper.props("store");
    await wrapper.setProps({ store: { ...store, detail: { ...store.detail!, cwd } } });
    await flushPromises();

    const copyButton = wrapper.findAll("button").find((b) => b.text() === "Copy Resume Command");
    expect(copyButton!.attributes("title")).toBe(`Copy: ${command}`);
    await copyButton!.trigger("click");
    expect(mocks.copy).toHaveBeenCalledWith(command);
    platformSpy.mockRestore();
    wrapper.unmount();
  });

  it("asks before resuming a Claude Code session that is running elsewhere", async () => {
    mocks.getSessionLiveness.mockResolvedValue({ state: "running", pid: 7, status: "waiting" });
    const wrapper = mountForSource(pinia, "claudeCode");
    await flushPromises();

    await wrapper.get('[title="Resume session session-1 in a new terminal"]').trigger("click");
    expect(mocks.resumeSessionInTerminal).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Session is active elsewhere");
    const anyway = wrapper.findAll("button").find((b) => b.text() === "Resume Anyway");
    await anyway!.trigger("click");
    expect(mocks.resumeSessionInTerminal).toHaveBeenCalledWith("session-1", undefined);
    wrapper.unmount();
  });

  it("opens the folder the provider reports, not the Copilot directory", async () => {
    const prefs = usePreferencesStore(pinia);
    await prefs.whenReady;
    await flushPromises();
    prefs.sessionStateDir = "/home/demo/.copilot/session-state";
    const wrapper = mountForSource(pinia, "claudeCode");
    await flushPromises();
    const openFolder = () => wrapper.findAll("button").find((b) => b.text() === "Open Folder");
    await openFolder()!.trigger("click");
    expect(mocks.openInExplorer).toHaveBeenCalledExactlyOnceWith(CLAUDE_PROJECT_FOLDER);
    // Until the backend reports a folder there is nothing to open.
    const store = wrapper.props("store");
    await wrapper.setProps({ store: { ...store, detail: { ...store.detail!, folder: null } } });
    expect(openFolder()).toBeUndefined();
    wrapper.unmount();
  });

  it("tells the user when the folder can't be opened, and still logs it", async () => {
    const failure = new Error("The system cannot find the path specified.");
    mocks.openInExplorer.mockRejectedValueOnce(failure);
    const wrapper = mountForSource(pinia, "claudeCode");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Open Folder")!
      .trigger("click");
    await flushPromises();
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      "Couldn't open the session folder: The system cannot find the path specified.",
    );
    expect(mocks.logError).toHaveBeenCalledWith("[sessionDetail] Failed to open folder:", failure);
    wrapper.unmount();
  });

  it("tells the user when the terminal can't be opened, and still logs it", async () => {
    const failure = new Error("No terminal emulator found");
    mocks.resumeSessionInTerminal.mockRejectedValueOnce(failure);
    const wrapper = mountForSource(pinia, "claudeCode");
    await flushPromises();
    await wrapper.get('[title="Resume session session-1 in a new terminal"]').trigger("click");
    await flushPromises();
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      "Couldn't resume the session in a terminal: No terminal emulator found",
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      "[sessionDetail] Failed to open terminal:",
      failure,
    );
    wrapper.unmount();
  });
});
