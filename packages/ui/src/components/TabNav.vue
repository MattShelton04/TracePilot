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
  <nav class="flex gap-1 border-b border-[var(--color-border-default)]" aria-label="Session tabs">
    <button
      v-for="tab in tabs"
      :key="tab.name"
      :aria-current="activeTab === tab.routeName ? 'page' : undefined"
      class="relative px-3 py-2 text-sm font-medium transition-colors -mb-px rounded-t-md hover:bg-[var(--color-sidebar-hover)]"
      :class="activeTab === tab.routeName
        ? 'text-[var(--color-text-primary)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[var(--color-accent-fg)] after:rounded-full'
        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'"
      @click="navigate(tab.routeName)"
    >
      {{ tab.label }}
      <span
        v-if="tab.count != null"
        class="ml-1.5 inline-flex items-center justify-center rounded-full bg-[var(--color-neutral-muted)] px-1.5 py-0 text-[11px] font-medium text-[var(--color-text-secondary)] min-w-[18px]"
      >
        {{ tab.count }}
      </span>
    </button>
  </nav>
</template>
