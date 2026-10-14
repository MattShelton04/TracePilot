<script setup lang="ts">
/**
 * Every tool, ranked by calls, failure rate, average time or total time.
 * The bar always shows what the list is sorted by and that column reads
 * brightest; the rest stay quiet. Subagents and `ask_user` are labelled,
 * since their time is a whole run or a wait for an answer. Rows expand to
 * the source-native tools behind a canonical name: click anywhere on one.
 * Every tool is listed; the body scrolls under a fixed header.
 */
import {
  formatNumber,
  formatNumberFull,
  sourceLabel,
  type ToolAnalysisData,
  type ToolUsageEntry,
} from "@tracepilot/types";
import { SegmentedControl, SourceLogo, Tooltip } from "@tracepilot/ui";
import { ChevronRight } from "lucide-vue-next";
import { computed, ref } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";
import { formatShare } from "@/utils/analyticsDashboard";
import {
  failureRate,
  formatCallTime,
  formatToolTime,
  isFailing,
  rankTools,
  TOOL_KINDS,
  type ToolSort,
  toolFailures,
  toolKind,
  toolTimeSplit,
} from "@/utils/toolAnalysis";
import { canonicalOnlyCalls, toolUsageLabel, toolUsageNames } from "@/utils/toolDisplayName";

const props = defineProps<{ data: ToolAnalysisData }>();

const SORTS = [
  { value: "calls", label: "Most used" },
  { value: "failures", label: "Failure rate" },
  { value: "slowest", label: "Slowest" },
  { value: "time", label: "Most time" },
];
const KIND_TAGS = { tool: "", agent: "subagent", wait: "waits on you" } as const;

const views = useAnalyticsDashboardViews();
const sort = computed({
  get: () => views.value.toolsSort,
  set: (value: string) => {
    views.value.toolsSort = value as ToolSort;
  },
});

const expanded = ref(new Set<string>());
function toggle(name: string) {
  const next = new Set(expanded.value);
  if (!next.delete(name)) next.add(name);
  expanded.value = next;
}

const labels = computed(() => {
  const names = toolUsageNames(props.data.tools);
  return new Map(
    props.data.tools.map((tool, i) => [
      tool.name,
      { name: names[i], hint: toolUsageLabel(tool).hint },
    ]),
  );
});
const totalMs = computed(() => toolTimeSplit(props.data.tools).totalMs);
const ranked = computed(() => rankTools(props.data.tools, sort.value));

/** Average time on a log axis from 10ms, so fast tools still draw. */
const logWidth = (ms: number, max: number) => {
  const floor = Math.log10(10);
  const top = Math.log10(Math.max(100, max));
  return ms <= 10 ? 0 : ((Math.log10(ms) - floor) / (top - floor)) * 100;
};

