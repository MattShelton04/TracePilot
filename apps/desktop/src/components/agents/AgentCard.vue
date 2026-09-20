<script setup lang="ts">
/**
 * One agent in the manager grid: identity and scope, the models it resolves
 * to, and its cross-session usage. Session-only agents (no definition on
 * disk) render the same way minus the definition-derived parts.
 */
import {
  Badge,
  DefinitionCard,
  formatDuration,
  formatNumber,
  formatRelativeTime,
  LUCIDE_ICON_COMPONENTS,
  resolveLucideIcon,
  Tooltip,
} from "@tracepilot/ui";
import { computed } from "vue";
import UsageCardSummary, { type UsageCardStat } from "@/components/usage/UsageCardSummary.vue";
import { agentMeta } from "@/utils/agents/agentMeta";
import { type AgentEntry, failureRate } from "@/utils/agents/entries";
import { resolvePlaceholderText } from "@/utils/agents/placeholders";
import { type AgentUsageRange, rangeDays } from "@/utils/agents/range";
import { cardModels, FLAG_BADGES, scopeBadge } from "./agentBadges";

const props = defineProps<{
  entry: AgentEntry;
  range: AgentUsageRange;
}>();

const emit = defineEmits<{ open: [entry: AgentEntry] }>();

const icon = computed(() =>
  resolveLucideIcon(agentMeta(props.entry.name).iconName, LUCIDE_ICON_COMPONENTS.bot),
);
const badge = computed(() => scopeBadge(props.entry.scope));
/** Built-in descriptions carry `{{placeholders}}` the CLI fills at runtime. */
const description = computed(() => resolvePlaceholderText(props.entry.description));
const models = computed(() => cardModels(props.entry));
const modelsTitle = computed(() =>
  props.entry.override?.model
    ? `Overridden by a /subagents setting${
        props.entry.definition?.fields.models.length
          ? `; the definition says ${props.entry.definition.fields.models.join(" → ")}`
          : ""
      }`
    : "From the definition, in fallback order",
);
const toolCount = computed(() => props.entry.definition?.fields.tools?.length ?? null);

/** The Config Injector's per-agent colour, reused for the icon and accent. */
const accent = computed(() => `var(${agentMeta(props.entry.name).colorVar})`);

/** Zero-filled so a gap in the daily counts reads as "no runs", not as a jump. */
const sparkValues = computed(() => {
  const usage = props.entry.usage;
  if (!usage || usage.runs === 0) return [];
  const byDate = new Map(usage.dailyRuns.map((day) => [day.date, day.runs]));
  return rangeDays(props.range, usage.firstUsed).map((date) => byDate.get(date) ?? 0);
});

/**
 * The three figures that decide whether an agent needs attention, each with
 * its own label so no one has to decode a run-on sentence. `null` values
 * render as an em dash rather than being dropped, so the columns line up
 * across the grid.
 */
const stats = computed<UsageCardStat[] | null>(() => {
  const usage = props.entry.usage;
  if (!usage || usage.runs === 0) return null;
  const rate = failureRate(usage);
  return [
    { key: "runs", label: "runs", value: formatNumber(usage.runs) },
    {
      key: "p50",
      label: "median",
      value: usage.durationMs.p50 != null ? formatDuration(usage.durationMs.p50) : "—",
    },
    {
      key: "failed",
      label: "failed/cancelled",
      value: rate === 0 ? "0%" : `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`,
      tone: props.entry.flags.includes("failing") ? "danger" : rate === 0 ? "muted" : undefined,
    },
  ];
});

const lastRun = computed(() => {
  const lastUsed = props.entry.usage?.lastUsed;
  return lastUsed ? formatRelativeTime(lastUsed) : null;
});
</script>

<template>
  <DefinitionCard
    class="agent-card"
    :name="entry.name"
    :display-name="entry.displayName"
    :description="description"
    :open-label="`Open agent ${entry.name}`"
    :muted="entry.disabled"
    :accent="accent"
    @open="emit('open', entry)"
  >
    <template #icon><component :is="icon" :size="18" :stroke-width="1.75" /></template>
    <template #badges>
      <Badge :variant="badge.tone">{{ badge.label }}</Badge>
      <span v-if="entry.kind === 'embedded'" class="agent-card__chip" title="This built-in has no definition file in the installed package; the CLI embeds it.">
        Definition unavailable
      </span>
      <span v-if="toolCount !== null" class="agent-card__chip">
        {{ toolCount }} tool{{ toolCount === 1 ? "" : "s" }}
      </span>
      <span v-if="entry.definition?.hasMcpServers" class="agent-card__chip">MCP</span>
      <Tooltip v-for="flag in entry.flags" :key="flag" :text="FLAG_BADGES[flag].title" position="bottom">
        <Badge :variant="FLAG_BADGES[flag].tone">{{ FLAG_BADGES[flag].label }}</Badge>
      </Tooltip>
    </template>

    <div v-if="models.length" class="agent-card__models" :title="modelsTitle">
      <span class="agent-card__model-label">{{ entry.override?.model ? 'Model override' : 'Model' }}</span>
      <span class="agent-card__primary-model">{{ models[0] }}</span>
      <span v-if="entry.definition?.fields.reasoningEffort" class="agent-card__effort">
        {{ entry.definition.fields.reasoningEffort }} effort
      </span>
      <span v-if="models.length > 1" class="agent-card__fallbacks">
        Fallback: {{ models.slice(1).join(' → ') }}
      </span>
    </div>

    <template #footer>
      <UsageCardSummary
        :stats="stats" :values="sparkValues" :label="`Daily runs for ${entry.name}`"
        :last-used="lastRun" idle-text="No runs in this range" :tone="entry.flags.includes('failing') ? 'danger' : 'accent'"
      />
    </template>
  </DefinitionCard>
</template>

<style scoped>
.agent-card__chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--canvas-default, var(--canvas-subtle));
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-tertiary);
}

.agent-card__models {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin: 0 0 12px;
  font-size: 0.75rem;
}
.agent-card__model-label, .agent-card__effort, .agent-card__fallbacks {
  color: var(--text-secondary);
  font-size: 0.6875rem;
}
.agent-card__primary-model {
  padding: 4px 8px;
  border: 1px solid var(--accent-muted);
  border-radius: var(--radius-sm);
  background: var(--accent-subtle);
  color: var(--accent-fg);
  font-family: var(--font-mono);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.agent-card__fallbacks { width: 100%; overflow-wrap: anywhere; }
</style>
