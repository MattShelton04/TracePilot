<script setup lang="ts">
import ExpandChevron from "./ExpandChevron.vue";

defineProps<{
  /** Reasoning text blocks to display. */
  reasoning: string[];
  /** Whether the content is currently expanded. */
  expanded: boolean;
}>();

defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <div v-if="reasoning.length > 0" class="reasoning-block">
    <button
      class="reasoning-toggle"
      :aria-expanded="expanded"
      @click="$emit('toggle')"
    >
      <ExpandChevron :expanded="expanded" />
      <slot name="prefix" />
      💭 {{ reasoning.length }} reasoning block{{ reasoning.length !== 1 ? "s" : "" }}
    </button>
    <div v-if="expanded" class="reasoning-content" tabindex="0">
      <template v-for="(text, rIdx) in reasoning" :key="rIdx">
        <hr v-if="rIdx > 0" class="reasoning-divider" />
        {{ text }}
      </template>
    </div>
  </div>
</template>
