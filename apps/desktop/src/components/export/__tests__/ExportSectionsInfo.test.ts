import { createDeferred, type Deferred, setupPinia } from "@tracepilot/test-utils";
import type { SessionSectionsInfo } from "@tracepilot/types";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

// Each getSessionSections call parks on a deferred so tests choose the order
// in which sessions answer (a large session answers much later than a small one).
const pending = vi.hoisted(() => [] as { id: string; deferred: Deferred<SessionSectionsInfo> }[]);
const getSessionSections = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ query: {} as Record<string, string>, params: {} }));

vi.mock("@tracepilot/client", () => ({
  exportSessions: vi.fn(),
  exportSessionFolderZip: vi.fn(),
  getSessionSections,
}));
vi.mock("@/composables/useBrowseDirectory", () => ({ browseForSavePath: vi.fn() }));
vi.mock("@/utils/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({
    sessions: [
      { id: "big-session", summary: "Big", repository: "acme/app", source: "copilot" },
      { id: "small-session", summary: "Small", repository: "acme/app", source: "copilot" },
    ],
    fetchSessions: vi.fn(),
  }),
}));
vi.mock("@/composables/useExportPreview", () => ({
  useExportPreview: () => ({ preview: ref(null), loading: ref(false), error: ref(null) }),
}));
vi.mock("vue-router", () => ({ useRoute: () => route }));

import ExportSessionPicker from "@/components/export/ExportSessionPicker.vue";
import ExportTab from "@/components/export/ExportTab.vue";

function info(sessionId: string, turns: number, hasPlan: boolean): SessionSectionsInfo {
  return {
    sessionId,
    hasConversation: true,
    hasEvents: true,
    hasTodos: true,
    hasPlan,
    hasCheckpoints: true,
    hasMetrics: true,
    hasIncidents: true,
    hasRewindSnapshots: true,
    hasCustomTables: true,
    eventCount: turns * 10,
    turnCount: turns,
  } as SessionSectionsInfo;
}

const BIG = info("big-session", 400, true);
const SMALL = info("small-session", 3, false);

function request(id: string): Deferred<SessionSectionsInfo> {
  const found = pending.find((p) => p.id === id);
  if (!found) throw new Error(`no getSessionSections request for ${id}`);
  return found.deferred;
}

let wrapper: VueWrapper | undefined;

async function mountTab() {
  wrapper = mount(ExportTab);
  await flushPromises();
  return wrapper;
}

async function select(w: VueWrapper, id: string) {
  w.findComponent(ExportSessionPicker).vm.$emit("select", id);
  await flushPromises();
}

const stats = (w: VueWrapper) => {
  const el = w.find(".session-info-stats");
  return el.exists()
    ? el
        .findAll("span")
        .map((span) => span.text())
        .join(" ")
    : null;
};
const emptyHints = (w: VueWrapper) =>
  w.findAll(".toggle-row-label").filter((row) => row.find(".no-data-hint").exists());
const planIsEmpty = (w: VueWrapper) => emptyHints(w).some((row) => row.text().startsWith("Plan"));

beforeEach(() => {
  setupPinia();
  localStorage.clear();
  pending.length = 0;
  route.query = {};
  getSessionSections.mockReset();
  getSessionSections.mockImplementation((id: string) => {
    const deferred = createDeferred<SessionSectionsInfo>();
    pending.push({ id, deferred });
    return deferred.promise;
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe("ExportTab session sections info", () => {
  it("keeps the selected session's info when an older session answers last", async () => {
    const w = await mountTab();
    await select(w, "big-session");
    await select(w, "small-session");

    request("small-session").resolve(SMALL);
    await flushPromises();
    request("big-session").resolve(BIG);
    await flushPromises();

    expect(w.findComponent(ExportSessionPicker).props("sectionsInfo")).toEqual(SMALL);
    expect(stats(w)).toBe("3 turns · 30 events");
    expect(planIsEmpty(w)).toBe(true);
  });

  it("does not let an older session's failure clear the selected session's info", async () => {
    const w = await mountTab();
    await select(w, "big-session");
    await select(w, "small-session");

    request("small-session").resolve(SMALL);
    await flushPromises();
    request("big-session").reject(new Error("big session failed"));
    await flushPromises();

    expect(stats(w)).toBe("3 turns · 30 events");
  });

  it("hides the previous session's stats and empty hints while the next one loads", async () => {
    const w = await mountTab();
    await select(w, "small-session");
    request("small-session").resolve(SMALL);
    await flushPromises();
    expect(stats(w)).toBe("3 turns · 30 events");
    expect(planIsEmpty(w)).toBe(true);

    await select(w, "big-session");

    expect(stats(w)).toBeNull();
    expect(emptyHints(w)).toHaveLength(0);

    request("big-session").resolve(BIG);
    await flushPromises();
    expect(stats(w)).toBe("400 turns · 4,000 events");
    expect(emptyHints(w)).toHaveLength(0);
  });

  it("loads a deep-linked session once", async () => {
    route.query = { sessionId: "big-session" };
    const w = await mountTab();

    expect(getSessionSections).toHaveBeenCalledTimes(1);
    expect(getSessionSections).toHaveBeenCalledWith("big-session");

    request("big-session").resolve(BIG);
    await flushPromises();
    expect(stats(w)).toBe("400 turns · 4,000 events");
  });

  it("ignores a response that arrives after the tab unmounts", async () => {
    const w = await mountTab();
    await select(w, "big-session");
    const vm = w.vm as unknown as { sectionsInfo: SessionSectionsInfo | null };

    w.unmount();
    wrapper = undefined;
    request("big-session").resolve(BIG);
    await flushPromises();

    expect(vm.sectionsInfo).toBeNull();
  });
});
