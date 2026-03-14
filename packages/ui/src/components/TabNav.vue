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
  <nav class="flex border-b border-[var(--border)] mb-4">
    <button
      v-for="tab in tabs"
      :key="tab.name"
      class="px-4 py-2 text-sm font-medium transition-colors -mb-px"
      :class="activeTab === tab.routeName
        ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]'
        : 'text-[var(--text-muted)] hover:text-[var(--text)]'"
      @click="navigate(tab.routeName)"
    >
      {{ tab.label }}
      <span v-if="tab.count != null" class="ml-1 text-xs opacity-60">({{ tab.count }})</span>
    </button>
  </nav>
</template>
