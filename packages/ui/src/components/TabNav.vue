<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

const props = defineProps<{
  tabs: Array<{ name: string; routeName: string; label: string; count?: number }>;
  /**
   * When provided, TabNav operates in "local" mode: active tab is controlled
   * via v-model instead of vue-router. Used for tabbed session views where
   * inner tabs are not route-driven.
   */
  modelValue?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

// Only call useRoute/useRouter when NOT in local mode (i.e. router is available).
// Child (viewer) windows don't install vue-router; calling useRoute() there
// returns undefined and logs inject warnings.
const route = props.modelValue === undefined ? useRoute() : undefined;
const router = props.modelValue === undefined ? useRouter() : undefined;

/** True when TabNav is controlled by v-model (local mode) */
const isLocalMode = computed(() => props.modelValue !== undefined);

const activeTab = computed(() =>
  isLocalMode.value ? props.modelValue! : (route?.name as string),
);

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
  if (isLocalMode.value) {
    emit("update:modelValue", routeName);
  } else {
    router!.push({ name: routeName, params: route!.params });
  }
}

function handleKeydown(e: KeyboardEvent, index: number) {
  let target = -1;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
      e.preventDefault();
      target = (index + 1) % props.tabs.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      e.preventDefault();
      target = (index - 1 + props.tabs.length) % props.tabs.length;
      break;
    case "Home":
      e.preventDefault();
      target = 0;
      break;
    case "End":
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
  <nav class="tab-nav" role="tablist" aria-label="Session tabs" data-testid="session-tabs">
    <button
      v-for="(tab, index) in tabs"
      :key="tab.name"
      :ref="(el) => { if (el) tabRefs[index] = el as HTMLButtonElement }"
      role="tab"
      :aria-selected="activeTab === tab.routeName"
      :aria-current="activeTab === tab.routeName ? 'page' : undefined"
      :tabindex="index === focusedIndex ? 0 : -1"
      :data-testid="`session-tab-${tab.routeName}`"
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
