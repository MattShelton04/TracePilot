<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { computed, ref } from 'vue';

const props = defineProps<{
  tabs: Array<{ name: string; routeName: string; label: string; count?: number }>;
}>();

const route = useRoute();
const router = useRouter();

const activeTab = computed(() => route.name as string);

const tabRefs = ref<HTMLButtonElement[]>([]);

function navigate(routeName: string) {
  router.push({ name: routeName, params: route.params });
}

function handleKeydown(e: KeyboardEvent, index: number) {
  let target = -1;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault();
      target = (index + 1) % props.tabs.length;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      target = (index - 1 + props.tabs.length) % props.tabs.length;
      break;
    case 'Home':
      e.preventDefault();
      target = 0;
      break;
    case 'End':
      e.preventDefault();
      target = props.tabs.length - 1;
      break;
  }
  if (target >= 0) {
    tabRefs.value[target]?.focus();
  }
}
</script>
<template>
  <nav class="tab-nav" role="tablist" aria-label="Session tabs">
    <button
      v-for="(tab, index) in tabs"
      :key="tab.name"
      :ref="(el) => { if (el) tabRefs[index] = el as HTMLButtonElement }"
      role="tab"
      :aria-selected="activeTab === tab.routeName"
      :aria-current="activeTab === tab.routeName ? 'page' : undefined"
      :tabindex="activeTab === tab.routeName ? 0 : -1"
      class="tab-nav-item"
      :class="{ active: activeTab === tab.routeName }"
      @click="navigate(tab.routeName)"
      @keydown="handleKeydown($event, index)"
    >
      {{ tab.label }}
      <span v-if="tab.count != null" class="tab-count">{{ tab.count }}</span>
    </button>
  </nav>
</template>
