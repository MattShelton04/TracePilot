<script setup lang="ts">
/**
 * Which agents did the work, as the tree they ran in: each row has a share
 * bar for its part of the session. With Copilot's per-agent ledger the share
 * is cost (or tokens) and a row opens to its models; without one (Claude
 * Code) only tool calls and run time are known, so the share is tool calls
 * and a row opens the agent's activity.
 */
import type { ConversationTurn, ShutdownMetrics, TurnToolCall } from "@tracepilot/types";
import {
  formatNumber,
  formatNumberFull,
  formatPercent,
  getToolArgs,
  toolArgString,
} from "@tracepilot/types";
import { Badge, formatAiCreditsUsd, SegmentedControl } from "@tracepilot/ui";
import { ArrowRight, ChevronRight, Info } from "lucide-vue-next";
import { computed, ref } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useClientPager } from "@/composables/useClientPager";
import { useCountsUpToNow } from "@/composables/useCountsUpToNow";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSessionModelName } from "@/composables/useSessionModelName";
import { NO_FINAL_REPORT, NO_FINAL_REPORT_HINT, settledAgentStatus } from "@/utils/agentEndState";
import {
  type AgentUsageRow,
  agentUsageCoverage,
  buildAgentUsageRows,
} from "@/utils/agentUsageRows";
import { COMPOSITION } from "@/utils/analyticsSummary";
import { modelTokenBreakdown } from "@/utils/metricsTokenBreakdown";
import { formatShare } from "@/utils/metricsView";
import { formatRecordedDuration } from "@/utils/sessionDurations";

const props = withDefaults(
  defineProps<{
    metrics: ShutdownMetrics;
    turns: ConversationTurn[];
    /** False for sources not billed in AI Credits. */
    showCredits?: boolean;
  }>(),
  { showCredits: true },
);
defineEmits<{ activity: [toolCallId: string] }>();

const store = useSessionDetailContext();
const modelName = useSessionModelName();
const mayStillReport = useCountsUpToNow(() => store.sessionId);
const scope = ref<"own" | "branch">("own");
const open = ref<string | null>(null);

const ledger = computed(() => props.metrics.agentUsage != null);
const coverage = computed(() => agentUsageCoverage(props.metrics));
const calls = computed(() => {
  const map = new Map<string, TurnToolCall>();
  for (const turn of props.turns) {
    for (const call of turn.toolCalls) if (call.toolCallId) map.set(call.toolCallId, call);
  }
  return map;
});

function describe(row: AgentUsageRow): string | null {
  const call = row.toolCallId ? calls.value.get(row.toolCallId) : undefined;
  if (!call) return null;
  const text =
    call.intentionSummary ||
    toolArgString(getToolArgs(call), "description") ||
    toolArgString(getToolArgs(call), "name");
  return text && text !== row.name ? text : null;
}
function ranFor(row: AgentUsageRow): number | null {
  const call = row.toolCallId ? calls.value.get(row.toolCallId) : undefined;
  if (!call) return null;
  if (call.durationMs != null) return call.durationMs;
  const start = call.startedAt ? Date.parse(call.startedAt) : Number.NaN;
  const end = call.completedAt ? Date.parse(call.completedAt) : Number.NaN;
  return end > start ? end - start : null;
}

const rows = computed(() =>
  buildAgentUsageRows(props.metrics, props.turns).map((row) => ({
    ...row,
    status: settledAgentStatus(row.status, mayStillReport.value),
    description: describe(row),
    ranFor: ranFor(row),
  })),
);

/** Cost when the ledger has any, then tokens, then tool calls without one. */
const measure = computed<"cost" | "tokens" | "tools">(() => {
  if (!ledger.value) return "tools";
  if (props.showCredits && rows.value.some((row) => row.own.credits != null)) return "cost";
  return "tokens";
});
const usage = (row: (typeof rows.value)[number]) =>
  scope.value === "branch" ? row.branch : row.own;
