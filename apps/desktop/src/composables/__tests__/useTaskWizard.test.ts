import { setupPinia } from "@tracepilot/test-utils";
import type { TaskPreset } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";

// ── Mocks ──────────────────────────────────────────────────────────────
const mockRouterPush = vi.fn();
const mockRouterBack = vi.fn();
let mockRouteQuery: Record<string, string | undefined> = {};

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: mockRouteQuery }),
  useRouter: () => ({ push: mockRouterPush, back: mockRouterBack }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@tracepilot/ui", () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warn: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const presetsStoreMock = {
  loading: false as boolean,
  error: null as string | null,
  enabledPresets: [] as TaskPreset[],
  loadPresets: vi.fn(async () => {}),
};
vi.mock("@/stores/presets", () => ({
  usePresetsStore: () => presetsStoreMock,
}));

const sessionsStoreMock = {
  sessions: [] as Array<{ id: string; summary?: string | null }>,
  fetchSessions: vi.fn(),
};
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => sessionsStoreMock,
}));

type TaskLike = { id: string } | null;
const tasksStoreMock = {
  error: null as string | null,
  createTask: vi.fn<(...args: unknown[]) => Promise<TaskLike>>(async () => ({ id: "task-123" })),
};
vi.mock("@/stores/tasks", () => ({
  useTasksStore: () => tasksStoreMock,
}));

// Import under test AFTER mocks
import { useTaskWizard } from "../useTaskWizard";

const TestHost = defineComponent({
  setup() {
    const wizard = useTaskWizard();
    return { wizard };
  },
  template: "<div />",
});

function makePreset(overrides: Partial<TaskPreset> = {}): TaskPreset {
  return {
    id: "preset-a",
    name: "Preset A",
    description: "desc",
    version: 1,
    builtin: false,
    enabled: true,
    tags: ["tag1"],
    taskType: "analysis",
    prompt: {
      system: "",
      user: "do something",
      variables: [],
    },
    context: { sources: [], maxChars: 0, format: "markdown" },
    output: { schema: {}, format: "json", validation: "none" },
    execution: { modelOverride: null, priority: "normal", maxRetries: 3, timeoutSeconds: 60 },
    createdAt: "",
    updatedAt: "",
    ...overrides,
  } as TaskPreset;
}

describe("useTaskWizard", () => {
  beforeEach(() => {
    setupPinia();
    mockRouterPush.mockReset();
    mockRouterBack.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    presetsStoreMock.loading = false;
    presetsStoreMock.error = null;
    presetsStoreMock.enabledPresets = [];
    presetsStoreMock.loadPresets = vi.fn(async () => {});
    sessionsStoreMock.sessions = [];
    sessionsStoreMock.fetchSessions = vi.fn();
    tasksStoreMock.error = null;
    tasksStoreMock.createTask = vi.fn<(...args: unknown[]) => Promise<TaskLike>>(async () => ({
      id: "task-123",
    }));
    mockRouteQuery = {};
  });

  it("initializes with default wizard state", () => {
    const wrapper = mount(TestHost);
    const w = wrapper.vm.wizard;
    expect(w.currentStep).toBe(1);
    expect(w.highestStep).toBe(1);
    expect(w.selectedPreset).toBeNull();
    expect(w.priority).toBe("normal");
    expect(w.maxRetries).toBe(3);
    expect(w.canAdvanceStep1).toBe(false);
    expect(w.canAdvanceStep2).toBe(true); // no variables required yet
  });

  it("selectPreset seeds form defaults and enables advancing step 1", () => {
    const wrapper = mount(TestHost);
    const w = wrapper.vm.wizard;
    const preset = makePreset({
      prompt: {
        system: "",
        user: "",
        variables: [
          { name: "flag", type: "boolean", required: false, default: "true", description: "" },
          { name: "count", type: "number", required: true, default: "5", description: "" },
          { name: "title", type: "string", required: true, default: null, description: "" },
        ],
      },
      execution: {
        modelOverride: null,
        priority: "high",
        maxRetries: 7,
        timeoutSeconds: 90,
      },
    });
    w.selectPreset(preset);
    expect(w.selectedPreset?.id).toBe("preset-a");
    expect(w.formValues.flag).toBe(true);
    expect(w.formValues.count).toBe(5);
    expect(w.formValues.title).toBe("");
    expect(w.priority).toBe("high");
    expect(w.maxRetries).toBe(7);
    expect(w.canAdvanceStep1).toBe(true);
    // step 2 blocked until required `title` filled
    expect(w.canAdvanceStep2).toBe(false);
    w.formValues.title = "hello";
    expect(w.canAdvanceStep2).toBe(true);
  });

  it("transitions forward and backward through steps", () => {
    const wrapper = mount(TestHost);
    const w = wrapper.vm.wizard;
    // Without preset, goNext is a no-op on step 1
    w.goNext();
    expect(w.currentStep).toBe(1);
    w.selectPreset(makePreset());
    w.goNext();
    expect(w.currentStep).toBe(2);
    expect(w.highestStep).toBe(2);
    w.goNext();
    expect(w.currentStep).toBe(3);
    expect(w.highestStep).toBe(3);
    // goToStep clamps to already-visited steps
    w.goToStep(1);
    expect(w.currentStep).toBe(1);
    // cannot jump forward past current step
    w.goToStep(3);
    expect(w.currentStep).toBe(1);
    // goBack on step 1 delegates to router.back()
    w.goBack();
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("handleSubmit invokes tasks store and routes on success", async () => {
    const wrapper = mount(TestHost);
    const w = wrapper.vm.wizard;
    w.selectPreset(makePreset({ id: "p1", taskType: "summary" }));
    await w.handleSubmit(false);
    expect(tasksStoreMock.createTask).toHaveBeenCalledWith(
      "summary",
      "p1",
      expect.any(Object),
      "normal",
      3,
    );
    expect(toastSuccess).toHaveBeenCalledWith("Task created successfully", expect.any(Object));
    expect(mockRouterPush).toHaveBeenCalledWith({ name: "tasks" });
  });

  it("handleSubmit with navigateToDetail routes to task detail", async () => {
    const wrapper = mount(TestHost);
    const w = wrapper.vm.wizard;
    w.selectPreset(makePreset({ id: "p1", taskType: "" }));
    await w.handleSubmit(true);
    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "task-detail",
      params: { taskId: "task-123" },
    });
  });

  it("handleSubmit reports error toast when store returns null", async () => {
    tasksStoreMock.createTask = vi.fn<(...args: unknown[]) => Promise<TaskLike>>(async () => null);
    tasksStoreMock.error = "boom";
    const wrapper = mount(TestHost);
    const w = wrapper.vm.wizard;
    w.selectPreset(makePreset());
    await w.handleSubmit(false);
    expect(toastError).toHaveBeenCalledWith("boom", expect.any(Object));
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("auto-advances to step 2 when presetId query matches a preset", async () => {
    const preset = makePreset({ id: "auto" });
    presetsStoreMock.enabledPresets = [preset];
    mockRouteQuery = { presetId: "auto" };
    const wrapper = mount(TestHost);
    await nextTick();
    await nextTick();
    const w = wrapper.vm.wizard;
    expect(w.selectedPreset?.id).toBe("auto");
    expect(w.currentStep).toBe(2);
    expect(w.highestStep).toBe(2);
  });
});
