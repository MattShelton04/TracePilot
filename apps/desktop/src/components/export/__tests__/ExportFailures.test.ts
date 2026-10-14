import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

// Raw Zip copies Copilot's session folder, so Claude Code sessions can't use
// it; and a failed export must say why rather than "Action failed".
const exportSessions = vi.hoisted(() => vi.fn());
const exportSessionFolderZip = vi.hoisted(() => vi.fn());
const browseForSavePath = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ query: {} as Record<string, string>, params: {} }));

vi.mock("@tracepilot/client", () => ({
  exportSessions,
  exportSessionFolderZip,
  getSessionSections: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tracepilot/ui");
  return {
    ...actual,
    useToast: () => ({ success: toastSuccess, error: toastError }),
  };
});
vi.mock("@/composables/useBrowseDirectory", () => ({ browseForSavePath }));
vi.mock("@/utils/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({
    sessions: [
      { id: "copilot-session", summary: "Copilot work", repository: "acme/app", source: "copilot" },
      {
        id: "claude-session",
        summary: "Claude work",
        repository: "acme/app",
        source: "claudeCode",
      },
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

let wrapper: VueWrapper | undefined;

async function mountTab(sessionId: string) {
  route.query = { sessionId };
  wrapper = mount(ExportTab);
  await flushPromises();
  return wrapper;
}

async function select(w: VueWrapper, id: string) {
  w.findComponent(ExportSessionPicker).vm.$emit("select", id);
  await flushPromises();
}

const formatLabels = (w: VueWrapper) => w.findAll(".btn-group button").map((b) => b.text());

async function chooseFormat(w: VueWrapper, label: string) {
  const button = w.findAll(".btn-group button").find((b) => b.text() === label);
  if (!button) throw new Error(`no ${label} format button`);
  await button.trigger("click");
  await flushPromises();
}

const exportButton = (w: VueWrapper) => w.get(".btn-export");

beforeEach(() => {
  setupPinia();
  localStorage.clear();
  exportSessions.mockReset();
  exportSessionFolderZip.mockReset();
  browseForSavePath.mockReset().mockResolvedValue("C:/exports/out.file");
  toastError.mockReset();
  toastSuccess.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe("ExportTab Raw Zip availability", () => {
  it("offers Raw Zip for a Copilot session", async () => {
    const w = await mountTab("copilot-session");
    expect(formatLabels(w)).toEqual(["JSON", "Markdown", "Raw Zip"]);
    expect(w.text()).not.toContain("Raw Zip is available for Copilot sessions only");
  });

  it("does not offer Raw Zip for a Claude Code session, and says why", async () => {
    const w = await mountTab("claude-session");
    expect(formatLabels(w)).toEqual(["JSON", "Markdown"]);
    expect(w.text()).toContain("Raw Zip is available for Copilot sessions only");
  });

  it("falls back to JSON when Raw Zip is selected and a Claude Code session is chosen", async () => {
    const w = await mountTab("copilot-session");
    await chooseFormat(w, "Raw Zip");
    expect(exportButton(w).text()).toBe("Export Zip");

    await select(w, "claude-session");

    expect(exportButton(w).text()).toBe("Export");
    const active = w.findAll(".btn-group button").filter((b) => b.classes("active"));
    expect(active.map((b) => b.text())).toEqual(["JSON"]);

    await exportButton(w).trigger("click");
    await flushPromises();
    expect(exportSessionFolderZip).not.toHaveBeenCalled();
    expect(exportSessions).toHaveBeenCalledWith(
      expect.objectContaining({ sessionIds: ["claude-session"], format: "json" }),
    );
  });
});

describe("ExportTab export failures", () => {
  it("toasts the backend's reason when a JSON export fails", async () => {
    exportSessions.mockRejectedValue({ code: "IO", message: "Access is denied (os error 5)" });
    const w = await mountTab("claude-session");

    await exportButton(w).trigger("click");
    await flushPromises();

    expect(toastError).toHaveBeenCalledWith("Access is denied (os error 5)");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(exportButton(w).attributes("disabled")).toBeUndefined();
    expect(exportButton(w).text()).toBe("Export");
  });

  it("toasts the backend's reason when a Raw Zip export fails", async () => {
    exportSessionFolderZip.mockRejectedValue({
      code: "IO",
      message: "The process cannot access the file because it is being used by another process.",
    });
    const w = await mountTab("copilot-session");
    await chooseFormat(w, "Raw Zip");

    await exportButton(w).trigger("click");
    await flushPromises();

    expect(toastError).toHaveBeenCalledWith(
      "The process cannot access the file because it is being used by another process.",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(exportButton(w).text()).toBe("Export Zip");

    // The normal path still works afterwards.
    exportSessionFolderZip.mockResolvedValue(undefined);
    await exportButton(w).trigger("click");
    await flushPromises();
    expect(toastSuccess).toHaveBeenCalledWith("Session folder exported as zip");
  });
});
