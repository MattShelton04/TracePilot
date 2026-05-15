<script setup lang="ts">
import { ref } from "vue";
import type { ExportPreset } from "@/composables/useExportConfig";

defineProps<{
  allPresets: readonly ExportPreset[];
  customPresets: readonly ExportPreset[];
  activePreset: string | null;
}>();

const emit = defineEmits<{
  (e: "apply", presetId: string): void;
  (e: "delete", presetId: string): void;
  (e: "save", name: string): void;
}>();

const showSavePreset = ref(false);
const newPresetName = ref("");

function handleSave() {
  const name = newPresetName.value.trim();
  if (!name) return;
  emit("save", name);
  newPresetName.value = "";
  showSavePreset.value = false;
}

function toggleSaveRow() {
  showSavePreset.value = !showSavePreset.value;
}
</script>

<template>
  <div>
    <div class="preset-bar">
      <button
        v-for="preset in allPresets"
        :key="preset.id"
        class="preset-btn"
        :class="{ active: activePreset === preset.id }"
        :title="preset.description"
        @click="emit('apply', preset.id)"
      >
        <span>{{ preset.icon }}</span>
        {{ preset.label }}
        <span
          v-if="customPresets.some((c) => c.id === preset.id)"
          class="preset-delete"
          title="Delete custom preset"
          @click.stop="emit('delete', preset.id)"
        >×</span>
      </button>
      <button
        class="preset-btn preset-save-btn"
        title="Save current configuration as a preset"
        @click="toggleSaveRow"
      >
        <span>💾</span>
        Save Preset
      </button>
    </div>
    <div v-if="showSavePreset" class="save-preset-row">
      <input
        v-model="newPresetName"
        class="save-preset-input"
        placeholder="Preset name…"
        @keyup.enter="handleSave"
      />
      <button class="btn btn-primary btn-sm" :disabled="!newPresetName.trim()" @click="handleSave">
        Save
      </button>
      <button class="btn btn-sm" @click="showSavePreset = false">Cancel</button>
    </div>
  </div>
</template>
