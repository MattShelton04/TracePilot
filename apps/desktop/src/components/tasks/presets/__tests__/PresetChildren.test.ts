import type { TaskPreset } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeletePresetConfirm from "../DeletePresetConfirm.vue";
import EditPresetModal from "../EditPresetModal.vue";
import NewPresetModal from "../NewPresetModal.vue";
import PresetFilterBar from "../PresetFilterBar.vue";
import PresetGrid from "../PresetGrid.vue";
import PresetList from "../PresetList.vue";
import PresetStatsStrip from "../PresetStatsStrip.vue";

vi.mock("@/stores/presets", () => ({
  usePresetsStore: () => ({
    presets: [] as TaskPreset[],
    error: null,
    savePreset: vi.fn().mockResolvedValue(true),
  }),
}));

function makePreset(overrides: Partial<TaskPreset> = {}): TaskPreset {
  return {
    id: "p1",
    name: "Preset One",
    description: "desc",
    version: 1,
    builtin: false,
    enabled: true,
    tags: ["alpha", "beta"],
    taskType: "analysis",
    prompt: { system: "", user: "", variables: [] },
    context: { sources: [], maxChars: 0, format: "markdown" },
    output: { schema: {}, format: "json", validation: "none" },
    execution: { modelOverride: null, priority: "normal", maxRetries: 3, timeoutSeconds: 60 },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  } as TaskPreset;
}

const helperProps = {
  contextSourceCount: (p: TaskPreset) => p.context?.sources?.length ?? 0,
  variableCount: (p: TaskPreset) => p.prompt?.variables?.length ?? 0,
  truncate: (t: string, m: number) => (t.length <= m ? t : `${t.slice(0, m)}…`),
  displayTags: (tags: string[]) =>
    tags.length <= 3 ? { visible: tags, extra: 0 } : { visible: tags.slice(0, 3), extra: tags.length - 3 },
  taskTypeColorClass: () => "type-color-accent",
  infoLine: () => "—",
};

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("PresetStatsStrip", () => {
  it("renders counts", () => {
    const wrapper = mount(PresetStatsStrip, {
      props: { total: 12, builtin: 4, custom: 8, enabled: 10 },
    });
    expect(wrapper.text()).toContain("12 Total");
    expect(wrapper.text()).toContain("4 Builtin");
    expect(wrapper.text()).toContain("8 Custom");
    expect(wrapper.text()).toContain("10 Enabled");
  });
});

describe("PresetFilterBar", () => {
  it("emits update events from search input and view toggle", async () => {
    const wrapper = mount(PresetFilterBar, {
      props: {
        searchQuery: "",
        filterTag: "all",
        allTags: ["alpha"],
        sortBy: "name",
        viewMode: "grid",
        categoryFilter: "all",
      },
      global: {
        stubs: { SegmentedControl: { template: "<div class='seg' />" } },
      },
    });
    await wrapper.find(".search-input").setValue("hello");
    expect(wrapper.emitted("update:searchQuery")?.[0]).toEqual(["hello"]);
    const listBtn = wrapper.findAll(".view-toggle__btn")[1]!;
    await listBtn.trigger("click");
    expect(wrapper.emitted("update:viewMode")?.[0]).toEqual(["list"]);
  });
});

describe("PresetGrid", () => {
  it("renders preset cards and emits run on click", async () => {
    const presets = [makePreset({ id: "a" }), makePreset({ id: "b", name: "Second" })];
    const wrapper = mount(PresetGrid, {
      props: { presets, ...helperProps },
    });
    expect(wrapper.findAll(".preset-card")).toHaveLength(2);
    const runBtn = wrapper.findAll(".preset-card__actions .btn--accent")[0]!;
    await runBtn.trigger("click");
    expect(wrapper.emitted("run")?.[0]?.[0]).toMatchObject({ id: "a" });
  });
});

describe("PresetList", () => {
  it("renders rows and emits open-detail on row click", async () => {
    const presets = [makePreset({ id: "a" })];
    const wrapper = mount(PresetList, {
      props: {
        presets,
        contextSourceCount: helperProps.contextSourceCount,
        displayTags: helperProps.displayTags,
        taskTypeColorClass: helperProps.taskTypeColorClass,
      },
    });
    expect(wrapper.findAll(".preset-list__row")).toHaveLength(1);
    await wrapper.find(".preset-list__row").trigger("click");
    expect(wrapper.emitted("open-detail")).toBeTruthy();
  });
});

describe("DeletePresetConfirm", () => {
  it("renders when open and emits confirm/cancel", async () => {
    const preset = makePreset();
    const wrapper = mount(DeletePresetConfirm, {
      props: { open: true, preset },
      attachTo: document.body,
    });
    expect(wrapper.text()).toContain("Preset One");
    await wrapper.find(".btn--danger").trigger("click");
    expect(wrapper.emitted("confirm")).toBeTruthy();
    await wrapper.find(".btn--secondary").trigger("click");
    expect(wrapper.emitted("cancel")).toBeTruthy();
    wrapper.unmount();
  });

  it("closes on Escape keydown (keyboard navigation)", async () => {
    const wrapper = mount(DeletePresetConfirm, {
      props: { open: true, preset: makePreset() },
      attachTo: document.body,
    });
    await wrapper.find(".preset-modal-overlay").trigger("keydown.escape");
    expect(wrapper.emitted("cancel")).toBeTruthy();
    wrapper.unmount();
  });

  it("does not render when closed", () => {
    const wrapper = mount(DeletePresetConfirm, {
      props: { open: false, preset: null },
    });
    expect(wrapper.find(".preset-modal-overlay").exists()).toBe(false);
  });
});

describe("NewPresetModal", () => {
  it("renders inputs and disables Create when name is blank", async () => {
    const wrapper = mount(NewPresetModal, {
      props: { open: true },
      attachTo: document.body,
    });
    const createBtn = wrapper
      .findAll(".btn--primary")
      .find((b) => b.text().includes("Create"))!;
    expect((createBtn.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.find('input[type="text"]').setValue("My Preset");
    expect((createBtn.element as HTMLButtonElement).disabled).toBe(false);
    wrapper.unmount();
  });

  it("emits update:open=false on Escape keydown", async () => {
    const wrapper = mount(NewPresetModal, {
      props: { open: true },
      attachTo: document.body,
    });
    await wrapper.find(".preset-modal-overlay").trigger("keydown.escape");
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    wrapper.unmount();
  });
});

describe("EditPresetModal", () => {
  it("renders fields for the provided preset and emits save", async () => {
    const preset = makePreset();
    const wrapper = mount(EditPresetModal, {
      props: { open: true, preset, saving: false },
      attachTo: document.body,
    });
    expect(wrapper.text()).toContain("Edit: Preset One");
    const saveBtn = wrapper
      .findAll(".btn--primary")
      .find((b) => b.text().includes("Save"))!;
    await saveBtn.trigger("click");
    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({ id: "p1" });
    wrapper.unmount();
  });

  it("adds a context source when Add Source is clicked", async () => {
    const preset = makePreset();
    const wrapper = mount(EditPresetModal, {
      props: { open: true, preset, saving: false },
      attachTo: document.body,
    });
    expect(preset.context.sources).toHaveLength(0);
    const addBtn = wrapper.findAll("button").find((b) => b.text().includes("Add Source"))!;
    await addBtn.trigger("click");
    expect(preset.context.sources).toHaveLength(1);
    wrapper.unmount();
  });
});
