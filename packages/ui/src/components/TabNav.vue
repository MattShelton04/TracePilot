<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

export interface TabNavItem {
  name: string;
  routeName: string;
  label: string;
  count?: number;
  /** Optional icon (emoji or short glyph) rendered before the label. */
  icon?: string;
}

const props = defineProps<{
  tabs: TabNavItem[];
  /**
   * When provided, TabNav operates in "local" mode: active tab is controlled
   * via v-model instead of vue-router. Used for tabbed session views where
   * inner tabs are not route-driven.
   */
  modelValue?: string;
  /**
   * Visual variant. `pill` renders fully-rounded tabs; the default renders
   * the underline-style tabs used by session views.
   */
  variant?: "default" | "pill";
  /**
   * When true, each tab receives a `--stagger` CSS custom property
   * (index * 50ms) so consumers can drive entry animations.
   */
  staggered?: boolean;
  /** Accessible name for the tablist. Defaults to the session tabs wording. */
  ariaLabel?: string;
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

// biome-ignore lint/style/noNonNullAssertion: activeTab path is guarded by isLocalMode (modelValue defined) / global route (route.name populated by router).
const activeTab = computed(() => (isLocalMode.value ? props.modelValue! : (route?.name as string)));

// Track which tab has tabindex="0" — follows keyboard focus, resets on route change
const focusedIndex = ref(0);
const navRef = ref<HTMLElement | null>(null);
const tabRefs = ref<HTMLButtonElement[]>([]);

/**
 * One shared underline slides between tabs instead of each tab drawing its
 * own, so a tab change reads as movement from the previous tab. It is placed
 * without animation on first render, resize and label/count changes.
 */
const showInk = computed(() => props.variant !== "pill");
const inkStyle = ref<{ transform: string } | null>(null);
const inkAnimated = ref(false);

function placeInk(animate: boolean) {
  const idx = props.tabs.findIndex((tab) => tab.routeName === activeTab.value);
  const tab = idx >= 0 ? tabRefs.value[idx] : undefined;
  if (!showInk.value || !tab?.isConnected || tab.offsetWidth === 0) {
    inkStyle.value = null;
    return;
  }
  inkAnimated.value = animate && inkStyle.value !== null;
  // A 1px bar scaled to the tab's width keeps the motion transform-only.
  inkStyle.value = {
    transform: `translateX(${tab.offsetLeft}px) scaleX(${tab.offsetWidth})`,
  };
}

function revealTab(index: number) {
  const nav = navRef.value;
  const tab = tabRefs.value[index];
  if (!nav || !tab || nav.clientWidth === 0) return;

  // Scroll this strip only. scrollIntoView/default focus scrolling can also
  // move the session page and lose the user's place in the current content.
  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  if (left < nav.scrollLeft || tab.offsetWidth > nav.clientWidth) {
    nav.scrollLeft = left;
  } else if (right > nav.scrollLeft + nav.clientWidth) {
    nav.scrollLeft = right - nav.clientWidth;
  }
}

function revealCurrentTab() {
  const focused = tabRefs.value.indexOf(document.activeElement as HTMLButtonElement);
  revealTab(
    focused >= 0 ? focused : props.tabs.findIndex((tab) => tab.routeName === activeTab.value),
  );
}

watch(
  activeTab,
  async (name, previous) => {
    const idx = props.tabs.findIndex((t) => t.routeName === name);
    if (idx >= 0) focusedIndex.value = idx;
    await nextTick();
    revealTab(idx);
    placeInk(previous !== undefined);
  },
  { immediate: true },
);

watch(
  () => props.tabs,
  async () => {
    await nextTick();
    revealCurrentTab();
    observeTabs();
    placeInk(false);
  },
  { deep: true },
);

let resizeObserver: ResizeObserver | undefined;
function observeTabs() {
  for (const tab of tabRefs.value) resizeObserver?.observe(tab);
}
onMounted(() => {
  if (navRef.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      revealCurrentTab();
      placeInk(false);
    });
    resizeObserver.observe(navRef.value);
    observeTabs();
  }
  placeInk(false);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

function handleFocus(index: number) {
  focusedIndex.value = index;
  revealTab(index);
}

function navigate(routeName: string) {
  if (isLocalMode.value) {
    emit("update:modelValue", routeName);
  } else {
    // biome-ignore lint/style/noNonNullAssertion: non-local mode implies useRouter()/useRoute() returned valid refs above.
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
    tabRefs.value[target]?.focus({ preventScroll: true });
    revealTab(target);
  }
}
</script>
<template>
  <nav
    ref="navRef"
    class="tab-nav"
    :class="{ 'tab-nav--pill': variant === 'pill' }"
    role="tablist"
    :aria-label="ariaLabel ?? 'Session tabs'"
    data-testid="session-tabs"
  >
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
      :class="{ active: activeTab === tab.routeName, 'tab-nav-item--pill': variant === 'pill' }"
      :style="staggered ? { '--stagger': `${index * 50}ms` } : undefined"
      @click="navigate(tab.routeName)"
      @focus="handleFocus(index)"
      @keydown="handleKeydown($event, index)"
    >
      <span v-if="tab.icon" class="tab-nav-icon" aria-hidden="true">{{ tab.icon }}</span>
      {{ tab.label }}
      <span v-if="tab.count != null" class="tab-count">{{ tab.count }}</span>
    </button>
    <span
      v-if="showInk && inkStyle"
      class="tab-nav-ink"
      :class="{ 'tab-nav-ink--animated': inkAnimated }"
      :style="inkStyle"
      aria-hidden="true"
      data-testid="tab-nav-ink"
    />
  </nav>
</template>

<style scoped>
.tab-nav {
  position: relative;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  /* Keep the app's shared themed scrollbar; a non-auto scrollbar-width
     overrides its ::-webkit-scrollbar treatment in the desktop webview. */
}

.tab-nav-item {
  flex-shrink: 0;
}

/* Keep both indicators inside the scrollport, including its end tabs. */
.tab-nav-item:focus-visible {
  outline-offset: -2px;
}
.tab-nav-item.active::after {
  bottom: 0;
}

/* The shared ink replaces each active tab's own underline. */
.tab-nav-item.active:not(.tab-nav-item--pill) {
  border-bottom-color: transparent;
}
.tab-nav-item.active:not(.tab-nav-item--pill)::after {
  display: none;
}
.tab-nav-ink {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 1px;
  height: 2px;
  background: var(--accent-emphasis);
  transform-origin: 0 0;
  pointer-events: none;
}
.tab-nav-ink--animated {
  transition: transform var(--duration-normal, 180ms) var(--ease-out, ease-out);
}

/* ── Pill variant ─────────────────────────────────────────── */
.tab-nav--pill {
  border-bottom: none;
}
.tab-nav-item--pill {
  border-bottom: none;
  padding: 5px 16px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}
.tab-nav-item--pill:not(:first-child) {
  border-left: none;
}
.tab-nav-item--pill:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}
.tab-nav-item--pill:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
/* Active state — must override global .tab-nav-item.active (border-bottom-color + ::after) */
.tab-nav-item--pill.active {
  background: var(--accent-subtle);
  border-color: var(--accent-muted);
  border-bottom-color: var(--accent-muted);
  color: var(--accent-fg);
}
.tab-nav-item--pill.active::after {
  display: none;
}
.tab-nav-item--pill:hover:not(.active) {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.tab-nav-icon {
  display: inline-flex;
  align-items: center;
  margin-right: 2px;
}
</style>
