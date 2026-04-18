import type { TaskPreset } from "@tracepilot/types";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const savePresetMock = vi.fn();
const deletePresetMock = vi.fn();
const storeStub = {
  presets: [] as TaskPreset[],
  filteredPresets: [] as TaskPreset[],
  builtinPresets: [] as TaskPreset[],
  customPresets: [] as TaskPreset[],
  enabledPresets: [] as TaskPreset[],
  allTags: [] as string[],
  searchQuery: "",
  filterTag: "all",
  loading: false,
  error: null as string | null,
  loadPresets: vi.fn(),
  savePreset: savePresetMock,
  deletePreset: deletePresetMock,
};

vi.mock("@/stores/presets", () => ({
  usePresetsStore: () => storeStub,
}));

const routerPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { usePresetManager } from "../usePresetManager";

function makePreset(overrides: Partial<TaskPreset> = {}): TaskPreset {
  return {
    id: "p1",
    name: "Preset One",
    description: "",
    version: 1,
    builtin: false,
    enabled: true,
    tags: ["a", "b"],
    taskType: "analysis",
    prompt: { system: "", user: "", variables: [] },
    context: { sources: [], maxChars: 0, format: "markdown" },
    output: { schema: {}, format: "json", validation: "none" },
    execution: { modelOverride: null, priority: "normal", maxRetries: 1, timeoutSeconds: 30 },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as TaskPreset;
}

beforeEach(() => {
  setActivePinia(createPinia());
  savePresetMock.mockReset().mockResolvedValue(true);
  deletePresetMock.mockReset().mockResolvedValue(true);
  routerPush.mockReset();
  storeStub.presets = [];
  storeStub.filteredPresets = [];
  storeStub.error = null;
});

describe("usePresetManager", () => {
  it("filters by category and sorts by name by default", () => {
    const builtin = makePreset({ id: "b1", name: "Alpha", builtin: true });
    const custom = makePreset({ id: "c1", name: "Beta", builtin: false });
    storeStub.filteredPresets = [custom, builtin];
    const mgr = usePresetManager();
    expect(mgr.displayPresets.map((p) => p.id)).toEqual(["c1", "b1"]);
    mgr.categoryFilter = "builtin";
    expect(mgr.displayPresets.map((p) => p.id)).toEqual(["b1"]);
    mgr.categoryFilter = "custom";
    expect(mgr.displayPresets.map((p) => p.id)).toEqual(["c1"]);
  });

  it("sorts by newest when sortBy changes", () => {
    const older = makePreset({ id: "o", createdAt: "2026-01-01T00:00:00Z" });
    const newer = makePreset({ id: "n", createdAt: "2026-05-01T00:00:00Z" });
    storeStub.filteredPresets = [older, newer];
    const mgr = usePresetManager();
    mgr.sortBy = "newest";
    expect(mgr.displayPresets.map((p) => p.id)).toEqual(["n", "o"]);
  });

  it("delete flow: confirm → handleDelete clears state and calls store", async () => {
    const preset = makePreset();
    const mgr = usePresetManager();
    mgr.confirmDelete(preset);
    expect(mgr.showDeleteConfirm).toBe(true);
    expect(mgr.presetToDelete).toEqual(preset);
    await mgr.handleDelete();
    expect(deletePresetMock).toHaveBeenCalledWith("p1");
    expect(mgr.showDeleteConfirm).toBe(false);
    expect(mgr.presetToDelete).toBe(null);
  });

  it("openEditModal clones preset so edits don't mutate original", async () => {
    const original = makePreset();
    const mgr = usePresetManager();
    mgr.openEditModal(original);
    await nextTick();
    expect(mgr.showEditModal).toBe(true);
    expect(mgr.editingPreset).not.toBe(original);
    mgr.editingPreset!.name = "Changed";
    expect(original.name).toBe("Preset One");
  });

  it("runTask pushes route with presetId", () => {
    const mgr = usePresetManager();
    mgr.runTask(makePreset({ id: "xyz" }));
    expect(routerPush).toHaveBeenCalledWith({ path: "/tasks/new", query: { presetId: "xyz" } });
  });

  it("taskTypeColorClass maps known types", () => {
    const mgr = usePresetManager();
    expect(mgr.taskTypeColorClass("review")).toBe("type-color-success");
    expect(mgr.taskTypeColorClass("health")).toBe("type-color-danger");
    expect(mgr.taskTypeColorClass("unknown")).toBe("type-color-accent");
  });
});