function value(row: (typeof rows.value)[number]): number | null {
  const u = usage(row);
  if (measure.value === "cost") return u.credits;
  if (measure.value === "tokens") return u.tokens.total;
  return u.tools;
}
const total = computed(() => {
  if (measure.value === "cost" && coverage.value.sessionCredits != null) {
    return coverage.value.sessionCredits;
  }
  return rows.value.reduce(
    (n, row) =>
      n +
      ((measure.value === "cost"
        ? row.own.credits
        : measure.value === "tokens"
          ? row.own.tokens.total
          : row.own.tools) ?? 0),
    0,
  );
});
const display = computed(() => {
  const max = Math.max(0, ...rows.value.map((row) => value(row) ?? 0));
  return rows.value.map((row) => {
    const v = value(row);
    return {
      ...row,
      value: v,
      bar: v != null && max > 0 ? (v / max) * 100 : 0,
      share: v != null && total.value > 0 ? (v / total.value) * 100 : null,
      numbers: usage(row),
    };
  });
});
const { page, pageCount, pageRows } = useClientPager(display, 50, [scope]);

const subagents = computed(() => rows.value.filter((row) => row.id !== "main").length);
const shareLabel = computed(() =>
  measure.value === "cost"
    ? "Share of cost"
    : measure.value === "tokens"
      ? "Share of tokens"
      : "Share of tool calls",
);
const scopeOptions = [
  { value: "own", label: "Own" },
  { value: "branch", label: "With descendants" },
];

function statusLabel(status: string): string | null {
  if (status === "main" || status === "completed") return null;
  if (status === "in-progress") return "Running";
  if (status === "unreported") return NO_FINAL_REPORT;
  if (status === "unlinked") return "Activity unavailable";
  return status[0].toUpperCase() + status.slice(1);
}
function statusVariant(status: string): "danger" | "warning" | "neutral" {
  if (status === "failed") return "danger";
  if (status === "unreported") return "warning";
  return "neutral";
}

function modelsOf(row: AgentUsageRow) {
  return Object.entries(row.models)
    .map(([name, metric]) => {
      const t = modelTokenBreakdown(metric);
      const fresh = t.uncached ?? (t.notCached != null ? t.notCached - (t.cacheWrite ?? 0) : null);
      const kinds = { cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, fresh, output: t.output };
      return {
        name,
        tokens: t,
        requests: metric.requests?.count ?? null,
        credits: metric.totalNanoAiu != null ? metric.totalNanoAiu / 1e9 : null,
        kinds: t.total
          ? COMPOSITION.filter((p) => (kinds[p.key] ?? 0) > 0).map((p) => ({
              ...p,
              width: ((kinds[p.key] ?? 0) / (t.total as number)) * 100,
            }))
          : [],
      };
    })
    .sort((a, b) => (b.tokens.total ?? 0) - (a.tokens.total ?? 0));
}
const snapshotDate = computed(() =>
  props.metrics.agentUsage?.timestamp
    ? new Date(props.metrics.agentUsage.timestamp).toLocaleString()
    : null,
);
const fmt = (v: number | null | undefined) => (v == null ? "—" : formatNumber(v));
function select(row: (typeof display.value)[number], emit: (id: string) => void) {
  if (ledger.value) open.value = open.value === row.id ? null : row.id;
  else if (row.toolCallId) emit(row.toolCallId);
}
</script>

