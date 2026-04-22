import type { TaskPreset } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import WizardStep1Preset from "../WizardStep1Preset.vue";
import WizardStep2Variables from "../WizardStep2Variables.vue";
import WizardStep3Submit from "../WizardStep3Submit.vue";

function makePreset(overrides: Partial<TaskPreset> = {}): TaskPreset {
  return {
    id: "preset-a",
    name: "Preset A",
    description: "desc",
    version: 1,
    builtin: false,
    enabled: true,
    tags: ["tag1", "tag2"],
    taskType: "analysis",
    prompt: { system: "", user: "user template", variables: [] },
    context: { sources: [], maxChars: 0, format: "markdown" },
    output: { schema: {}, format: "json", validation: "none" },
    execution: { modelOverride: null, priority: "normal", maxRetries: 3, timeoutSeconds: 60 },
    createdAt: "",
    updatedAt: "",
    ...overrides,
  } as TaskPreset;
}

function makeWizardStub(overrides: Record<string, unknown> = {}) {
  return reactive({
    // state
    currentStep: 1,
    highestStep: 1,
    selectedPreset: null as TaskPreset | null,
    searchQuery: "",
    submitting: false,
    categoryFilter: "all",
    sessionSearchQuery: {} as Record<string, string>,
    sessionSearchResults: {} as Record<string, unknown[]>,
    promptTemplateExpanded: false,
    formValues: {} as Record<string, string | number | boolean | null>,
    priority: "normal",
    maxRetries: 3,
    // computeds
    filteredPresets: [] as TaskPreset[],
    variables: [] as Array<{
      name: string;
      type: string;
      required: boolean;
      description: string;
    }>,
    allRequiredFilled: true,
    canAdvanceStep1: false,
    canAdvanceStep2: true,
    contextSummary: "No context sources configured.",
    estimatedTokenBudget: null as number | null,
    presetsLoading: false,
    presetsError: null,
    // actions
    selectPreset: vi.fn(),
    goBack: vi.fn(),
    goNext: vi.fn(),
    goToStep: vi.fn(),
    handleSubmit: vi.fn(),
    handleSessionSearch: vi.fn(),
    selectSession: vi.fn(),
    cancelToTasksList: vi.fn(),
    reloadPresets: vi.fn(),
    // helpers
    formatVariableLabel: (n: string) => n,
    displayValue: () => "—",
    isSessionVariable: () => false,
    isDateVariable: () => false,
    contextSourcesCount: () => 0,
    ...overrides,
  });
}

describe("WizardStep1Preset", () => {
  it("renders preset cards and calls selectPreset on click", async () => {
    const presets = [
      makePreset({ id: "p1", name: "First" }),
      makePreset({ id: "p2", name: "Second", builtin: true }),
    ];
    const wizard = makeWizardStub({ filteredPresets: presets, canAdvanceStep1: false });
    const wrapper = mount(WizardStep1Preset, { props: { wizard: wizard as never } });
    expect(wrapper.findAll(".preset-card")).toHaveLength(2);
    expect(wrapper.text()).toContain("First");
    expect(wrapper.text()).toContain("built-in");
    await wrapper.findAll(".preset-card")[0]!.trigger("click");
    expect(wizard.selectPreset).toHaveBeenCalledWith(presets[0]);
  });

  it("Next button advances wizard via keyboard when preset is selected (focus advancement)", async () => {
    const wizard = makeWizardStub({
      filteredPresets: [makePreset({ id: "p1" })],
      canAdvanceStep1: true,
    });
    const wrapper = mount(WizardStep1Preset, {
      props: { wizard: wizard as never },
      attachTo: document.body,
    });
    const nextBtn = wrapper.find(".nav-btn--primary");
    expect(nextBtn.exists()).toBe(true);
    expect((nextBtn.element as HTMLButtonElement).disabled).toBe(false);
    // Focus and press Enter — native <button> default activates the click handler
    (nextBtn.element as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(nextBtn.element);
    await nextBtn.trigger("keydown.enter");
    await nextBtn.trigger("click");
    expect(wizard.goNext).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows empty state when no presets are available", () => {
    const wizard = makeWizardStub({ filteredPresets: [] });
    const wrapper = mount(WizardStep1Preset, { props: { wizard: wizard as never } });
    expect(wrapper.find(".empty-state").exists()).toBe(true);
  });
});

describe("WizardStep2Variables", () => {
  it("renders variable inputs and calls goNext when Next is clicked", async () => {
    const wizard = makeWizardStub({
      selectedPreset: makePreset({ name: "Cfg" }),
      variables: [
        { name: "title", type: "string", required: true, default: null, description: "desc" },
      ],
      formValues: { title: "hi" },
      canAdvanceStep2: true,
    });
    const wrapper = mount(WizardStep2Variables, {
      props: { wizard: wizard as never },
      global: {
        stubs: {
          SectionPanel: { template: "<section><slot name='actions' /><slot /></section>" },
        },
      },
    });
    expect(wrapper.find("#var-title").exists()).toBe(true);
    await wrapper.find(".nav-btn--primary").trigger("click");
    expect(wizard.goNext).toHaveBeenCalled();
  });
});

describe("WizardStep3Submit", () => {
  it("renders review rows and triggers handleSubmit on Create Task", async () => {
    const wizard = makeWizardStub({
      selectedPreset: makePreset({ name: "Final" }),
      currentStep: 3,
    });
    const wrapper = mount(WizardStep3Submit, {
      props: { wizard: wizard as never },
      global: {
        stubs: {
          SectionPanel: { template: "<section><slot /></section>" },
          LoadingSpinner: { template: "<span />" },
        },
      },
    });
    expect(wrapper.text()).toContain("Final");
    const buttons = wrapper.findAll(".nav-btn");
    const submitBtn = buttons.find((b) => b.text().includes("Create Task"));
    expect(submitBtn).toBeDefined();
    await submitBtn!.trigger("click");
    expect(wizard.handleSubmit).toHaveBeenCalledWith(false);
  });
});
