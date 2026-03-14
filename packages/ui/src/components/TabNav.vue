<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { computed } from 'vue';

const props = defineProps<{
  tabs: Array<{ name: string; routeName: string; label: string; count?: number }>;
}>();

const route = useRoute();
const router = useRouter();

const activeTab = computed(() => route.name as string);

function navigate(routeName: string) {
  router.push({ name: routeName, params: route.params });
}
</script>
<template>
  <nav class="flex gap-1 border-b-2 border-[var(--color-border-default)] pb-0" aria-label="Session tabs">
    <button
      v-for="tab in tabs"
      :key="tab.name"
      :aria-current="activeTab === tab.routeName ? 'page' : undefined"
      class="relative px-4 py-2.5 text-sm font-semibold transition-colors -mb-[2px] rounded-t-md hover:bg-[var(--color-sidebar-hover)]"
      :class="activeTab === tab.routeName
        ? 'text-[var(--color-text-primary)] border-b-2 border-[var(--color-accent-fg)] bg-[var(--color-canvas-default)]'
        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border-b-2 border-transparent'"
      @click="navigate(tab.routeName)"
    >
      {{ tab.label }}
      <span
        v-if="tab.count != null"
        class="ml-2 inline-flex items-center justify-center rounded-full bg-[var(--color-neutral-muted)] px-1.5 py-0 text-[11px] font-medium text-[var(--color-text-secondary)] min-w-[18px]"
      >
        {{ tab.count }}
      </span>
    </button>
  </nav>
</template>
