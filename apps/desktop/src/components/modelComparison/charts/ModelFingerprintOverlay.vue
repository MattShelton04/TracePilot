<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  type AxisRank,
  formatRate,
  formatShare,
  formatTokens,
  type ModelProfile,
  PROFILE_AXES,
} from "@/composables/modelComparison/charts";
import { useElementWidth } from "@/composables/useElementWidth";
import ModelRadar, { type RadarSeries } from "./ModelRadar.vue";

const props = defineProps<{
  profiles: ModelProfile[];
  ranks: Map<string, (AxisRank | null)[]>;
}>();
const emit = defineEmits<{
  vertex: [event: PointerEvent, id: string, axis: number];
  leave: [];
}>();

const root = ref<HTMLElement | null>(null);
const width = useElementWidth(root, 1000);
const AXES = PROFILE_AXES.map((a) => a.label);
/** Models overlaid when the view opens. */
const DEFAULT_SELECTED = 3;

const selected = ref<string[]>([]);
watch(
  () => props.profiles.map((p) => p.row.id),
  (ids) => {
    const kept = selected.value.filter((id) => ids.includes(id));
    selected.value = kept.length ? kept : ids.slice(0, DEFAULT_SELECTED);
  },
  { immediate: true },
);

const hovered = ref<string | null>(null);
const size = computed(() =>
  Math.max(260, Math.min(420, width.value < 720 ? width.value : width.value * 0.42)),
);
const series = computed<RadarSeries[]>(() =>
  props.profiles
    .filter((p) => selected.value.includes(p.row.id))
    .map((p) => ({ id: p.row.id, color: p.row.color, ranks: props.ranks.get(p.row.id) ?? [] })),
);

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((s) => s !== id)
    : [...selected.value, id];
}
</script>

<template>
  <div ref="root" class="fingerprint-overlay" :class="{ stacked: width < 720 }">
    <div class="fingerprint-overlay-radar">
      <ModelRadar
        :size="size"
        :axes="AXES"
        :series="series"
        :font-size="11"
        :label-gutter="54"
        :highlight="hovered"
        @vertex="(e, id, axis) => emit('vertex', e, id, axis)"
        @leave="emit('leave')"
      />
    </div>
    <div class="fingerprint-overlay-list" role="group" aria-label="Models to overlay">
      <button
        v-for="p in profiles"
        :key="p.row.id"
        type="button"
        class="fingerprint-option"
        :aria-pressed="selected.includes(p.row.id)"
        @click="toggle(p.row.id)"
        @pointerenter="hovered = selected.includes(p.row.id) ? p.row.id : null"
        @pointerleave="hovered = null"
      >
        <span
          class="fingerprint-swatch"
          :class="{ hollow: !p.row.billedInAiCredits }"
          :style="{ '--swatch': p.row.color }"
        />
        <span class="fingerprint-option-name">{{ p.row.label }}</span>
        <span class="fingerprint-option-stats">
          {{ formatTokens(p.row.tokens) }} · {{ formatRate(p.rate) }}/1M · {{ formatShare(p.cacheHit, 0) }}
        </span>
      </button>
    </div>
  </div>
</template>
