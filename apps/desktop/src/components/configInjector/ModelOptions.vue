<script setup lang="ts">
/**
 * `<optgroup>`s of registry models by tier, for a native `<select>`. When the
 * selected model is one the registry doesn't list (a newer or custom model),
 * it gets an "Other" group, so the select shows it rather than going blank.
 */
import { getAllModelIds, getModelsByTier } from "@tracepilot/types";
import { computed } from "vue";

const props = defineProps<{ current?: string | null }>();

const ALL_MODELS = new Set(getAllModelIds());
const PREMIUM_MODELS = getModelsByTier("premium").map((m) => m.id);
const STANDARD_MODELS = getModelsByTier("standard").map((m) => m.id);
const FAST_MODELS = getModelsByTier("fast").map((m) => m.id);

const unlisted = computed(() =>
  props.current && !ALL_MODELS.has(props.current) ? props.current : null,
);
</script>

<template>
  <optgroup label="Premium">
    <option v-for="m in PREMIUM_MODELS" :key="m" :value="m">{{ m }}</option>
  </optgroup>
  <optgroup label="Standard">
    <option v-for="m in STANDARD_MODELS" :key="m" :value="m">{{ m }}</option>
  </optgroup>
  <optgroup label="Fast / Cheap">
    <option v-for="m in FAST_MODELS" :key="m" :value="m">{{ m }}</option>
  </optgroup>
  <optgroup v-if="unlisted" label="Other">
    <option :value="unlisted">{{ unlisted }}</option>
  </optgroup>
</template>
