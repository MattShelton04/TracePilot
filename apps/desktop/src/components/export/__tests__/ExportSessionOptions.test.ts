import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

// Which sessions Export's picker offers, and how it names one without a summary.
const route = vi.hoisted(() => ({ query: {} as Record<string, string>, params: {} }));

vi.mock("@tracepilot/client", () => ({
  exportSessions: vi.fn(),
  exportSessionFolderZip: vi.fn(),
  getSessionSections: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/composables/useBrowseDirectory", () => ({ browseForSavePath: vi.fn() }));
vi.mock("@/utils/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({
    sessions: [
      {
        id: "full-session",
        summary: "Full",
        repository: "acme/app",
        source: "copilot",
        turnCount: 4,
      },
      { id: "c1a0de00-0000-4000-8000-000000000005", source: "claudeCode", turnCount: 0 },
      { id: "unsummarized-0000", repository: "acme/app", source: "copilot", turnCount: 2 },
    ],
    fetchSessions: vi.fn(),
  }),
}));
vi.mock("@/composables/useExportPreview", () => ({
  useExportPreview: () => ({ preview: ref(null), loading: ref(false), error: ref(null) }),
}));
vi.mock("vue-router", () => ({ useRoute: () => route }));

import ExportTab from "@/components/export/ExportTab.vue";
import { usePreferencesStore } from "@/stores/preferences";

let wrapper: VueWrapper | undefined;

async function openPicker() {
  wrapper = mount(ExportTab);
  await flushPromises();
  await wrapper.find(".session-picker__input").trigger("focus");
  return wrapper
    .findAll(".session-picker__option")
    .map((o) => o.get(".session-picker__name").text());
}

beforeEach(() => {
  setupPinia();
  localStorage.clear();
  route.query = {};
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe("Export session picker options", () => {
  it("leaves out empty sessions while Hide empty sessions is on", async () => {
    const options = await openPicker();
    expect(options).toEqual(["Full", "Session unsummar"]);
  });

  it("offers every session once Hide empty sessions is off", async () => {
    usePreferencesStore().hideEmptySessions = false;
    const options = await openPicker();
    expect(options).toEqual(["Full", "Session c1a0de00", "Session unsummar"]);
  });

  it("keeps an empty session that Export was opened with", async () => {
    route.query = { sessionId: "c1a0de00-0000-4000-8000-000000000005" };
    const options = await openPicker();
    expect(options).toContain("Session c1a0de00");
    expect(options).toHaveLength(3);
  });
});
