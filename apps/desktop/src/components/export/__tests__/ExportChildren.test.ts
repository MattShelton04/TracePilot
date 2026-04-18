import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

// ── Mock dependencies used by ExportTab ─────────────────────────

vi.mock("@tracepilot/client", () => ({
  exportSessions: vi.fn(),
  getSessionSections: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/composables/useBrowseDirectory", () => ({
  browseForSavePath: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/utils/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/utils/openExternal", () => ({
  openExternal: vi.fn(),
}));

vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({
    sessions: [],
    fetchSessions: vi.fn(),
  }),
}));

vi.mock("@/composables/useExportPreview", () => ({
  useExportPreview: () => ({
    preview: ref(null),
    loading: ref(false),
    error: ref(null),
  }),
}));

const defaultImportFlow = {
  step: ref("select"),
  fileName: ref(""),
  error: ref(null),
  preview: ref(null),
  selectedSessions: ref([] as string[]),
  conflictStrategy: ref("skip"),
  canImport: ref(false),
  importProgress: ref(0),
  importedCount: ref(0),
  skippedCount: ref(0),
  importErrors: ref([] as string[]),
  browseFile: vi.fn(),
  toggleSession: vi.fn(),
  executeImport: vi.fn(),
  reset: vi.fn(),
};

vi.mock("@/composables/useImportFlow", () => ({
  useImportFlow: () => defaultImportFlow,
}));

// Router stub - ImportTab calls useRouter()
const pushMock = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// ── Stub out the UI package for lightweight mounting ────────────

vi.mock("@tracepilot/ui", () => {
  const passthrough = (name: string) =>
    defineComponent({
      name,
      inheritAttrs: false,
      setup(_, { slots, attrs }) {
        return () => h("div", { class: name.toLowerCase(), ...attrs }, slots.default?.());
      },
    });
  const input = defineComponent({
    name: "StubInput",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    setup(_, { slots }) {
      return () => h("div", { class: "stub-input" }, slots.default?.());
    },
  });
  return {
    Badge: passthrough("Badge"),
    BtnGroup: input,
    EmptyState: passthrough("EmptyState"),
    FormSwitch: input,
    MarkdownContent: passthrough("MarkdownContent"),
    PageShell: passthrough("PageShell"),
    ProgressBar: passthrough("ProgressBar"),
    TabNav: passthrough("TabNav"),
    formatBytes: (n: number) => `${n}B`,
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  };
});

import ExportTab from "../ExportTab.vue";
import ImportTab from "../ImportTab.vue";
import ExportView from "@/views/ExportView.vue";

beforeEach(() => {
  setActivePinia(createPinia());
  defaultImportFlow.step.value = "select";
  defaultImportFlow.error.value = null;
  defaultImportFlow.preview.value = null;
  pushMock.mockReset();
});

describe("ExportTab", () => {
  it("mounts with the config + preview split layout", () => {
    const wrapper = mount(ExportTab);
    expect(wrapper.find(".export-split").exists()).toBe(true);
    expect(wrapper.find(".config-col").exists()).toBe(true);
    expect(wrapper.find(".preview-col").exists()).toBe(true);
    expect(wrapper.text()).toContain("Preview");
    wrapper.unmount();
  });

  it("shows the save-preset inline input when toggled", async () => {
    const wrapper = mount(ExportTab);
    expect(wrapper.find(".save-preset-row").exists()).toBe(false);
    await wrapper.find(".preset-save-btn").trigger("click");
    expect(wrapper.find(".save-preset-row").exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("ImportTab", () => {
  it("mounts and renders the drop zone on the select step", () => {
    const wrapper = mount(ImportTab);
    expect(wrapper.find(".import-container").exists()).toBe(true);
    expect(wrapper.find(".drop-zone").exists()).toBe(true);
    expect(wrapper.text()).toContain(".tpx.json");
    wrapper.unmount();
  });

  it("calls browseFile when the drop zone is clicked", async () => {
    const wrapper = mount(ImportTab);
    await wrapper.find(".drop-zone").trigger("click");
    expect(defaultImportFlow.browseFile).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows the success step when import completes", async () => {
    defaultImportFlow.step.value = "complete";
    defaultImportFlow.importedCount.value = 3;
    const wrapper = mount(ImportTab);
    expect(wrapper.find(".import-success").exists()).toBe(true);
    expect(wrapper.text()).toContain("Import Complete");
    wrapper.unmount();
  });
});

describe("ExportView shell", () => {
  it("mounts with the header, tabs, and the Export tab by default", () => {
    const wrapper = mount(ExportView);
    expect(wrapper.find(".export-feature").exists()).toBe(true);
    expect(wrapper.find(".export-header").exists()).toBe(true);
    // Export tab renders its split layout
    expect(wrapper.find(".export-split").exists()).toBe(true);
    expect(wrapper.find(".import-container").exists()).toBe(false);
    wrapper.unmount();
  });
});
