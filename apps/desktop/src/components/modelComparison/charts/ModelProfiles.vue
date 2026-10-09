<script setup lang="ts">
import { computed, ref } from "vue";
import {
  type ModelProfile,
  modelProfile,
  PROFILE_AXES,
  PROFILE_MIN_SHARE,
  profilePopulation,
  rankProfiles,
} from "@/composables/modelComparison/charts";
import { useModelChartTooltip } from "@/composables/modelComparison/useModelChartTooltip";
import { useModelComparisonContext } from "@/composables/useModelComparison";
import ChartModeToggle from "./ChartModeToggle.vue";
import ModelChartTooltip from "./ModelChartTooltip.vue";
import ModelFingerprintGrid from "./ModelFingerprintGrid.vue";
import ModelFingerprintOverlay from "./ModelFingerprintOverlay.vue";
import ModelTrails from "./ModelTrails.vue";

type View = "grid" | "overlay" | "trails";

const ctx = useModelComparisonContext();
const view = ref<View>("grid");
const VIEWS: Array<{ value: View; label: string }> = [
  { value: "grid", label: "Fingerprints" },
  { value: "overlay", label: "Overlay" },
  { value: "trails", label: "Trails" },
];

const population = computed<ModelProfile[]>(() =>
  profilePopulation(ctx.modelRows).map(modelProfile),
);
const ranks = computed(() => rankProfiles(population.value));
const allProfiles = computed(() =>
  [...ctx.modelRows].sort((a, b) => b.tokens - a.tokens).map(modelProfile),
);

const { tooltip, show, hide } = useModelChartTooltip();

/** Tooltip for one model's standing on one radar axis. */
function showVertex(event: PointerEvent, id: string, axisIndex: number) {
  const profile = population.value.find((p) => p.row.id === id);
  if (!profile) return;
  const axis = PROFILE_AXES[axisIndex];
  const raw = axis.value(profile);
  const rank = ranks.value.get(id)?.[axisIndex] ?? null;
  show(event, {
    title: profile.row.label,
    color: profile.row.color,
    hollow: !profile.row.billedInAiCredits,
    rows: [
      {
        label: axis.description,
        value: raw != null && raw > 0 ? axis.format(raw) : "Not recorded",
      },
      { label: "Rank", value: rank ? `${rank.place} of ${rank.of}` : "—" },
    ],
  });
}

const caption = computed(() =>
  view.value === "trails"
    ? "Every model across six measures in real units. Log scales where values span decades; n/a sits below each axis."
    : `Each axis ranks a model among the ${population.value.length} models with at least ${PROFILE_MIN_SHARE}% of tokens; further out is higher, and the bold ring is the median.`,
);
</script>

<template>
  <div class="section-panel mb-4">
    <div class="section-panel-header panel-header-flex">
      <span>Model Profiles</span>
      <ChartModeToggle v-model="view" :options="VIEWS" label="Profile view" />
    </div>
    <div class="section-panel-body model-chart-body">
      <div v-if="population.length < 2" class="chart-placeholder">
        Needs at least 2 models to compare profiles.
      </div>
      <template v-else>
        <p class="model-chart-caption">{{ caption }}</p>
        <ModelFingerprintGrid
          v-if="view === 'grid'"
          :profiles="population"
          :ranks="ranks"
          @vertex="showVertex"
          @leave="hide"
        />
        <ModelFingerprintOverlay
          v-else-if="view === 'overlay'"
          :profiles="population"
          :ranks="ranks"
          @vertex="showVertex"
          @leave="hide"
        />
        <ModelTrails v-else :profiles="allProfiles" />
      </template>
    </div>
    <ModelChartTooltip :tooltip="tooltip" />
  </div>
</template>
