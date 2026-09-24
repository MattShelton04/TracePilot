<script setup lang="ts">
/**
 * One reasoning message as display text. The opening heading is left to the
 * caller's preview; later headings become section labels. Stored text is
 * never changed.
 */
import { computed } from "vue";
import { getReasoningSections } from "../utils/reasoning";

const props = defineProps<{ content: string }>();

const sections = computed(() => getReasoningSections(props.content));
</script>

<template>
  <template v-for="(section, index) in sections" :key="index"><span v-if="index > 0 && section.heading" class="reasoning-text__heading">{{ section.heading }}</span>{{ section.body }}</template>
</template>

<style scoped>
.reasoning-text__heading {
  display: block;
  margin-top: 10px;
  font-weight: 600;
  color: var(--text-primary);
}
</style>
