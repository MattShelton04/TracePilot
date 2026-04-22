import type { TaskPreset } from "@tracepilot/types";
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { usePresetsStore } from "@/stores/presets";

export type PresetViewMode = "grid" | "list";
export type PresetCategoryFilter = "all" | "builtin" | "custom";
export type PresetSortBy = "name" | "newest" | "most-used";

export function usePresetManager() {
  const store = usePresetsStore();
  const router = useRouter();

  // ── Filter / sort / view state ──────────────────────────────
  const viewMode = ref<PresetViewMode>("grid");
  const categoryFilter = ref<PresetCategoryFilter>("all");
  const sortBy = ref<PresetSortBy>("name");

  // ── Modal / detail visibility ───────────────────────────────
  const showNewPresetModal = ref(false);
  const showEditModal = ref(false);
  const showDeleteConfirm = ref(false);
  const editingPreset = ref<TaskPreset | null>(null);
  const presetToDelete = ref<TaskPreset | null>(null);
  const detailPreset = ref<TaskPreset | null>(null);
  const showDetail = ref(false);
  const saving = ref(false);

  // ── Derived lists ───────────────────────────────────────────
  const categoryFilteredPresets = computed(() => {
    const list = store.filteredPresets;
    if (categoryFilter.value === "builtin") return list.filter((p) => p.builtin);
    if (categoryFilter.value === "custom") return list.filter((p) => !p.builtin);
    return list;
  });

  const displayPresets = computed(() => {
    const list = [...categoryFilteredPresets.value];
    switch (sortBy.value) {
      case "newest":
        return list.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      case "most-used":
        return list.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
      default:
        return list;
    }
  });

  // ── Display helpers (shared across grid + list children) ────
  function contextSourceCount(preset: TaskPreset): number {
    return preset.context?.sources?.length ?? 0;
  }

  function variableCount(preset: TaskPreset): number {
    return preset.prompt?.variables?.length ?? 0;
  }

  function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…`;
  }

  function displayTags(tags: string[]): { visible: string[]; extra: number } {
    if (tags.length <= 3) return { visible: tags, extra: 0 };
    return { visible: tags.slice(0, 3), extra: tags.length - 3 };
  }

  function taskTypeColorClass(taskType: string): string {
    const classes: Record<string, string> = {
      analysis: "type-color-accent",
      review: "type-color-success",
      generation: "type-color-warning",
      health: "type-color-danger",
      summary: "type-color-info",
    };
    const key = taskType.toLowerCase();
    for (const [k, v] of Object.entries(classes)) {
      if (key.includes(k)) return v;
    }
    return "type-color-accent";
  }

  function infoLine(preset: TaskPreset): string {
    const sources = contextSourceCount(preset);
    const vars = variableCount(preset);
    const parts: string[] = [];
    if (sources > 0) parts.push(`${sources} source${sources !== 1 ? "s" : ""}`);
    if (vars > 0) parts.push(`${vars} var${vars !== 1 ? "s" : ""}`);
    return parts.join(" · ") || "No sources or vars";
  }

  // ── Actions ─────────────────────────────────────────────────
  function runTask(preset: TaskPreset) {
    pushRoute(router, ROUTE_NAMES.taskCreate, { query: { presetId: preset.id } });
  }

  async function duplicatePreset(preset: TaskPreset) {
    const now = new Date().toISOString();
    const copy: TaskPreset = {
      ...JSON.parse(JSON.stringify(preset)),
      id: `${preset.id}-copy-${Date.now()}`,
      name: `${preset.name} (Copy)`,
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };
    await store.savePreset(copy);
  }

  async function togglePreset(preset: TaskPreset) {
    await store.savePreset({ ...preset, enabled: !preset.enabled });
  }

  // ── Detail slide-over ───────────────────────────────────────
  function openDetail(preset: TaskPreset) {
    detailPreset.value = preset;
    showDetail.value = true;
  }

  function closeDetail() {
    showDetail.value = false;
    detailPreset.value = null;
  }

  // ── Delete flow ─────────────────────────────────────────────
  function confirmDelete(preset: TaskPreset) {
    presetToDelete.value = preset;
    showDeleteConfirm.value = true;
  }

  function cancelDelete() {
    showDeleteConfirm.value = false;
    presetToDelete.value = null;
  }

  async function handleDelete() {
    if (!presetToDelete.value) return;
    const ok = await store.deletePreset(presetToDelete.value.id);
    if (ok) {
      showDeleteConfirm.value = false;
      presetToDelete.value = null;
    }
  }

  // ── New preset flow ─────────────────────────────────────────
  function openNewPresetModal() {
    store.error = null;
    showNewPresetModal.value = true;
  }

  function closeNewPresetModal() {
    showNewPresetModal.value = false;
  }

  // ── Edit flow ───────────────────────────────────────────────
  function openEditModal(preset: TaskPreset) {
    store.error = null;
    editingPreset.value = JSON.parse(JSON.stringify(preset));
    showEditModal.value = true;
  }

  function closeEditModal() {
    showEditModal.value = false;
    editingPreset.value = null;
  }

  async function handleSaveEdit(preset: TaskPreset) {
    saving.value = true;
    preset.updatedAt = new Date().toISOString();
    const ok = await store.savePreset(preset);
    saving.value = false;
    if (ok) closeEditModal();
  }

  return reactive({
    // store passthrough for convenience
    store,
    // state
    viewMode,
    categoryFilter,
    sortBy,
    showNewPresetModal,
    showEditModal,
    showDeleteConfirm,
    editingPreset,
    presetToDelete,
    detailPreset,
    showDetail,
    saving,
    // computeds
    displayPresets,
    categoryFilteredPresets,
    // helpers
    contextSourceCount,
    variableCount,
    truncate,
    displayTags,
    taskTypeColorClass,
    infoLine,
    // actions
    runTask,
    duplicatePreset,
    togglePreset,
    openDetail,
    closeDetail,
    confirmDelete,
    cancelDelete,
    handleDelete,
    openNewPresetModal,
    closeNewPresetModal,
    openEditModal,
    closeEditModal,
    handleSaveEdit,
  });
}

export type PresetManager = ReturnType<typeof usePresetManager>;
