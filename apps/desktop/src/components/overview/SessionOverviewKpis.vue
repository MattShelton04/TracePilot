<script setup lang="ts">
/**
 * The Overview's four headline numbers, each with the context that makes it
 * readable: turns (and events), duration (and model time), what changed (or
 * how many model calls), and cost (and its basis).
 */
import type { CodeChanges } from "@tracepilot/types";
import { formatDuration, formatNumberFull, KPI, KPIRow } from "@tracepilot/ui";
import { Archive, Clock, Coins, FileDiff, MessageSquare, Zap } from "lucide-vue-next";
import { computed } from "vue";
import { formatRecordedDuration } from "@/utils/sessionDurations";
import { splitSessionTime } from "@/utils/sessionOverview";

export interface OverviewCost {
  label: string;
  value: string;
  /** Shown after the value, e.g. `AIC`. */
  unit?: string;
  /** Where the figure comes from: `Observed billing`, `Claude Code estimate`. */
  basis: string;
  partial: boolean;
  /** Cost per turn, already formatted. */
  perTurn: string | null;
  tooltip?: string;
}

const props = defineProps<{
  turnCount: number;
  eventCount: number;
  spanMs: number | null;
  apiMs: number | null | undefined;
  toolMs: number | null | undefined;
  running: boolean;
  codeChanges: CodeChanges | null | undefined;
  /** Recorded model calls, when the source counts them. */
  calls: number | null;
  /** Checkpoints, for sources that write them. */
  checkpoints: number | null;
  fileSnapshots: number;
  cost: OverviewCost;
}>();

const eventsPerTurn = computed(() =>
  props.turnCount > 0 ? (props.eventCount / props.turnCount).toFixed(1) : null,
);
const split = computed(() => splitSessionTime(props.spanMs, props.apiMs, props.toolMs));
const duration = computed(() => (props.spanMs ? formatDuration(props.spanMs) || "—" : "—"));

const diffBlocks = computed(() => {
  const added = props.codeChanges?.linesAdded ?? 0;
  const removed = props.codeChanges?.linesRemoved ?? 0;
  const total = added + removed;
  if (!total) return [];
  const green = Math.round((added / total) * 5);
  const red = Math.min(5 - green, Math.max(removed ? 1 : 0, Math.round((removed / total) * 5)));
  return Array.from({ length: 5 }, (_, i) =>
    i < green ? "added" : i < green + red ? "removed" : "none",
  );
});
const changedFiles = computed(() => props.codeChanges?.filesModified?.length ?? 0);
// Claude Code lists the files it edited but records no line counts.
const hasLineCounts = computed(
  () => (props.codeChanges?.linesAdded ?? 0) + (props.codeChanges?.linesRemoved ?? 0) > 0,
);
</script>

