<script setup lang="ts">
import { BtnGroup } from "@tracepilot/ui";
import { computed } from "vue";
import { type ExportTabFormat, FORMAT_DESCRIPTIONS } from "@/composables/useExportConfig";

const props = withDefaults(
  defineProps<{
    modelValue: ExportTabFormat;
    /** Raw Zip copies Copilot's session folder, so other sources can't offer it. */
    zipAvailable?: boolean;
  }>(),
  { zipAvailable: true },
);

const emit = defineEmits<(e: "update:modelValue", value: ExportTabFormat) => void>();

const ALL_FORMAT_OPTIONS: { value: ExportTabFormat; label: string }[] = [
  { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" },
  { value: "zip", label: "Raw Zip" },
];

const formatOptions = computed(() =>
  props.zipAvailable ? ALL_FORMAT_OPTIONS : ALL_FORMAT_OPTIONS.filter((o) => o.value !== "zip"),
);

const value = computed({
  get: () => props.modelValue,
  set: (v: ExportTabFormat) => emit("update:modelValue", v),
});
</script>

<template>
  <section class="config-section">
    <h3 class="config-section-title">Format</h3>
    <BtnGroup v-model="value" :options="formatOptions" />
    <p class="format-desc-text">{{ FORMAT_DESCRIPTIONS[modelValue] }}</p>
    <p v-if="!zipAvailable" class="format-desc-text">
      Raw Zip is available for Copilot sessions only.
    </p>
  </section>
</template>
