import {
  taskDeletePreset,
  taskGetPreset,
  taskListPresets,
  taskSavePreset,
} from "@tracepilot/client";
import type { TaskPreset } from "@tracepilot/types";
import { runAction, runMutation, useAsyncGuard } from "@tracepilot/ui";
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
    await runAction({
      loading,
      error,
      guard: loadGuard,
      action: () => taskListPresets(),
      onSuccess: (result) => {
        presets.value = result;
      },
    });
  }

  async function getPreset(id: string): Promise<TaskPreset | null> {
    selectedPreset.value = null;
    return runMutation(error, async () => {
      const preset = await taskGetPreset(id);
      selectedPreset.value = preset;
      return preset;
    });
  }

  async function savePreset(preset: TaskPreset): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await taskSavePreset(preset);
      await loadPresets();
      return true as const;
    });
    return ok ?? false;
  }

  async function deletePreset(id: string): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await taskDeletePreset(id);
      presets.value = presets.value.filter((p) => p.id !== id);
      if (selectedPreset.value?.id === id) {
        selectedPreset.value = null;
      }
      return true as const;
    });
    return ok ?? false;
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
