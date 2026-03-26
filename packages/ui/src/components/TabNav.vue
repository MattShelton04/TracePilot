<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const props = defineProps<{
  tabs: Array<{ name: string; routeName: string; label: string; count?: number }>;
}>();

const route = useRoute();
const router = useRouter();

const activeTab = computed(() => route.name as string);

// Track which tab has tabindex="0" — follows keyboard focus, resets on route change
const focusedIndex = ref(0);

watch(
  activeTab,
  (name) => {
    const idx = props.tabs.findIndex((t) => t.routeName === name);
    if (idx >= 0) focusedIndex.value = idx;
  },
  { immediate: true },
);

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
    focusedIndex.value = target;
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
      :tabindex="index === focusedIndex ? 0 : -1"
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
