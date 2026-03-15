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
  <nav class="tab-nav" role="tablist" aria-label="Session tabs">
    <button
      v-for="tab in tabs"
      :key="tab.name"
      role="tab"
      :aria-selected="activeTab === tab.routeName"
      :aria-current="activeTab === tab.routeName ? 'page' : undefined"
      class="tab-nav-item"
      :class="{ active: activeTab === tab.routeName }"
      @click="navigate(tab.routeName)"
    >
      {{ tab.label }}
      <span v-if="tab.count != null" class="tab-count">{{ tab.count }}</span>
    </button>
  </nav>
</template>
