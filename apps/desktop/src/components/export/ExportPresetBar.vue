<script setup lang="ts">
import { computed, ref } from "vue";
import type { ExportPreset } from "@/composables/useExportConfig";

const props = defineProps<{
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

// Custom presets come after the built-in ones in `allPresets`.
const isCustom = (preset: ExportPreset) => props.customPresets.some((c) => c.id === preset.id);
const builtInPresets = computed(() => props.allPresets.filter((p) => !isCustom(p)));
const savedPresets = computed(() => props.allPresets.filter(isCustom));
</script>

<template>
  <div>
    <div class="preset-bar">
      <button
        v-for="preset in builtInPresets"
        :key="preset.id"
        type="button"
        class="preset-btn"
        :class="{ active: activePreset === preset.id }"
        :title="preset.description"
        @click="emit('apply', preset.id)"
      >
        <span>{{ preset.icon }}</span>
        {{ preset.label }}
      </button>
      <!-- A custom preset's pill holds two sibling buttons, apply and delete,
           so each is reachable by keyboard without nesting one in the other. -->
      <span
        v-for="preset in savedPresets"
        :key="preset.id"
        class="preset-btn preset-custom"
        :class="{ active: activePreset === preset.id }"
      >
        <button
          type="button"
          class="preset-custom-apply"
          :title="preset.description"
          @click="emit('apply', preset.id)"
        >
          <span>{{ preset.icon }}</span>
          {{ preset.label }}
        </button>
        <button
          type="button"
          class="preset-delete"
          title="Delete custom preset"
          :aria-label="`Delete preset ${preset.label}`"
          @click="emit('delete', preset.id)"
        >×</button>
      </span>
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

<style scoped>
/* The pill keeps .preset-btn's look; its two buttons share the padding. */
.preset-btn.preset-custom {
  gap: 0;
  padding: 0;
  cursor: default;
}
.preset-custom-apply,
.preset-custom .preset-delete {
  display: inline-flex;
  align-items: center;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.preset-custom-apply {
  gap: 6px;
  padding: 5px 0 5px 14px;
  border-radius: var(--radius-full) 0 0 var(--radius-full);
}
.preset-custom .preset-delete {
  margin-left: 0;
  padding: 5px 14px 5px 8px;
  font-size: 0.875rem;
  line-height: 1;
  border-radius: 0 var(--radius-full) var(--radius-full) 0;
}
.preset-custom .preset-delete:focus-visible {
  opacity: 1;
}
</style>
