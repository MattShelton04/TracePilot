import { getSourceFormatDiagnostics, IPC_EVENTS } from "@tracepilot/client";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FormatDiagnosticsPanel from "@/components/settings/FormatDiagnosticsPanel.vue";
import {
  CLAUDE_CODE_FORMAT_DIAGNOSTICS,
  COPILOT_FORMAT_DIAGNOSTICS,
} from "@/components/settings/formatDiagnosticsGroups";
import SettingsFormatDiagnostics from "@/components/settings/SettingsFormatDiagnostics.vue";
import { usePreferencesStore } from "@/stores/preferences";

const listeners = vi.hoisted(() => new Map<string, Set<() => void>>());
vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn(async (event: string, handler: () => void) => {
    const handlers = listeners.get(event) ?? new Set();
    handlers.add(handler);
    listeners.set(event, handlers);
    return () => handlers.delete(handler);
  }),
}));

function emit(event: string) {
  for (const handler of listeners.get(event) ?? []) handler();
}

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({ getSourceFormatDiagnostics: vi.fn() });
});

enableAutoUnmount(afterEach);

const copilot = {
  sessions: 47,
  unmappedRecordTypes: [{ name: "session.brand_new_event", sessions: 2, records: 5 }],
  unmappedAttachmentTypes: [],
  versions: [
    { name: "1.0.83", sessions: 40, records: 41 },
    { name: "1.0.100", sessions: 7, records: 9 },
  ],
};

const claude = {
  sessions: 3,
  unmappedRecordTypes: [],
  unmappedAttachmentTypes: [{ name: "brand_new_attachment", sessions: 1, records: 1 }],
  versions: [{ name: "2.1.280", sessions: 3, records: 140 }],
};

function mountPanel(definition = COPILOT_FORMAT_DIAGNOSTICS) {
  return mount(FormatDiagnosticsPanel, { props: definition });
}

async function expand(wrapper: ReturnType<typeof mountPanel>) {
  await wrapper.get("button[aria-expanded]").trigger("click");
}

describe("FormatDiagnosticsPanel", () => {
  beforeEach(() => {
    listeners.clear();
    vi.mocked(getSourceFormatDiagnostics).mockReset();
  });

  it("starts collapsed with a summary, and lists each group with counts when expanded", async () => {
    vi.mocked(getSourceFormatDiagnostics).mockResolvedValue(copilot);
    const wrapper = mountPanel();
    await flushPromises();

    expect(getSourceFormatDiagnostics).toHaveBeenCalledWith("copilot");
    const toggle = wrapper.get("button[aria-expanded]");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.text()).toContain("Copilot CLI");
    expect(toggle.text()).toContain("47 sessions · 2 versions · 1 type to review");
    expect(wrapper.find("table").exists()).toBe(false);

    await expand(wrapper);
    expect(toggle.attributes("aria-expanded")).toBe("true");
    const events = wrapper.get('table[aria-label="Unknown event types"]');
    expect(events.findAll("tbody tr").map((row) => row.text())).toEqual([
      expect.stringMatching(/session\.brand_new_event\s*2\s*5/),
    ]);
    const versions = wrapper.get('table[aria-label="Copilot CLI versions"]');
    expect(versions.findAll("tbody tr td:first-child").map((cell) => cell.text())).toEqual([
      "1.0.83",
      "1.0.100",
    ]);
    // Each table scrolls inside its own region.
    expect(versions.element.parentElement?.classList.contains("format-scroll")).toBe(true);
    expect(wrapper.find('table[aria-label="Unmapped attachment types"]').exists()).toBe(false);
  });

  it("shows the empty message for a list with no rows", async () => {
    vi.mocked(getSourceFormatDiagnostics).mockResolvedValue(claude);
    const wrapper = mountPanel(CLAUDE_CODE_FORMAT_DIAGNOSTICS);
    await flushPromises();
    await expand(wrapper);

    expect(getSourceFormatDiagnostics).toHaveBeenCalledWith("claudeCode");
    expect(wrapper.find('table[aria-label="Unmapped record types"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Every record type is mapped");
    expect(wrapper.get('table[aria-label="Unmapped attachment types"]').text()).toContain(
      "brand_new_attachment",
    );
  });

  it("reports a failed load and retries on refresh", async () => {
    vi.mocked(getSourceFormatDiagnostics)
      .mockRejectedValueOnce(new Error("index unavailable"))
      .mockResolvedValueOnce(copilot);
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.get("button[aria-expanded]").text()).toContain("Couldn't load");
    await expand(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain("index unavailable");

    const refresh = wrapper.findAll("button").find((button) => button.text() === "Refresh");
    await refresh?.trigger("click");
    await flushPromises();
    expect(getSourceFormatDiagnostics).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("session.brand_new_event");
  });

  it("reloads when indexing finishes and stops listening when unmounted", async () => {
    vi.mocked(getSourceFormatDiagnostics)
      .mockResolvedValueOnce({ ...copilot, sessions: 0, unmappedRecordTypes: [], versions: [] })
      .mockResolvedValueOnce(copilot);
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("0 sessions · 0 versions · every type mapped");

    emit(IPC_EVENTS.INDEXING_FINISHED);
    await flushPromises();
    expect(wrapper.text()).toContain("47 sessions");

    wrapper.unmount();
    expect(listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.size ?? 0).toBe(0);
  });
});

describe("SettingsFormatDiagnostics", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    listeners.clear();
    vi.mocked(getSourceFormatDiagnostics).mockReset();
    vi.mocked(getSourceFormatDiagnostics).mockImplementation(async (source) =>
      source === "claudeCode" ? claude : copilot,
    );
    await usePreferencesStore(pinia).whenReady;
  });
  afterEach(() => disposePinia(pinia));

  function panelTitles(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll(".format-panel-title").map((title) => title.text());
  }

  it("shows Copilot CLI only while Claude Code sessions are off", async () => {
    const wrapper = mount(SettingsFormatDiagnostics);
    await flushPromises();
    expect(panelTitles(wrapper)).toEqual(["Copilot CLI"]);
    expect(getSourceFormatDiagnostics).not.toHaveBeenCalledWith("claudeCode");
  });

  it("adds a Claude Code panel while Claude Code sessions are on", async () => {
    usePreferencesStore(pinia).toggleFeature("claudeCodeSessions");
    const wrapper = mount(SettingsFormatDiagnostics);
    await flushPromises();
    expect(panelTitles(wrapper)).toEqual(["Copilot CLI", "Claude Code"]);
    expect(getSourceFormatDiagnostics).toHaveBeenCalledWith("claudeCode");
  });
});
