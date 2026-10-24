<script setup lang="ts">
/**
 * The Tools page's four headline numbers: calls (with a day strip), the
 * share that failed, tool time split into tools, subagents and waiting on
 * you, and how many tools were used. Each has a hover line with the detail.
 */
import type { ToolAnalysisData } from "@tracepilot/types";
import { formatDuration, formatNumberFull, KPI, KPIRow, Tooltip } from "@tracepilot/ui";
import { Clock, LayoutGrid, OctagonX, Wrench } from "lucide-vue-next";
import { computed } from "vue";
import { binRows, type DayRow, formatShare } from "@/utils/analyticsDashboard";
import {
  failureRate,
  formatCallTime,
  formatToolTime,
  isFailing,
  MIN_JUDGED_CALLS,
  TOOL_KINDS,
  type ToolKind,
  toolFailures,
  toolTimeSplit,
} from "@/utils/toolAnalysis";
import { toolUsageNames } from "@/utils/toolDisplayName";

const props = defineProps<{
  data: ToolAnalysisData;
  /** Zero-filled days of the range; `runs` holds each day's calls. */
  rows: DayRow[];
}>();

const has = computed(() => props.data.totalCalls > 0);
const names = computed(() => {
  const labels = toolUsageNames(props.data.tools);
  return new Map(props.data.tools.map((tool, i) => [tool, labels[i]]));
});
const nameOf = (tool: ToolAnalysisData["tools"][number]) => names.value.get(tool) ?? tool.name;
const plural = (n: number, word: string) => `${formatNumberFull(n)} ${word}${n === 1 ? "" : "s"}`;

/** Calls per day, merged into weeks or more once the range is long. */
const strip = computed(() => {
  if (props.rows.length < 3) return [];
  const bins = binRows(props.rows, 46);
  const max = Math.max(1, ...bins.map((row) => row.runs));
  return bins.map((row) => ({
    key: row.from,
    height: row.runs ? Math.max(12, (row.runs / max) * 100) : 0,
  }));
});
const activeDays = computed(() => props.rows.filter((row) => row.runs > 0).length);
const perDay = computed(() =>
  activeDays.value ? Math.round(props.data.totalCalls / activeDays.value) : 0,
);

const failures = computed(() => {
  const failed = props.data.tools.reduce((sum, tool) => sum + toolFailures(tool), 0);
  const total = props.data.totalCalls;
  const share = total ? failed / total : 0;
  const worst = [...props.data.tools]
    .filter((tool) => isFailing(tool))
    .sort((a, b) => failureRate(b) - failureRate(a))[0];
  const most = [...props.data.tools].sort((a, b) => toolFailures(b) - toolFailures(a))[0];
  return {
    failed,
    value: total ? formatShare(share * 100) : "—",
    meter: failed
      ? [
          { key: "ok", width: 100 - share * 100, color: "var(--success-fg)" },
          { key: "failed", width: share * 100, color: "var(--danger-fg)" },
        ]
      : [],
    worst: worst ? { name: nameOf(worst), rate: formatShare(failureRate(worst) * 100) } : null,
    most:
      most && toolFailures(most) > 0 ? { name: nameOf(most), failed: toolFailures(most) } : null,
  };
});
const failureTip = computed(() => {
  const value = failures.value;
  if (!value.failed) return "No tool call reported a failure.";
  const parts = [
    `${plural(value.failed, "call")} of ${formatNumberFull(props.data.totalCalls)} reported a failure.`,
  ];
  if (value.most)
    parts.push(`Most failures: ${value.most.name} (${formatNumberFull(value.most.failed)}).`);
  if (value.worst)
    parts.push(
      `Highest rate with ${MIN_JUDGED_CALLS}+ calls: ${value.worst.name} (${value.worst.rate}).`,
    );
  return parts.join(" ");
});

const KINDS: ToolKind[] = ["tool", "agent", "wait"];
const time = computed(() => {
  const split = toolTimeSplit(props.data.tools);
  const total = split.totalMs;
  const hours = total >= 3_600_000;
  return {
    value: hours
      ? formatNumberFull(Math.round(total / 3_600_000))
      : (total > 0 && formatDuration(total)) || "—",
    unit: hours ? "h" : undefined,
    meter: total
      ? KINDS.filter((kind) => split.ms[kind] > 0).map((kind) => ({
          key: kind,
          ...TOOL_KINDS[kind],
          width: (split.ms[kind] / total) * 100,
          share: formatShare((split.ms[kind] / total) * 100),
        }))
      : [],
    tip: total
      ? KINDS.filter((kind) => split.calls[kind] > 0)
          .map(
            (kind) =>
              `${TOOL_KINDS[kind].label}: ${formatToolTime(split.ms[kind])} over ${plural(split.calls[kind], "call")}` +
              (kind === "tool"
                ? ` (${formatCallTime(split.ms.tool / split.calls.tool)} each)`
                : ""),
          )
          .join(" · ") + ". A subagent's call lasts its whole run; ask_user waits for your answer."
      : "No call recorded a duration.",
  };
});

