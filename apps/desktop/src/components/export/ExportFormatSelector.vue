<script setup lang="ts">
import { BtnGroup } from "@tracepilot/ui";
import { computed } from "vue";
import { type ExportTabFormat, FORMAT_DESCRIPTIONS } from "@/composables/useExportConfig";

const props = defineProps<{
  modelValue: ExportTabFormat;
}>();

const emit = defineEmits<(e: "update:modelValue", value: ExportTabFormat) => void>();

const formatOptions: { value: ExportTabFormat; label: string }[] = [
  { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" },
  { value: "csv", label: "CSV" },
  { value: "zip", label: "Raw Zip" },
];

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
  </section>
</template>
