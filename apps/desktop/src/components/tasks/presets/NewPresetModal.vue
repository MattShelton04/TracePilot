<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import { computed, ref, watch } from "vue";
import { usePresetsStore } from "@/stores/presets";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
}>();

const store = usePresetsStore();

const newPresetName = ref("");
const newPresetDesc = ref("");
const newPresetTags = ref("");
const creating = ref(false);

const presetId = computed(() =>
  newPresetName.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
);

function close() {
  emit("update:open", false);
}

watch(
  () => props.open,
  (v) => {
    if (!v) {
      newPresetName.value = "";
      newPresetDesc.value = "";
      newPresetTags.value = "";
    }
  },
);

async function handleCreatePreset() {
  if (!newPresetName.value.trim() || !presetId.value) return;

  const existing = store.presets.find((p) => p.id === presetId.value);
  if (existing) {
    store.setError(`A preset with ID "${presetId.value}" already exists.`);
    return;
  }

  creating.value = true;

  const now = new Date().toISOString();
  const tags = newPresetTags.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const preset: TaskPreset = {
    id: presetId.value,
    name: newPresetName.value.trim(),
    taskType: presetId.value,
    description: newPresetDesc.value.trim(),
    version: 1,
    prompt: { system: "", user: "", variables: [] },
    context: { sources: [], maxChars: 8000, format: "markdown" },
    output: { schema: {}, format: "markdown", validation: "warn" },
    execution: {
      modelOverride: null,
      timeoutSeconds: 120,
      maxRetries: 2,
      priority: "normal",
    },
    tags,
    enabled: true,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };

  const ok = await store.savePreset(preset);
  creating.value = false;
  if (ok) close();
}
</script>

<template>
  <div
    v-if="open"
    class="preset-modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Create new preset"
    tabindex="-1"
    @click.self="close"
    @keydown.escape="close"
  >
    <div class="preset-modal">
      <div class="preset-modal__header">
        <h3 class="preset-modal__title">New Preset</h3>
        <button class="preset-modal__close" @click="close">✕</button>
      </div>
      <div class="preset-modal__body">
        <label class="preset-modal__label">Name</label>
        <input
          v-model="newPresetName"
          class="preset-modal__input"
          type="text"
          placeholder="My Analysis Preset"
          @keydown.enter="handleCreatePreset"
        />
        <p
          v-if="newPresetName.length > 0 && !newPresetName.trim()"
          class="preset-modal__validation-hint"
        >
          Name cannot be blank
        </p>

        <label class="preset-modal__label">
          ID
          <span class="preset-modal__optional">(auto-generated)</span>
        </label>
        <input
          class="preset-modal__input preset-modal__input--readonly"
          type="text"
          :value="presetId || '—'"
          readonly
        />

        <label class="preset-modal__label">
          Description
          <span class="preset-modal__optional">(optional)</span>
        </label>
        <textarea
          v-model="newPresetDesc"
          class="preset-modal__textarea"
          rows="3"
          placeholder="What does this preset do?"
        />

        <label class="preset-modal__label">
          Tags
          <span class="preset-modal__optional">(comma-separated)</span>
        </label>
        <input
          v-model="newPresetTags"
          class="preset-modal__input"
          type="text"
          placeholder="analysis, review, health"
        />

        <p class="preset-modal__hint">
          Creates a preset with sensible defaults. You can fully customise
          prompt, context, and output settings later.
        </p>
      </div>
      <div class="preset-modal__footer">
        <button class="btn btn--secondary" @click="close">Cancel</button>
        <button
          class="btn btn--primary"
          :disabled="!newPresetName.trim() || !presetId || creating"
          @click="handleCreatePreset"
        >
          {{ creating ? "Creating…" : "Create" }}
        </button>
      </div>
    </div>
  </div>
</template>
