<script setup lang="ts">
/**
 * CheckpointTimeline — self-contained vertical timeline for checkpoint entries.
 *
 * Owns all expand/collapse state, scroll-to-focus behaviour, and timeline CSS.
 * The parent only provides the data and an optional focus request (v-model).
 */
import type { CheckpointEntry } from "@tracepilot/types";
import { ExpandChevron } from "@tracepilot/ui";
import { computed, nextTick, ref, watch } from "vue";
import CheckpointContentView from "./CheckpointContentView.vue";

const props = defineProps<{
  checkpoints: CheckpointEntry[];
  /** When set, the timeline expands + scrolls to this checkpoint number, then clears it. */
  focusNumber?: number | null;
}>();

const emit = defineEmits<{
  "update:focusNumber": [value: number | null];
}>();

// ── Expand / collapse ──────────────────────────────────────────────
const expandedSet = ref<Set<number>>(new Set());

function toggle(num: number) {
  if (expandedSet.value.has(num)) {
    expandedSet.value.delete(num);
  } else {
    expandedSet.value.add(num);
  }
}

function expandAll() {
  for (const cp of props.checkpoints) {
    if (cp.content) expandedSet.value.add(cp.number);
  }
}

function collapseAll() {
  expandedSet.value.clear();
}

const allExpanded = computed(() =>
  props.checkpoints.every((cp) => !cp.content || expandedSet.value.has(cp.number)),
);

// ── Scroll-to-focus ────────────────────────────────────────────────
const rootRef = ref<HTMLElement | null>(null);

watch(
  () => [props.focusNumber, props.checkpoints.length] as const,
  async ([num]) => {
    if (num == null) return;
    expandedSet.value.add(num);
    await nextTick();
    const container = rootRef.value ?? document;
    const el = container.querySelector(`[data-checkpoint="${num}"]`);
    if (el) {
      emit("update:focusNumber", null);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // If el not found, keep pending — watcher re-fires when checkpoints load
  },
  { immediate: true },
);

defineExpose({ allExpanded, expandAll, collapseAll });
</script>

<template>
  <div ref="rootRef" class="cp-timeline">
    <div
      v-for="(cp, idx) in checkpoints"
      :key="cp.number"
      :data-checkpoint="cp.number"
      class="cp-timeline-item"
    >
      <!-- Rail -->
      <div
        class="cp-timeline-rail"
        :class="{
          first: idx === 0,
          last: idx === checkpoints.length - 1,
          only: checkpoints.length === 1,
        }"
      >
        <div
          class="cp-timeline-dot"
          :class="{ active: expandedSet.has(cp.number) }"
        >
          {{ cp.number }}
        </div>
      </div>

      <!-- Content -->
      <div class="cp-timeline-content">
        <button class="cp-timeline-header" @click="toggle(cp.number)">
          <div class="cp-timeline-title-row">
            <span class="cp-timeline-title">{{ cp.title }}</span>
            <ExpandChevron
              v-if="cp.content"
              :expanded="expandedSet.has(cp.number)"
              class="cp-timeline-chevron"
            />
          </div>
        </button>
        <div v-if="expandedSet.has(cp.number) && cp.content" class="cp-timeline-body">
          <CheckpointContentView :content="cp.content" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp-timeline {
  display: flex;
  flex-direction: column;
}

.cp-timeline-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 0;
}

.cp-timeline-rail {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 24px;
  flex-shrink: 0;
  align-self: stretch;
}

/* Continuous connector line via pseudo-element */
.cp-timeline-rail::before {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--border, rgba(255, 255, 255, 0.1));
}

.cp-timeline-rail.first::before {
  top: 13px;
}

.cp-timeline-rail.last::before {
  bottom: calc(100% - 13px);
}

.cp-timeline-rail.only::before {
  display: none;
}

.cp-timeline-dot {
  position: relative;
  z-index: 1;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 2px;
  background: var(--surface-tertiary, rgba(255, 255, 255, 0.06));
  color: var(--text-tertiary, #6e7681);
  border: 2px solid var(--border, rgba(255, 255, 255, 0.1));
  transition: all 0.15s;
}

.cp-timeline-dot.active {
  background: var(--accent-emphasis, #1f6feb);
  color: #fff;
  border-color: var(--accent-emphasis, #1f6feb);
}

.cp-timeline-content {
  flex: 1;
  min-width: 0;
  padding-bottom: 4px;
}

.cp-timeline-header {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 2px 4px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm, 4px);
  transition: background 0.15s;
}

.cp-timeline-header:hover {
  background: var(--surface-secondary, rgba(255, 255, 255, 0.04));
}

.cp-timeline-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.cp-timeline-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary, #e6edf3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cp-timeline-chevron {
  flex-shrink: 0;
  opacity: 0.4;
}

.cp-timeline-body {
  padding: 6px 4px 8px;
}
</style>