const rows = computed(() => {
  const tools = props.data.tools;
  const maxCalls = Math.max(1, ...tools.map((tool) => tool.callCount));
  const maxRate = Math.max(0.0001, ...ranked.value.map((tool) => failureRate(tool)));
  const maxAvg = Math.max(1, ...tools.map((tool) => tool.avgDurationMs));
  const maxTotal = Math.max(1, ...tools.map((tool) => tool.totalDurationMs));
  return ranked.value.map((tool) => {
    const kind = toolKind(tool);
    const failed = toolFailures(tool);
    const rate = failureRate(tool);
    const label = labels.value.get(tool.name) ?? { name: tool.name, hint: undefined };
    const kindColor = TOOL_KINDS[kind].color;
    const bar =
      sort.value === "calls"
        ? [
            {
              key: "ok",
              width: ((tool.callCount - failed) / maxCalls) * 100,
              color: "var(--accent-fg)",
            },
            { key: "failed", width: (failed / maxCalls) * 100, color: "var(--danger-fg)" },
          ]
        : sort.value === "failures"
          ? [{ key: "rate", width: (rate / maxRate) * 100, color: "var(--danger-fg)" }]
          : sort.value === "slowest"
            ? [{ key: "avg", width: logWidth(tool.avgDurationMs, maxAvg), color: kindColor }]
            : [{ key: "time", width: (tool.totalDurationMs / maxTotal) * 100, color: kindColor }];
    const share = totalMs.value ? formatShare((tool.totalDurationMs / totalMs.value) * 100) : "0%";
    return {
      tool,
      label,
      tag: KIND_TAGS[kind],
      bar: bar
        .filter((part) => part.width > 0)
        .map((part) => ({ ...part, width: Math.max(0.6, part.width) })),
      calls: formatNumber(tool.callCount),
      failed: failed ? formatShare(rate * 100) : "—",
      failing: isFailing(tool),
      avg: tool.avgDurationMs > 0 ? formatCallTime(tool.avgDurationMs) : "—",
      time: tool.totalDurationMs > 0 ? formatToolTime(tool.totalDurationMs) : "—",
      tip: [
        `${label.name}${label.hint ? ` (${label.hint})` : ""}: ${formatNumberFull(tool.callCount)} call${tool.callCount === 1 ? "" : "s"}`,
        failed ? `${formatNumberFull(failed)} failed (${formatShare(rate * 100)})` : "none failed",
        tool.avgDurationMs > 0 ? `avg ${formatCallTime(tool.avgDurationMs)}` : "no timing",
        tool.totalDurationMs > 0
          ? `${formatToolTime(tool.totalDurationMs)} in all, ${share} of tool time`
          : "",
        kind === "agent" ? "each call lasts its subagent's whole run" : "",
        kind === "wait" ? "each call waits for your answer" : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
});

function natives(tool: ToolUsageEntry) {
  return (tool.nativeTools ?? []).map((native) => ({
    key: `${native.source}-${native.name}`,
    ...native,
    calls: formatNumber(native.callCount),
    failed: toolFailures(native) ? formatShare(failureRate(native) * 100) : "—",
    avg: native.avgDurationMs > 0 ? formatCallTime(native.avgDurationMs) : "—",
  }));
}

const legend = computed(() => {
  if (sort.value === "calls") {
    return [
      { key: "calls", label: "Calls", color: "var(--accent-fg)" },
      { key: "failed", label: "Failed", color: "var(--danger-fg)" },
    ];
  }
  if (sort.value === "failures")
    return [{ key: "rate", label: "Failure rate", color: "var(--danger-fg)" }];
  const kinds = new Set(ranked.value.map((tool) => toolKind(tool)));
  return (["tool", "agent", "wait"] as const)
    .filter((kind) => kinds.has(kind))
    .map((kind) => ({ key: kind, ...TOOL_KINDS[kind] }));
});

const column = (key: ToolSort) => (sort.value === key ? "ad-num" : "ad-num ad-num--muted");
</script>

<template>
  <OverviewPanel title="Tools" data-testid="tool-rank">
    <template #aside>
      <SegmentedControl v-model="sort" class="ad-seg" :options="SORTS" aria-label="Sort tools by" />
    </template>

    <template v-if="rows.length">
      <div class="ad-rows tool-rank" role="table" aria-label="Tools">
        <div class="ad-rowh tool-rank__grid" role="row">
          <span role="columnheader">Tool</span>
          <span role="columnheader" />
          <span role="columnheader" :class="column('calls')">Calls</span>
          <span role="columnheader" :class="column('failures')">Failed</span>
          <span role="columnheader" :class="column('slowest')">Avg</span>
          <span role="columnheader" :class="column('time')">Time</span>
        </div>
        <div class="tool-rank__body" role="rowgroup">
          <template v-for="row in rows" :key="row.tool.name">
            <Tooltip :text="row.tip">
              <div
                class="ad-row tool-rank__grid"
                :class="{ 'tool-rank__row--expandable': row.tool.nativeTools?.length }"
                role="row"
                data-testid="tool-rank-row"
                @click="row.tool.nativeTools?.length && toggle(row.tool.name)"
              >
                <span class="ad-row__name" role="cell">
                  <button
                    v-if="row.tool.nativeTools?.length"
                    type="button"
                    class="tool-rank__toggle"
                    :aria-expanded="expanded.has(row.tool.name)"
                    :aria-label="`${expanded.has(row.tool.name) ? 'Hide' : 'Show'} native tools for ${row.label.name}`"
                  >
                    <ChevronRight
                      :size="12"
                      class="tool-rank__chevron"
                      :class="{ 'tool-rank__chevron--open': expanded.has(row.tool.name) }"
                      aria-hidden="true"
                    />
                  </button>
                  <i v-else class="tool-rank__spacer" aria-hidden="true" />
                  <span class="tool-rank__name">
                    {{ row.label.name }}<small v-if="row.label.hint">{{ row.label.hint }}</small><small
                      v-if="row.tag"
                      class="tool-rank__tag"
                    >{{ row.tag }}</small>
                  </span>
                </span>
                <span class="ad-track" role="cell" aria-hidden="true">
                  <i
                    v-for="part in row.bar"
                    :key="part.key"
                    :style="{ width: `${part.width}%`, background: part.color }"
                    data-reveal="grow-x"
                  />
                </span>
                <span role="cell" :class="column('calls')">{{ row.calls }}</span>
                <span
                  role="cell"
                  :class="[column('failures'), { 'ad-num--warning': row.failing }]"
                >{{ row.failed }}</span>
                <span role="cell" :class="column('slowest')">{{ row.avg }}</span>
                <span role="cell" :class="column('time')">{{ row.time }}</span>
              </div>
            </Tooltip>
            <template v-if="expanded.has(row.tool.name)">
              <div
                v-for="native in natives(row.tool)"
                :key="native.key"
                class="ad-row tool-rank__grid tool-rank__native"
                role="row"
              >
                <span class="ad-row__name" role="cell">
                  <i class="tool-rank__spacer" aria-hidden="true" />
                  <span class="ad-source" :title="sourceLabel(native.source)">
                    <SourceLogo :source="native.source" :size="12" />
                  </span>
                  <span>{{ native.name }}</span>
                </span>
                <span role="cell" />
                <span role="cell" class="ad-num ad-num--muted">{{ native.calls }}</span>
                <span role="cell" class="ad-num ad-num--muted">{{ native.failed }}</span>
                <span role="cell" class="ad-num ad-num--muted">{{ native.avg }}</span>
                <span role="cell" />
              </div>
              <div
                v-if="canonicalOnlyCalls(row.tool) > 0"
                class="ad-row tool-rank__grid tool-rank__native"
                role="row"
              >
                <span class="ad-row__name ad-num--muted" role="cell">
                  <i class="tool-rank__spacer" aria-hidden="true" />
                  <span>No native name</span>
                </span>
                <span role="cell" />
                <span role="cell" class="ad-num ad-num--muted">{{ formatNumber(canonicalOnlyCalls(row.tool)) }}</span>
                <span role="cell" /><span role="cell" /><span role="cell" />
              </div>
            </template>
          </template>
        </div>
      </div>
      <div class="ad-foot">
        <span><b>{{ ranked.length }}</b> tool{{ ranked.length === 1 ? "" : "s" }}</span>
        <span class="ad-legend">
          <span v-for="item in legend" :key="item.key">
            <i class="ad-sw" :style="{ background: item.color }" />{{ item.label }}
          </span>
        </span>
      </div>
    </template>
    <p v-else class="ad-empty">
      <b>No tools used</b>
      No tool calls were recorded in this range.
    </p>
  </OverviewPanel>
</template>

<style scoped>
.tool-rank__grid {
  grid-template-columns: minmax(0, 1.7fr) minmax(48px, 1fr) 56px 52px 60px 52px;
}

.tool-rank .ad-row .ad-num {
  font-weight: 500;
}

.tool-rank .ad-row .ad-num--muted {
  font-weight: 400;
}

/* The header reserves the body's scrollbar gutter so the columns line up. */
.tool-rank > .ad-rowh {
  overflow-y: hidden;
  scrollbar-gutter: stable;
}

.tool-rank__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 432px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.tool-rank__body > span.tooltip {
  display: flex;
}

.tool-rank__body > span.tooltip > .ad-row {
  flex: 1;
}

.tool-rank__row--expandable {
  cursor: pointer;
}

.tool-rank__name {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tool-rank__name small {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--text-tertiary);
}

.tool-rank__name small.tool-rank__tag {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: var(--radius-sm);
  background: var(--surface-secondary);
  color: var(--text-secondary);
}

.tool-rank__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.tool-rank__toggle:hover {
  color: var(--text-primary);
}

.tool-rank__toggle:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

.tool-rank__chevron {
  transition: transform var(--duration-fast) var(--ease-out);
}

.tool-rank__chevron--open {
  transform: rotate(90deg);
}

.tool-rank__spacer {
  flex-shrink: 0;
  width: 16px;
}

.tool-rank__native {
  height: 24px;
  color: var(--text-tertiary);
}

.tool-rank__native .ad-row__name {
  padding-left: 16px;
  color: var(--text-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .tool-rank__chevron {
    transition: none;
  }
}
</style>
