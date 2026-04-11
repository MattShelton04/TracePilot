import {
  taskDeletePreset,
  taskGetPreset,
  taskListPresets,
  taskSavePreset,
} from "@tracepilot/client";
import type { TaskPreset } from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export const usePresetsStore = defineStore("presets", () => {
  // ─── State ────────────────────────────────────────────────────────
  const presets = ref<TaskPreset[]>([]);
  const selectedPreset = ref<TaskPreset | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const filterTag = ref<string>("all");

  const loadGuard = useAsyncGuard();

  // ─── Computed ─────────────────────────────────────────────────────

  const sortedPresets = computed(() =>
    [...presets.value].sort((a, b) => a.name.localeCompare(b.name)),
  );

  const builtinPresets = computed(() => presets.value.filter((p) => p.builtin));
  const customPresets = computed(() => presets.value.filter((p) => !p.builtin));
  const enabledPresets = computed(() => presets.value.filter((p) => p.enabled));

  const allTags = computed(() => {
    const tags = new Set<string>();
    for (const p of presets.value) {
      for (const t of p.tags) tags.add(t);
    }
    return [...tags].sort();
  });

  const filteredPresets = computed(() => {
    let list = sortedPresets.value;

    if (filterTag.value !== "all") {
      list = list.filter((p) => p.tags.includes(filterTag.value));
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q),
      );
    }

    return list;
  });

  // ─── Actions ──────────────────────────────────────────────────────

  async function loadPresets() {
    const token = loadGuard.start();
    loading.value = true;
    error.value = null;
    try {
      const result = await taskListPresets();
      if (!loadGuard.isValid(token)) return;
      presets.value = result;
    } catch (e) {
      if (!loadGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
    } finally {
      if (loadGuard.isValid(token)) loading.value = false;
    }
  }

  async function getPreset(id: string): Promise<TaskPreset | null> {
    error.value = null;
    selectedPreset.value = null;
    try {
      const preset = await taskGetPreset(id);
      selectedPreset.value = preset;
      return preset;
    } catch (e) {
      error.value = toErrorMessage(e);
      return null;
    }
  }

  async function savePreset(preset: TaskPreset): Promise<boolean> {
    error.value = null;
    try {
      await taskSavePreset(preset);
      await loadPresets();
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function deletePreset(id: string): Promise<boolean> {
    error.value = null;
    try {
      await taskDeletePreset(id);
      presets.value = presets.value.filter((p) => p.id !== id);
      if (selectedPreset.value?.id === id) {
        selectedPreset.value = null;
      }
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  return {
    // State
    presets,
    selectedPreset,
    loading,
    error,
    searchQuery,
    filterTag,
    // Computed
    sortedPresets,
    builtinPresets,
    customPresets,
    enabledPresets,
    allTags,
    filteredPresets,
    // Actions
    loadPresets,
    getPreset,
    savePreset,
    deletePreset,
  };
});