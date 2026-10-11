<script setup lang="ts">
/**
 * The Code page's four headline numbers: lines added (with a day strip),
 * lines removed (against added), the net change in its direction's colour,
 * and files touched (with the file-type split).
 */
import type { CodeImpactData } from "@tracepilot/types";
import { formatNumber, formatNumberFull, KPI, KPIRow, Tooltip } from "@tracepilot/ui";
import { Diff, FileCode, Minus, Plus } from "lucide-vue-next";
import { computed } from "vue";
import { binRows, type DayRow, formatShare } from "@/utils/analyticsDashboard";
import { fileTypeRows, fileTypeSplit } from "@/utils/codeImpact";

const props = defineProps<{
  data: CodeImpactData;
  /** Zero-filled days of the range: added, removed. */
  rows: DayRow[];
  /** One repository is selected, so paths cannot repeat across repositories. */
  oneRepo: boolean;
}>();

const changed = computed(() => props.data.linesAdded + props.data.linesRemoved);
const has = computed(() => changed.value > 0);

/** Lines added per day, merged into weeks or more once the range is long. */
const strip = computed(() => {
  if (props.rows.length < 3) return [];
  const bins = binRows(props.rows, 46);
  const max = Math.max(1, ...bins.map((row) => row.values[0]));
  return bins.map((row) => ({
    key: row.from,
    height: row.values[0] ? Math.max(12, (row.values[0] / max) * 100) : 0,
  }));
});
const activeDays = computed(
  () => props.rows.filter((row) => row.values[0] + row.values[1] > 0).length,
);
const busiest = computed(() => {
  let best: DayRow | null = null;
  for (const row of props.rows) {
    if (!best || row.values[0] + row.values[1] > best.values[0] + best.values[1]) best = row;
  }
  if (!best || best.values[0] + best.values[1] === 0) return null;
  return new Date(`${best.from}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
});

const split = computed(() =>
  has.value
    ? [
        {
          key: "added",
          width: (props.data.linesAdded / changed.value) * 100,
          color: "var(--success-fg)",
        },
        {
          key: "removed",
          width: (props.data.linesRemoved / changed.value) * 100,
          color: "var(--danger-fg)",
        },
      ].filter((part) => part.width > 0)
    : [],
);
const ratio = computed(() => {
  const { linesAdded, linesRemoved } = props.data;
  if (!linesRemoved) return null;
  const value = linesAdded / linesRemoved;
  return value >= 10 ? Math.round(value).toString() : value.toFixed(1);
});

const net = computed(() => {
  const value = props.data.netChange;
  return {
    text: `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatNumberFull(Math.abs(value))}`,
    tone: value > 0 ? "up" : value < 0 ? "down" : "flat",
    words: value > 0 ? "grew" : value < 0 ? "shrank" : "held level",
  };
});

const types = computed(() => fileTypeSplit(fileTypeRows(props.data.fileTypeBreakdown)));
const modifications = computed(() =>
  props.data.fileTypeBreakdown.reduce((sum, entry) => sum + entry.count, 0),
);
const typesTip = computed(() =>
  types.value
    .slice(0, 4)
    .map((row) => `${row.label} ${formatShare(row.share)}`)
    .join(" · "),
);
const filesTip = computed(
  () =>
    `Unique paths${props.oneRepo ? "" : " across repositories"}: a file counts once however many sessions touched it, though the same file in another worktree or clone counts again. Modifications count it once per session.`,
);
</script>

<template>
  <KPIRow class="ad-kpis" style="--ad-kpi-count: 4" data-testid="code-kpis">
    <KPI label="Lines added" :value="`${data.linesAdded ? '+' : ''}${formatNumberFull(data.linesAdded)}`">
      <template #icon><Plus :size="13" /></template>
      <template #footer>
        <Tooltip v-if="strip.length" text="Lines added per day (UTC); a session's lines count on its last day">
          <div class="ad-day-strip code-kpis__strip" aria-hidden="true">
            <i
              v-for="bar in strip"
              :key="bar.key"
              :class="{ 'ad-day-strip__zero': !bar.height }"
              :style="bar.height ? { height: `${bar.height}%` } : undefined"
              data-reveal="grow-y"
            />
          </div>
        </Tooltip>
        <span class="ad-kpi-note">
          <template v-if="has && busiest">
            busiest <b>{{ busiest }}</b> · active <b>{{ activeDays }}</b> of {{ rows.length }} day{{ rows.length === 1 ? "" : "s" }}
          </template>
          <template v-else-if="has">from per-session totals</template>
          <template v-else>No line changes reported</template>
        </span>
      </template>
    </KPI>

    <KPI label="Lines removed" :value="`${data.linesRemoved ? '−' : ''}${formatNumberFull(data.linesRemoved)}`">
      <template #icon><Minus :size="13" /></template>
      <template #footer>
        <Tooltip
          :text="has ? `${formatNumberFull(data.linesAdded)} added and ${formatNumberFull(data.linesRemoved)} removed, ${formatNumberFull(changed)} lines changed in all` : 'No line changes reported'"
        >
          <div v-if="split.length" class="ad-meter" aria-hidden="true">
            <i
              v-for="part in split"
              :key="part.key"
              :style="{ width: `${part.width}%`, background: part.color }"
              data-reveal="grow-x"
            />
          </div>
          <span class="ad-kpi-note">
            <template v-if="ratio"><b>{{ ratio }}</b> added per line removed</template>
            <template v-else-if="has">Nothing removed</template>
            <template v-else>No line changes reported</template>
          </span>
        </Tooltip>
      </template>
    </KPI>

    <KPI label="Net change" :value="net.text">
      <template #icon><Diff :size="13" /></template>
      <template #value>
        <span class="kpi__value-num code-kpis__net" :class="`code-kpis__net--${net.tone}`">{{ net.text }}</span>
      </template>
      <template #footer>
        <Tooltip text="Lines added minus lines removed. Line counts come from each session's own totals; sessions that report none add nothing.">
          <span class="ad-kpi-note">
            <template v-if="has">
              code {{ net.words }} · <b>{{ formatNumber(changed) }}</b> lines changed
            </template>
            <template v-else>No line changes reported</template>
          </span>
        </Tooltip>
      </template>
    </KPI>

    <KPI label="Files touched" :value="formatNumberFull(data.filesModified)">
      <template #icon><FileCode :size="13" /></template>
      <template #footer>
        <Tooltip :text="typesTip ? `${filesTip} Types: ${typesTip}.` : filesTip">
          <div v-if="types.length" class="ad-meter" aria-hidden="true">
            <i
              v-for="part in types"
              :key="part.key"
              :style="{ width: `${part.share}%`, background: part.color }"
              data-reveal="grow-x"
            />
          </div>
          <span class="ad-kpi-note">
            <template v-if="data.filesModified">
              <b>{{ formatNumberFull(modifications) }}</b> modification{{ modifications === 1 ? "" : "s" }} ·
              {{ (modifications / data.filesModified).toFixed(1) }} per file
            </template>
            <template v-else>No files modified</template>
          </span>
        </Tooltip>
      </template>
    </KPI>
  </KPIRow>
</template>

<style scoped>
.code-kpis__strip i:not(.ad-day-strip__zero) {
  background: var(--success-fg);
}

.code-kpis__net--up {
  color: var(--success-fg);
}

.code-kpis__net--down {
  color: var(--danger-fg);
}

.code-kpis__net--flat {
  color: var(--text-tertiary);
}
</style>
