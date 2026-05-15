import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

// ── Mock dependencies used by ExportTab ─────────────────────────

vi.mock("@tracepilot/client", () => ({
  exportSessions: vi.fn(),
  exportSessionFolderZip: vi.fn(),
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

// Router stub - ExportTab calls useRoute(), ImportTab calls useRouter()
const pushMock = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => ({ query: {}, params: {} }),
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

import ExportView from "@/views/ExportView.vue";
import ExportFormatSelector from "../ExportFormatSelector.vue";
import ExportPresetBar from "../ExportPresetBar.vue";
import ExportPreviewPanel from "../ExportPreviewPanel.vue";
import ExportSectionsPanel from "../ExportSectionsPanel.vue";
import ExportSessionPicker from "../ExportSessionPicker.vue";
import ExportTab from "../ExportTab.vue";
import ImportTab from "../ImportTab.vue";

beforeEach(() => {
  setupPinia();
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

describe("ExportPresetBar", () => {
  it("emits apply when a preset button is clicked", async () => {
    const presets = [
      { id: "p1", label: "P1", icon: "📦", description: "", format: "json", sections: [] },
    ];
    const wrapper = mount(ExportPresetBar, {
      props: { allPresets: presets as never, customPresets: [], activePreset: null },
    });
    await wrapper.find(".preset-btn").trigger("click");
    expect(wrapper.emitted("apply")?.[0]).toEqual(["p1"]);
    wrapper.unmount();
  });

  it("emits save with trimmed preset name", async () => {
    const wrapper = mount(ExportPresetBar, {
      props: { allPresets: [], customPresets: [], activePreset: null },
    });
    await wrapper.find(".preset-save-btn").trigger("click");
    const input = wrapper.find<HTMLInputElement>(".save-preset-input");
    await input.setValue("  My Preset  ");
    await wrapper.find(".btn-primary").trigger("click");
    expect(wrapper.emitted("save")?.[0]).toEqual(["My Preset"]);
    wrapper.unmount();
  });
});

describe("ExportSessionPicker", () => {
  it("emits select when a session row is clicked", async () => {
    const sessions = [
      {
        id: "abc",
        summary: "Test",
        repository: "r",
        currentModel: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ] as unknown as Parameters<typeof mount>[1] extends never ? never : never;
    const wrapper = mount(ExportSessionPicker, {
      props: {
        sessions: [
          {
            id: "abc",
            summary: "Test session",
            repository: "repo",
            currentModel: null,
          },
        ] as never,
        selectedSessionId: "",
        selectedSession: undefined,
        sectionsInfo: null,
      },
    });
    // Open dropdown by focusing the input
    await wrapper.find(".session-search-input").trigger("focus");
    await wrapper.find(".session-dropdown-item").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["abc"]);
    void sessions;
    wrapper.unmount();
  });
});

describe("ExportFormatSelector", () => {
  it("renders the format description for the current format", () => {
    const wrapper = mount(ExportFormatSelector, {
      props: { modelValue: "markdown" },
    });
    expect(wrapper.find(".format-desc-text").text()).toContain("Human-readable");
    wrapper.unmount();
  });
});

describe("ExportSectionsPanel", () => {
  it("emits toggle-section when a section switch is toggled", async () => {
    const wrapper = mount(ExportSectionsPanel, {
      props: {
        enabledSections: new Set(["conversation"]) as Set<never>,
        contentDetail: {
          includeSubagentInternals: true,
          includeToolDetails: false,
          includeFullToolResults: false,
        },
        redaction: {
          anonymizePaths: false,
          stripSecrets: false,
          stripPii: false,
        },
        sectionHasData: () => null,
      },
    });
    // The stubbed FormSwitch is a passthrough <div> — emit directly via the component instance.
    const firstSwitch = wrapper.findAllComponents({ name: "StubInput" })[0];
    firstSwitch.vm.$emit("update:modelValue", false);
    expect(wrapper.emitted("toggle-section")?.[0]?.[0]).toBe("conversation");
    wrapper.unmount();
  });

  it("emits select-all and select-none from the header actions", async () => {
    const wrapper = mount(ExportSectionsPanel, {
      props: {
        enabledSections: new Set() as Set<never>,
        contentDetail: {
          includeSubagentInternals: false,
          includeToolDetails: false,
          includeFullToolResults: false,
        },
        redaction: {
          anonymizePaths: false,
          stripSecrets: false,
          stripPii: false,
        },
        sectionHasData: () => null,
      },
    });
    const links = wrapper.findAll(".link-btn");
    await links[0].trigger("click");
    await links[1].trigger("click");
    expect(wrapper.emitted("select-all")).toBeTruthy();
    expect(wrapper.emitted("select-none")).toBeTruthy();
    wrapper.unmount();
  });
});

describe("ExportPreviewPanel", () => {
  it("shows the empty state when no session is selected", () => {
    const wrapper = mount(ExportPreviewPanel, {
      props: {
        format: "json",
        preview: null,
        loading: false,
        error: null,
        hasSelectedSession: false,
      },
    });
    expect(wrapper.find(".preview-empty").exists()).toBe(true);
    wrapper.unmount();
  });

  it("renders the preview footer with section count + size when a preview is present", () => {
    const wrapper = mount(ExportPreviewPanel, {
      props: {
        format: "markdown",
        preview: {
          content: "# Hello",
          sectionCount: 2,
          estimatedSizeBytes: 1234,
        } as never,
        loading: false,
        error: null,
        hasSelectedSession: true,
      },
    });
    const footer = wrapper.find(".preview-footer");
    expect(footer.exists()).toBe(true);
    expect(footer.text()).toContain("2 sections");
    expect(footer.text()).toContain("1234B");
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
