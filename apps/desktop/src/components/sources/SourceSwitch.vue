<script setup lang="ts">
/**
 * All / per-source switch for the session list and Analytics. A radiogroup
 * like `SegmentedControl`, with each source's logo and a sliding thumb tinted
 * in that source's colour. `null` means every source.
 */
import { type SessionSource, sourceLabel } from "@tracepilot/types";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import SourceLogo from "./SourceLogo.vue";

const props = defineProps<{
  modelValue: SessionSource | null;
  sources: readonly SessionSource[];
  label?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: SessionSource | null] }>();

// Short labels keep the switch compact; the full name is the tooltip.
const SHORT_LABELS: Partial<Record<SessionSource, string>> = { claudeCode: "Claude" };

const options = computed(() => [
  { value: null, key: "all" as const, label: "All", title: "All sources" },
  ...props.sources.map((source) => ({
    value: source,
    key: source,
    label: SHORT_LABELS[source] ?? sourceLabel(source),
    title: sourceLabel(source),
  })),
]);
const activeIndex = computed(() =>
  Math.max(
    0,
    options.value.findIndex((option) => option.value === props.modelValue),
  ),
);
const activeKey = computed(() => options.value[activeIndex.value].key);

const root = ref<HTMLElement | null>(null);
const buttons = ref<HTMLButtonElement[]>([]);
const thumb = ref<{ left: number; width: number } | null>(null);

function setButton(el: unknown, index: number) {
  if (el instanceof HTMLButtonElement) buttons.value[index] = el;
}

function measure() {
  const button = buttons.value[activeIndex.value];
  thumb.value = button ? { left: button.offsetLeft, width: button.offsetWidth } : null;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined" && root.value) {
    observer = new ResizeObserver(measure);
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
watch([activeIndex, () => props.sources.length], () => nextTick(measure));

function select(index: number, focus = false) {
  emit("update:modelValue", options.value[index].value);
  if (focus) buttons.value[index]?.focus();
}

function onKeydown(event: KeyboardEvent, index: number) {
  const count = options.value.length;
  const next: Record<string, number> = {
    ArrowRight: (index + 1) % count,
    ArrowDown: (index + 1) % count,
    ArrowLeft: (index - 1 + count) % count,
    ArrowUp: (index - 1 + count) % count,
    Home: 0,
    End: count - 1,
  };
  if (!(event.key in next)) return;
  event.preventDefault();
  select(next[event.key], true);
}
</script>

<template>
  <div
    ref="root"
    class="source-switch"
    :data-active="activeKey"
    role="radiogroup"
    :aria-label="label ?? 'Filter by source'"
    data-testid="source-switch"
  >
    <span
      v-if="thumb"
      class="source-switch__thumb"
      aria-hidden="true"
      :style="{ width: `${thumb.width}px`, transform: `translateX(${thumb.left}px)` }"
    />
    <button
      v-for="(option, index) in options"
      :key="option.key"
      :ref="(el) => setButton(el, index)"
      type="button"
      role="radio"
      class="source-switch__option"
      :class="`source-switch__option--${option.key}`"
      :aria-checked="index === activeIndex"
      :tabindex="index === activeIndex ? 0 : -1"
      :data-source="option.key"
      :title="option.title"
      @click="select(index)"
      @keydown="onKeydown($event, index)"
    >
      <SourceLogo :source="option.key" :size="14" />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.source-switch {
  --switch-tint: var(--neutral-muted);
  --switch-edge: var(--border-default);
  --switch-fg: var(--text-primary);
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  flex-shrink: 0;
}
.source-switch[data-active="copilot"] {
  --switch-tint: var(--accent-muted);
  --switch-edge: var(--accent-emphasis);
  --switch-fg: var(--accent-fg);
}
.source-switch[data-active="claudeCode"] {
  --switch-tint: var(--claude-muted);
  --switch-edge: var(--claude-border);
  --switch-fg: var(--claude-fg);
}
.source-switch__thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  border-radius: var(--radius-full);
  background: var(--switch-tint);
  box-shadow: inset 0 0 0 1px var(--switch-edge);
  transition:
    transform var(--duration-normal) var(--ease-out),
    width var(--duration-normal) var(--ease-out),
    background-color var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out);
  pointer-events: none;
}
.source-switch__option {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}
.source-switch__option:hover {
  color: var(--text-primary);
}
.source-switch__option[aria-checked="true"] {
  color: var(--switch-fg);
}
.source-switch__option:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .source-switch__thumb,
  .source-switch__option {
    transition: none;
  }
}
</style>