const usage = computed(() => {
  const tools = [...props.data.tools].sort((a, b) => b.callCount - a.callCount);
  const total = props.data.totalCalls;
  const top = tools.slice(0, 3);
  const topShare = total ? (top.reduce((sum, tool) => sum + tool.callCount, 0) / total) * 100 : 0;
  return {
    count: tools.length,
    leader:
      tools[0] && total
        ? { name: nameOf(tools[0]), share: formatShare((tools[0].callCount / total) * 100) }
        : null,
    topShare,
    tip: top
      .map((tool) => `${nameOf(tool)} ${formatShare((tool.callCount / Math.max(1, total)) * 100)}`)
      .join(" · "),
  };
});
</script>

<template>
  <KPIRow class="ad-kpis" style="--ad-kpi-count: 4" data-testid="tool-kpis">
    <KPI label="Tool calls" :value="formatNumberFull(data.totalCalls)">
      <template #icon><Wrench :size="13" /></template>
      <template #footer>
        <Tooltip
          v-if="strip.length"
          text="Calls per day (UTC), by each session's last activity"
        >
          <div class="ad-day-strip" aria-hidden="true">
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
          <template v-if="has && activeDays">
            <b>{{ formatNumberFull(perDay) }}</b> a day on <b>{{ activeDays }}</b> of {{ rows.length }}
            day{{ rows.length === 1 ? "" : "s" }}
          </template>
          <template v-else-if="has">across {{ plural(usage.count, "tool") }}</template>
          <template v-else>No tool calls</template>
        </span>
      </template>
    </KPI>

    <KPI label="Failed" :value="failures.value">
      <template #icon><OctagonX :size="13" /></template>
      <template #footer>
        <Tooltip :text="failureTip">
          <div v-if="failures.meter.length" class="ad-meter" aria-hidden="true">
            <i
              v-for="part in failures.meter"
              :key="part.key"
              :style="{ width: `${part.width}%`, background: part.color }"
              data-reveal="grow-x"
            />
          </div>
          <span class="ad-kpi-note">
            <template v-if="failures.failed">
              <b>{{ formatNumberFull(failures.failed) }}</b> calls<template v-if="failures.worst">
                · worst with {{ MIN_JUDGED_CALLS }}+ calls: {{ failures.worst.name }} ({{ failures.worst.rate }})</template>
            </template>
            <template v-else-if="has">No failed calls</template>
            <template v-else>No tool calls</template>
          </span>
        </Tooltip>
      </template>
    </KPI>

    <KPI label="Tool time" :value="time.value" :unit="time.unit">
      <template #icon><Clock :size="13" /></template>
      <template #footer>
        <Tooltip :text="time.tip">
          <div v-if="time.meter.length" class="ad-meter" aria-hidden="true">
            <i
              v-for="part in time.meter"
              :key="part.key"
              :style="{ width: `${part.width}%`, background: part.color }"
              data-reveal="grow-x"
            />
          </div>
          <span class="ad-kpi-note">
            <template v-if="time.meter.length">
              <template v-for="(part, i) in time.meter" :key="part.key">
                <template v-if="i"> · </template><b>{{ part.share }}</b> {{ part.label.toLowerCase() }}
              </template>
            </template>
            <template v-else>No timed calls</template>
          </span>
        </Tooltip>
      </template>
    </KPI>

    <KPI label="Tools used" :value="formatNumberFull(usage.count)">
      <template #icon><LayoutGrid :size="13" /></template>
      <template #footer>
        <Tooltip :text="usage.tip ? `Top three: ${usage.tip}` : 'No tools used'" :disabled="!usage.tip">
          <div v-if="usage.leader" class="ad-meter" aria-hidden="true">
            <i
              :style="{ width: `${usage.topShare}%`, background: 'var(--accent-fg)' }"
              data-reveal="grow-x"
            />
          </div>
          <span class="ad-kpi-note">
            <template v-if="usage.leader">
              top 3 make <b>{{ formatShare(usage.topShare) }}</b> · {{ usage.leader.name }} leads
            </template>
            <template v-else>No tools used</template>
          </span>
        </Tooltip>
      </template>
    </KPI>
  </KPIRow>
</template>
