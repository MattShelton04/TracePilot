import { IPC_EVENTS } from "@tracepilot/client";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import SettingsClaudeCode from "@/components/settings/SettingsClaudeCode.vue";
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
  const { createDefaultConfig } = await import("@tracepilot/types");
  const config = createDefaultConfig({
    general: { setupComplete: true },
    sources: { claudeCode: { configDir: "C:\\Users\\demo\\.claude" } },
  });
  return createClientMock({
    getConfig: vi.fn(async () => config),
    getSourceFormatDiagnostics: vi.fn(async () => ({
      sessions: 0,
      unmappedRecordTypes: [],
      unmappedAttachmentTypes: [],
      versions: [],
    })),
  });
});

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
afterEach(() => disposePinia(pinia));

async function mountSection() {
  const wrapper = mount(SettingsClaudeCode);
  await flushPromises();
  return wrapper;
}

function switchOf(wrapper: Awaited<ReturnType<typeof mountSection>>) {
  return wrapper.get('[role="switch"][aria-label="Claude Code sessions"]');
}

describe("SettingsClaudeCode", () => {
  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    listeners.clear();
    await usePreferencesStore(pinia).whenReady;
  });

  it("is an experimental section that starts off with its settings hidden", async () => {
    const wrapper = await mountSection();

    expect(wrapper.get(".settings-section-title").text()).toBe("Claude Code");
    expect(wrapper.get(".feature-group-title").text()).toBe("Experimental");
    expect(switchOf(wrapper).attributes("aria-checked")).toBe("false");
    expect(wrapper.findAll(".setting-row")).toHaveLength(1);
    expect(wrapper.find("#settings-claude-code-folder").exists()).toBe(false);
    expect(wrapper.find("#settings-claude-code-cli").exists()).toBe(false);
    expect(wrapper.find('[data-testid="claude-code-format-diagnostics"]').exists()).toBe(false);
  });

  it("toggles the same feature flag and shows folder, command, then diagnostics while on", async () => {
    const preferences = usePreferencesStore(pinia);
    const wrapper = await mountSection();

    await switchOf(wrapper).trigger("click");
    await flushPromises();
    expect(preferences.isFeatureEnabled("claudeCodeSessions")).toBe(true);
    expect(switchOf(wrapper).attributes("aria-checked")).toBe("true");
    const labels = wrapper.findAll(".setting-label").map((label) => label.text());
    expect(labels).toEqual([
      "Claude Code sessions",
      "Claude Code folder",
      "Claude Code command",
      "Claude Code format diagnostics",
    ]);
    expect(wrapper.get<HTMLInputElement>("#settings-claude-code-folder").element.value).toBe(
      "C:\\Users\\demo\\.claude",
    );

    await switchOf(wrapper).trigger("click");
    await nextTick();
    expect(preferences.isFeatureEnabled("claudeCodeSessions")).toBe(false);
    expect(wrapper.find("#settings-claude-code-folder").exists()).toBe(false);
    expect(wrapper.find("#settings-claude-code-cli").exists()).toBe(false);
  });

  it("holds the folder while an index is running", async () => {
    usePreferencesStore(pinia).toggleFeature("claudeCodeSessions");
    const wrapper = await mountSection();
    const folder = () => wrapper.get<HTMLInputElement>("#settings-claude-code-folder");
    expect(folder().element.disabled).toBe(false);

    emit(IPC_EVENTS.INDEXING_STARTED);
    await nextTick();
    expect(folder().element.disabled).toBe(true);

    emit(IPC_EVENTS.INDEXING_FINISHED);
    await nextTick();
    expect(folder().element.disabled).toBe(false);
  });
});
