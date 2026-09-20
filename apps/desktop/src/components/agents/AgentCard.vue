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
import UsageSparkline from "@/components/usage/UsageSparkline.vue";
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
const stats = computed(() => {
  const usage = props.entry.usage;
  if (!usage || usage.runs === 0) return null;
  const rate = failureRate(usage);
  return [
    { key: "runs", label: "runs", value: formatNumber(usage.runs), tone: "" },
    {
      key: "p50",
      label: "median",
      value: usage.durationMs.p50 != null ? formatDuration(usage.durationMs.p50) : "—",
      tone: "",
    },
    {
      key: "failed",
      label: "failed/cancelled",
      value: rate === 0 ? "0%" : `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`,
      tone: props.entry.flags.includes("failing") ? "danger" : rate === 0 ? "muted" : "",
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

    <p v-if="models.length" class="agent-card__models" :title="modelsTitle">
      <span v-for="(model, index) in models" :key="model">
        <span v-if="index > 0" class="agent-card__arrow" aria-hidden="true">→</span>{{ model }}
      </span>
      <span v-if="entry.definition?.fields.reasoningEffort" class="agent-card__effort">
        · {{ entry.definition.fields.reasoningEffort }}
      </span>
    </p>

    <template #footer>
    <div class="agent-card__usage">
      <dl v-if="stats" class="agent-card__stats">
        <div v-for="stat in stats" :key="stat.key" class="agent-card__stat">
          <dt class="agent-card__stat-label">{{ stat.label }}</dt>
          <dd class="agent-card__stat-value" :class="`agent-card__stat-value--${stat.tone || 'plain'}`">
            {{ stat.value }}
          </dd>
        </div>
      </dl>
      <span v-else class="agent-card__idle">No runs in this range</span>

      <div class="agent-card__trend">
        <UsageSparkline
          v-if="sparkValues.length > 1"
          :values="sparkValues"
          :label="`Daily runs for ${entry.name}`"
          :width="72"
          :height="18"
          :tone="entry.flags.includes('failing') ? 'danger' : 'accent'"
        />
        <span v-if="lastRun" class="agent-card__last">{{ lastRun }}</span>
      </div>
    </div>
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
  margin: 0 0 10px;
  font-size: 0.6875rem;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-card__arrow {
  color: var(--text-tertiary);
  margin: 0 4px;
}

.agent-card__effort {
  font-family: var(--font-sans);
  color: var(--text-tertiary);
}

.agent-card__usage {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

/* Three labelled figures rather than one run-on sentence, so the same
   column means the same thing on every card in the grid. */
.agent-card__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, auto));
  gap: 0 16px;
  margin: 0;
  min-width: 0;
}

.agent-card__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.agent-card__stat-label {
  font-size: 0.5625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
}

.agent-card__stat-value {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-card__stat-value--danger {
  color: var(--danger-fg);
}

.agent-card__stat-value--muted {
  color: var(--text-tertiary);
}

.agent-card__idle {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.agent-card__trend {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}

.agent-card__last {
  font-size: 0.5625rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}
</style>