<template>
  <KPIRow class="overview-kpis" data-testid="overview-kpis">
    <KPI label="Turns" :value="formatNumberFull(turnCount)">
      <template #icon><MessageSquare :size="13" /></template>
      <template #footer>
        <span class="kpi-note">
          <b>{{ formatNumberFull(eventCount) }}</b> events<template v-if="eventsPerTurn"> · {{ eventsPerTurn }} per turn</template>
        </span>
      </template>
    </KPI>

    <KPI :label="running ? 'Running for' : 'Duration'" :value="duration">
      <template #icon><Clock :size="13" /></template>
      <template #footer>
        <div
          v-if="split"
          class="kpi-meter"
          :title="`Model ${formatRecordedDuration(apiMs)}${toolMs ? ` · Tools ${formatRecordedDuration(toolMs)}` : ''}`"
        >
          <i class="kpi-meter__model" :style="{ width: `${split.model * 100}%` }" data-reveal="grow-x" />
          <i v-if="split.tools" class="kpi-meter__tools" :style="{ width: `${split.tools * 100}%` }" data-reveal="grow-x" />
        </div>
        <span class="kpi-note">
          <template v-if="apiMs"><b>{{ formatRecordedDuration(apiMs) }}</b> waiting on the model</template>
          <template v-else>No model timing recorded</template>
        </span>
      </template>
    </KPI>

    <KPI
      v-if="codeChanges"
      label="Code changes"
      :value="hasLineCounts ? '' : formatNumberFull(changedFiles)"
      :unit="hasLineCounts ? undefined : changedFiles === 1 ? 'file' : 'files'"
    >
      <template #icon><FileDiff :size="13" /></template>
      <template v-if="hasLineCounts" #value>
        <span class="kpi__value-num lines-added">+{{ formatNumberFull(codeChanges.linesAdded ?? 0) }}</span>
        <span class="kpi__value-num lines-removed">−{{ formatNumberFull(codeChanges.linesRemoved ?? 0) }}</span>
      </template>
      <template #footer>
        <span class="kpi-note">
          <span v-if="diffBlocks.length" class="diff-blocks" aria-hidden="true">
            <i v-for="(kind, i) in diffBlocks" :key="i" :class="`diff-blocks__${kind}`" />
          </span>
          <template v-if="hasLineCounts"><b>{{ formatNumberFull(changedFiles) }}</b> file{{ changedFiles === 1 ? "" : "s" }} changed</template>
          <template v-else>No line counts recorded</template>
        </span>
      </template>
    </KPI>
    <KPI
      v-else-if="calls != null || checkpoints == null"
      label="Model calls"
      :value="calls != null ? formatNumberFull(calls) : '—'"
      description="Model calls recorded in the transcript"
    >
      <template #icon><Zap :size="13" /></template>
      <template #footer>
        <span class="kpi-note">
          <template v-if="calls != null && turnCount > 0">{{ (calls / turnCount).toFixed(1) }} per turn</template>
          <template v-else>Not recorded</template>
          <template v-if="fileSnapshots"> · <b>{{ fileSnapshots }}</b> file snapshots</template>
        </span>
      </template>
    </KPI>
    <KPI v-else label="Checkpoints" :value="formatNumberFull(checkpoints)">
      <template #icon><Archive :size="13" /></template>
      <template #footer>
        <span class="kpi-note">No code changes recorded</span>
      </template>
    </KPI>

    <KPI :label="cost.label" :value="cost.value" :unit="cost.unit" :description="cost.tooltip">
      <template #icon><Coins :size="13" /></template>
      <template #footer>
        <span class="kpi-note">
          <b>{{ cost.basis }}</b>
          <template v-if="cost.partial"> · <span class="partial">partial</span></template>
          <template v-else-if="cost.perTurn"> · {{ cost.perTurn }}/turn</template>
        </span>
      </template>
    </KPI>
  </KPIRow>
</template>

<style scoped>
.overview-kpis {
  border-color: var(--border-default);
  background: var(--border-default);
}

.overview-kpis :deep(.kpi) {
  background: var(--canvas-subtle);
  padding: 14px 16px;
}

/* Two by two when the tab is too narrow for four readable footers. */
@container (max-width: 820px) {
  .overview-kpis.kpi-row.kpi-row--wrap {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.kpi-note {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.kpi-note b {
  font-weight: 500;
  color: var(--text-secondary);
}

.partial {
  color: var(--warning-fg);
}

.lines-added {
  color: var(--success-fg);
}

.lines-removed {
  color: var(--danger-fg);
}

.kpi-meter {
  display: flex;
  height: 4px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--surface-tertiary);
}

.kpi-meter i {
  display: block;
  height: 100%;
}

.kpi-meter__model {
  background: var(--chart-primary);
}

.kpi-meter__tools {
  background: var(--chart-cyan);
}

.diff-blocks {
  display: inline-flex;
  gap: 2px;
  margin-right: 4px;
}

.diff-blocks i {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--surface-tertiary);
}

.diff-blocks i.diff-blocks__added {
  background: var(--success-emphasis);
}

.diff-blocks i.diff-blocks__removed {
  background: var(--danger-emphasis);
}
</style>
