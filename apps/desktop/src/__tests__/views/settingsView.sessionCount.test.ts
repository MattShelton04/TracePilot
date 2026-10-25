import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { useSessionsStore } from "@/stores/sessions";
import SettingsView from "@/views/SettingsView.vue";

const preferences = reactive({ hideEmptySessions: true });
vi.mock("@/stores/preferences", () => ({ usePreferencesStore: () => preferences }));
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({ getGitInfo: vi.fn().mockResolvedValue({}) });
});

enableAutoUnmount(afterEach);

const sections = [
  "SettingsAlerts",
  "SettingsAppearance",
  "SettingsClaudeCode",
  "SettingsExperimental",
  "SettingsGeneral",
  "SettingsLogging",
  "SettingsPricing",
  "SettingsSdk",
  "SettingsToolVisualization",
  "SettingsUpdates",
];

function session(id: string, turnCount: number): SessionListItem {
  return { id, eventCount: turnCount * 3, turnCount, isRunning: false };
}

function render() {
  return mount(SettingsView, {
    global: {
      stubs: {
        ...Object.fromEntries(sections.map((name) => [name, true])),
        // The indexed count it exposes counted empty sessions; About no longer reads it.
        SettingsDataStorage: { template: "<div />", setup: () => ({ databaseSize: "1 KB" }) },
      },
    },
  });
}

function aboutSessionCount(wrapper: ReturnType<typeof render>) {
  const terms = wrapper.findAll("dt");
  const index = terms.findIndex((term) => term.text() === "Session Count");
  expect(index).toBeGreaterThanOrEqual(0);
  return wrapper.findAll("dd")[index]!.text();
}

describe("Settings About session count", () => {
  beforeEach(() => {
    setupPinia();
    preferences.hideEmptySessions = true;
    useSessionsStore().sessions = [session("a", 2), session("b", 1), session("empty", 0)];
  });

  it("matches the sidebar, leaving out empty sessions while they are hidden", async () => {
    const wrapper = render();
    await flushPromises();
    expect(useSessionsStore().visibleSessionCount).toBe(2);
    expect(aboutSessionCount(wrapper)).toBe("2");

    preferences.hideEmptySessions = false;
    await flushPromises();
    expect(aboutSessionCount(wrapper)).toBe("3");
  });
});