<template>
  <OverviewPanel title="Agents" data-testid="agent-usage">
    <template #aside>
      <span>{{ subagents }} subagent{{ subagents === 1 ? "" : "s" }}</span>
      <SegmentedControl v-if="ledger && subagents" v-model="scope" class="ad-seg" :options="scopeOptions" aria-label="Agent usage scope" />
    </template>

    <div class="agents">
      <p v-if="!ledger" class="ad-note agents__note">
        <Info :size="12" aria-hidden="true" />
        <template v-if="showCredits">Per-agent usage was not recorded in this session; Copilot CLI records it from version 1.0.83.</template>
        <template v-else>Claude Code doesn't record usage per agent, so bars compare tool calls. Cost and tokens are session totals only.</template>
        Select an agent to open its activity.
      </p>
      <p v-else-if="!coverage.comparable" class="ad-note agents__warn">Agent usage is from {{ snapshotDate ?? "an earlier shutdown" }} and doesn't match the session totals.</p>
      <p v-if="metrics.agentUsage?.hasInvalidFields" class="ad-note agents__warn">Some recorded fields are invalid; valid data is kept.</p>

      <div class="ad-rows" :class="[ledger ? 'agents--ledger' : 'agents--tools', { 'agents--nocost': !showCredits }]" role="table" aria-label="Usage by agent" data-testid="agent-usage-table">
        <div class="ad-rowh agents__grid" role="row">
          <span role="columnheader">Agent</span>
          <span role="columnheader" class="agents__share">{{ shareLabel }}</span>
          <template v-if="ledger">
            <span v-if="showCredits" role="columnheader" class="ad-num">Cost</span>
            <span role="columnheader" class="ad-num">Tokens</span>
            <span role="columnheader" class="ad-num agents__opt">Requests</span>
            <span role="columnheader" class="ad-num">Tools</span>
            <span role="columnheader" class="ad-num agents__opt">Model time</span>
          </template>
          <template v-else>
            <span role="columnheader" class="ad-num">Tool calls</span>
            <span role="columnheader" class="ad-num">Ran for</span>
          </template>
        </div>

        <template v-for="row in pageRows" :key="row.id">
          <button
            type="button"
            class="ad-row agents__grid"
            :class="{ 'is-open': open === row.id, 'is-static': !ledger && !row.toolCallId }"
            role="row"
            :title="row.id"
            :aria-expanded="ledger ? open === row.id : undefined"
            data-testid="agent-usage-row"
            @click="select(row, (id) => $emit('activity', id))"
          >
            <span class="ad-row__name agents__name" role="cell" :style="{ paddingLeft: `${Math.min(row.depth, 6) * 16}px` }">
              <span v-if="row.depth" class="agents__guide" :style="{ left: `${Math.min(row.depth, 6) * 16 - 10}px` }" aria-hidden="true" />
              <ChevronRight v-if="ledger" :size="12" class="agents__chev" aria-hidden="true" />
              <span class="agents__label">{{ row.name }}<span v-if="row.description" class="agents__desc"> · {{ row.description }}</span></span>
              <Badge v-if="statusLabel(row.status)" :variant="statusVariant(row.status)" :title="row.status === 'unreported' ? NO_FINAL_REPORT_HINT : undefined">{{ statusLabel(row.status) }}</Badge>
            </span>
            <span class="agents__share agents__bar" role="cell">
              <span class="ad-track"><i :style="{ width: `${row.bar}%`, background: row.depth ? 'var(--chart-secondary)' : 'var(--chart-primary)' }" data-reveal="grow-x" /></span>
              <em>{{ row.share == null ? "—" : formatShare(row.share) }}</em>
            </span>
            <template v-if="ledger">
              <span v-if="showCredits" class="ad-num" role="cell">{{ formatAiCreditsUsd(row.numbers.credits) }}<span v-if="row.numbers.partial && row.numbers.credits != null" class="agents__partial" title="Includes known costs only">*</span></span>
              <span class="ad-num" role="cell">{{ fmt(row.numbers.tokens.total) }}</span>
              <span class="ad-num ad-num--muted agents__opt" role="cell">{{ fmt(row.numbers.requests) }}</span>
              <span class="ad-num" role="cell">{{ formatNumberFull(row.numbers.tools) }}</span>
              <span class="ad-num ad-num--muted agents__opt" role="cell">{{ row.numbers.apiMs == null ? "—" : formatRecordedDuration(row.numbers.apiMs) }}</span>
            </template>
            <template v-else>
              <span class="ad-num" role="cell">{{ formatNumberFull(row.own.tools) }}</span>
              <span class="ad-num ad-num--muted" role="cell">{{ row.ranFor == null ? "—" : formatRecordedDuration(row.ranFor) }}</span>
            </template>
          </button>

          <div v-if="ledger && open === row.id" class="agents__detail" data-testid="agent-usage-detail">
            <p v-if="!Object.keys(row.models).length" class="ad-note">Model usage is unavailable for this agent.</p>
            <div v-for="model in modelsOf(row)" :key="model.name" class="agents__model">
              <span class="agents__model-name" :title="model.name">{{ modelName(model.name) }}</span>
              <span class="ad-meter" aria-hidden="true"><i v-for="part in model.kinds" :key="part.key" :style="{ width: `${part.width}%`, background: part.color }" /></span>
              <span class="ad-num">{{ fmt(model.tokens.total) }} tokens</span>
              <span class="ad-num ad-num--muted">{{ model.tokens.cacheRatio == null ? "—" : formatPercent(model.tokens.cacheRatio * 100) }} cached</span>
              <span class="ad-num ad-num--muted">{{ fmt(model.requests) }} requests</span>
              <span v-if="showCredits" class="ad-num">{{ formatAiCreditsUsd(model.credits) }}</span>
            </div>
            <button v-if="row.toolCallId" type="button" class="ad-link" @click="$emit('activity', row.toolCallId)">Open agent activity <ArrowRight :size="12" aria-hidden="true" /></button>
          </div>
        </template>
      </div>

      <nav v-if="pageCount > 1" class="agents__pager" aria-label="Agent pages">
        <button class="btn btn-secondary" :disabled="page === 0" @click="page--">Previous</button>
        <span>{{ page + 1 }} / {{ pageCount }}</span>
        <button class="btn btn-secondary" :disabled="page + 1 >= pageCount" @click="page++">Next</button>
      </nav>

      <p v-if="ledger" class="ad-note">
        <template v-if="scope === 'branch'">Rows include their descendants and overlap; don't add them up. </template>
        <template v-if="coverage.attributed != null && showCredits">Attributed cost: <b>{{ formatAiCreditsUsd(coverage.attributed) }}</b>{{ coverage.complete ? "" : " (partial)" }}<template v-if="coverage.remainder != null"> · not attributed to an agent: {{ formatAiCreditsUsd(coverage.remainder) }}</template>. </template>
        Usage is from the last shutdown; model time adds up request time, not wall time.
      </p>
      <p v-if="coverage.exceedsTotal" class="ad-note agents__warn">Agent costs add up to more than the recorded session total.</p>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.agents {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.agents__note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.agents__note svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.agents__warn {
  color: var(--attention-fg);
}

.agents--ledger .agents__grid {
  grid-template-columns: minmax(160px, 2.2fr) minmax(90px, 1.4fr) 72px 64px 64px 52px 76px;
}

.agents--ledger.agents--nocost .agents__grid {
  grid-template-columns: minmax(160px, 2.2fr) minmax(90px, 1.4fr) 64px 64px 52px 76px;
}

.agents--tools .agents__grid {
  grid-template-columns: minmax(180px, 2.6fr) minmax(100px, 1.6fr) 72px 76px;
}

.ad-row.is-static {
  cursor: default;
}

.agents__name {
  position: relative;
  min-width: 0;
}

.agents__guide {
  position: absolute;
  top: -6px;
  bottom: 50%;
  width: 7px;
  border-left: 1px solid var(--border-default);
  border-bottom: 1px solid var(--border-default);
  border-bottom-left-radius: 4px;
  pointer-events: none;
}

.agents__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agents__desc {
  color: var(--text-tertiary);
}

.agents__chev {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform var(--duration-fast) var(--ease-out);
}

.is-open .agents__chev {
  transform: rotate(90deg);
}

.agents__bar {
  display: grid;
  grid-template-columns: 1fr 44px;
  gap: 8px;
  align-items: center;
}

.agents__bar em {
  font: normal 11px / 16px var(--font-mono);
  color: var(--text-tertiary);
  text-align: right;
}

.agents__partial {
  color: var(--warning-fg);
}

.agents__detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 0 6px;
  padding: 10px 12px 10px 28px;
  border-radius: var(--radius-sm);
  background: var(--canvas-inset);
  font-size: 12px;
}

.agents__model {
  display: grid;
  grid-template-columns: minmax(100px, 1.2fr) minmax(60px, 1fr) 96px 72px 92px 64px;
  gap: 10px;
  align-items: center;
}

.agents__model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.agents__detail .ad-link {
  align-self: flex-start;
}

.agents__pager {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

@container (max-width: 860px) {
  .agents--ledger .agents__grid {
    grid-template-columns: minmax(140px, 2fr) minmax(70px, 1fr) 72px 64px 52px;
  }

  .agents__opt {
    display: none;
  }

  .agents__model {
    grid-template-columns: minmax(90px, 1fr) 90px 72px 64px;
  }

  .agents__model > :nth-child(2),
  .agents__model > :nth-child(5) {
    display: none;
  }
}

@container (max-width: 600px) {
  .agents__share {
    display: none;
  }

  .agents--ledger .agents__grid {
    grid-template-columns: minmax(120px, 1fr) 72px 64px 52px;
  }

  .agents--tools .agents__grid {
    grid-template-columns: minmax(140px, 1fr) 72px 76px;
  }
}
</style>
