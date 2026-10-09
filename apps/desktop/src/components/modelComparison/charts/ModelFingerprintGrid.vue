<script setup lang="ts">
import { computed, ref } from "vue";
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
const GAP = 10;
/** One card per model, up to two rows. */
const MAX_CARDS = 8;

const layout = computed(() => {
  const w = width.value;
  // Four across keeps each radar large enough to read; wider panels just
  // give the cards more room.
  const cols = w >= 860 ? 4 : w >= 440 ? 2 : 1;
  const cell = (w - (cols - 1) * GAP) / cols;
  const size = Math.max(150, Math.min(cell - 16, 240));
  return { cols, size, font: size < 190 ? 9 : 10, gutter: size < 190 ? 40 : 46 };
});

const shown = computed(() => props.profiles.slice(0, MAX_CARDS));
/** Model drawn as a dashed outline on every other card. */
const pinned = ref<string | null>(null);

const seriesFor = (profile: ModelProfile): RadarSeries[] => {
  const own: RadarSeries = {
    id: profile.row.id,
    color: profile.row.color,
    ranks: props.ranks.get(profile.row.id) ?? [],
  };
  const ghostId = pinned.value;
  if (!ghostId || ghostId === profile.row.id) return [own];
  return [
    { id: `ghost-${ghostId}`, color: "", ranks: props.ranks.get(ghostId) ?? [], style: "ghost" },
    own,
  ];
};

const pinnedLabel = computed(
  () => props.profiles.find((p) => p.row.id === pinned.value)?.row.label ?? null,
);

function toggle(id: string) {
  pinned.value = pinned.value === id ? null : id;
}

const summary = (p: ModelProfile) =>
  `${formatTokens(p.row.tokens)} tok · ${formatRate(p.rate)}/1M · ${formatShare(p.cacheHit, 0)} cache`;
</script>

<template>
  <div ref="root" class="fingerprint-grid-wrap">
    <p class="model-chart-hint">
      <template v-if="pinnedLabel">
        Dashed outline: {{ pinnedLabel }}.
        <button type="button" class="model-chart-link" @click="pinned = null">Clear</button>
      </template>
      <template v-else>Select a card to outline that model on all the others.</template>
    </p>
    <div class="fingerprint-grid" :style="{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))` }">
      <button
        v-for="p in shown"
        :key="p.row.id"
        type="button"
        class="fingerprint-card"
        :aria-pressed="pinned === p.row.id"
        :aria-label="`${p.row.label}: outline on other cards`"
        @click="toggle(p.row.id)"
      >
        <ModelRadar
          :size="layout.size"
          :axes="AXES"
          :series="seriesFor(p)"
          :font-size="layout.font"
          :label-gutter="layout.gutter"
          @vertex="(e, _id, axis) => emit('vertex', e, p.row.id, axis)"
          @leave="emit('leave')"
        />
        <span class="fingerprint-name">
          <span
            class="fingerprint-swatch"
            :class="{ hollow: !p.row.billedInAiCredits }"
            :style="{ '--swatch': p.row.color }"
          />
          <span class="fingerprint-name-text" :title="p.row.model">{{ p.row.label }}</span>
        </span>
        <span class="fingerprint-sub">{{ summary(p) }}</span>
      </button>
    </div>
  </div>
</template>
