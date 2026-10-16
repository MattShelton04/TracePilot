import { readFileSync } from "node:fs";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SessionDetailPanel from "@/components/session/SessionDetailPanel.vue";
import { useSessionsStore } from "@/stores/sessions";
import { createStore, mountForSource } from "./sessionDetailPanelFixtures";

// The panel's shell, header and tab nav. Actions and refreshing have their
// own files: SessionDetailActions.test.ts and SessionDetailPanelRefresh.test.ts.
const mocks = vi.hoisted(() => ({
  getSessionLiveness: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("@tracepilot/ui", async (original) => {
  const module = await original<typeof import("@tracepilot/ui")>();
  const { ref } = await import("vue");
  return { ...module, useClipboard: () => ({ copy: mocks.copy, copied: ref(false) }) };
});

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({ getSessionLiveness: mocks.getSessionLiveness });
});

describe("SessionDetailPanel", () => {
  // Every mount and store lookup names this test's pinia; see
  // SessionDetailPanelRefresh.test.ts for why an earlier test's pinia leaks.
  let pinia: Pinia;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    mocks.getSessionLiveness.mockResolvedValue({ state: "idle" });
  });

  it("keeps Explorer fill-content mode inside the standard constrained page shell", () => {
    const wrapper = mount(SessionDetailPanel, {
      global: { plugins: [pinia] },
      props: {
        store: createStore(),
        sessionId: "session-1",
        router: null,
        tabMode: "local",
        activeSubTab: "explorer",
        fillContent: true,
        refreshEnabled: false,
      },
      slots: {
        default: '<div class="explorer-slot">Explorer</div>',
      },
    });

    expect(wrapper.find(".page-content.explorer-mode").exists()).toBe(true);
    expect(wrapper.find(".page-content-inner").exists()).toBe(true);
    expect(wrapper.find(".page-content-fluid").exists()).toBe(false);
  });

  it("preserves the constrained shell width when Explorer switches the shell to flex layout", () => {
    const css = readFileSync("src/styles/features/session-explorer.css", "utf8");

    expect(css).toMatch(
      /\.page-content\.explorer-mode \.page-content-inner\s*\{[^}]*width:\s*100%;/s,
    );
  });

  it("marks a Claude Code session waiting for input apart from a busy one", async () => {
    const header = async (status: "busy" | "waiting") => {
      mocks.getSessionLiveness.mockResolvedValue({ state: "running", pid: 7, status });
      const wrapper = mountForSource(pinia, "claudeCode");
      await flushPromises();
      const badge = wrapper.get(".active-badge-inline");
      const result = {
        text: badge.text(),
        warning: badge.classes().includes("badge-warning"),
        dot: wrapper.get(".active-dot").classes().includes("active-dot--waiting"),
      };
      wrapper.unmount();
      return result;
    };
    expect(await header("busy")).toEqual({ text: "● Busy", warning: false, dot: false });
    expect(await header("waiting")).toEqual({ text: "● Waiting", warning: true, dot: true });
  });

  it("keeps every tab and Copilot action for a session without a source", async () => {
    const wrapper = mountForSource(pinia);
    await flushPromises();

    const tabs = wrapper.findAll("[role='tab']").map((t) => t.text());
    const text = wrapper.text();
    expect(tabs).toHaveLength(8);
    expect(text).toContain("Copy Resume Command");
    expect(text).toContain("Resume in Terminal");
    expect(text).toContain("Open Folder");
    expect(text).toContain("cli");
    expect(text).not.toContain("Claude Code");
    wrapper.unmount();
  });

  it("counts conversation turns and events on their tabs", async () => {
    const wrapper = mountForSource(pinia);
    await flushPromises();

    const tabs = wrapper.findAll("[role='tab']").map((t) => t.text().replace(/\s+/g, " "));
    expect(tabs.slice(0, 3)).toEqual(["Overview", "Conversation 2", "Events 4"]);
    wrapper.unmount();
  });

  it("hides Copilot-only tabs and actions for a Claude Code session", async () => {
    const wrapper = mountForSource(pinia, "claudeCode");
    await flushPromises();

    const tabs = wrapper.findAll("[role='tab']").map((t) => t.text());
    const text = wrapper.text();
    expect(tabs.map((t) => t.replace(/\d+$/, "").trim())).toEqual([
      "Overview",
      "Conversation",
      "Events",
      "Todos",
      "Metrics",
      "Context",
      "Explorer",
      "Timeline",
    ]);
    expect(text).toContain("Copy Resume Command");
    const copyButton = wrapper.get('[title="Copy: claude --resume session-1"]');
    await copyButton.trigger("click");
    expect(mocks.copy).toHaveBeenCalledWith("claude --resume session-1");
    expect(text).toContain("Resume in Terminal");
    expect(wrapper.get('[title="Session source"]').text()).toBe("Claude Code");
    wrapper.unmount();
  });

  it("shows a folder chip from the cwd only when the session has no repository", async () => {
    const header = async (detail: { repository: string | null; cwd: string | null }) => {
      const wrapper = mountForSource(pinia, "claudeCode");
      const store = wrapper.props("store");
      await wrapper.setProps({ store: { ...store, detail: { ...store.detail!, ...detail } } });
      await flushPromises();
      const chip = wrapper.find('[data-testid="session-project-chip"]');
      const result = {
        chip: chip.exists() ? chip.text() : null,
        title: chip.exists() ? chip.attributes("title") : null,
        icon: chip.exists() && chip.find("svg").exists(),
        badges: wrapper.findAll(".detail-badges .badge").map((b) => b.text()),
      };
      wrapper.unmount();
      return result;
    };

    expect(await header({ repository: null, cwd: "/work/synthetic/orchard/" })).toEqual({
      chip: "orchard",
      title: "/work/synthetic/orchard/",
      icon: true,
      badges: ["Claude Code", "orchard", "main"],
    });
    expect(await header({ repository: "org/app", cwd: "/work/app" })).toMatchObject({
      chip: null,
      badges: ["Claude Code", "org/app", "main"],
    });
    expect(await header({ repository: null, cwd: null })).toMatchObject({
      chip: null,
      badges: ["Claude Code", "main"],
    });
  });

  it("keeps Claude Code gating when the detail omits a source the list knows", async () => {
    useSessionsStore(pinia).sessions = [
      { id: "session-1", source: "claudeCode", isRunning: false },
    ] as never;
    const wrapper = mountForSource(pinia);
    await flushPromises();

    const tabs = wrapper.findAll("[role='tab']");
    expect(tabs).toHaveLength(8);
    expect(wrapper.find('[title="Copy: claude --resume session-1"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Resume in Terminal");
    expect(wrapper.get('[title="Session source"]').text()).toBe("Claude Code");
    wrapper.unmount();
  });
});
