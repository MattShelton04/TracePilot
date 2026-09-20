<script setup lang="ts">
/**
 * One agent in the manager grid: identity and scope, the models it resolves
 * to, and its cross-session usage. Session-only agents (no definition on
 * disk) render the same way minus the definition-derived parts.
 */
import {
  Badge,
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

/** Zero-filled so a gap in the daily counts reads as "no runs", not as a jump. */
const sparkValues = computed(() => {
  const usage = props.entry.usage;
  if (!usage || usage.runs === 0) return [];
  const byDate = new Map(usage.dailyRuns.map((day) => [day.date, day.runs]));
  return rangeDays(props.range, usage.firstUsed).map((date) => byDate.get(date) ?? 0);
});

const usageLine = computed(() => {
  const usage = props.entry.usage;
  if (!usage || usage.runs === 0) return null;
  const parts = [`${formatNumber(usage.runs)} run${usage.runs === 1 ? "" : "s"}`];
  if (usage.durationMs.p50 != null) parts.push(`p50 ${formatDuration(usage.durationMs.p50)}`);
  const rate = failureRate(usage);
  parts.push(rate === 0 ? "no failures" : `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}% failed`);
  if (usage.lastUsed) parts.push(`last ${formatRelativeTime(usage.lastUsed)}`);
  return parts.join(" · ");
});
</script>

<template>
  <article class="agent-card" :class="{ 'agent-card--disabled': entry.disabled }">
    <div class="agent-card__accent" />

    <div class="agent-card__top">
      <div class="agent-card__icon">
        <component :is="icon" :size="18" :stroke-width="1.75" />
      </div>
      <div class="agent-card__info">
        <div class="agent-card__name-row">
          <button
            type="button"
            class="agent-card__name agent-card__open"
            :aria-label="`Open agent ${entry.name}`"
            @click="emit('open', entry)"
          >{{ entry.name }}</button>
          <span v-if="entry.displayName && entry.displayName !== entry.name" class="agent-card__display">
            {{ entry.displayName }}
          </span>
        </div>
        <p class="agent-card__desc">{{ entry.description || "No description" }}</p>
      </div>
    </div>

    <div class="agent-card__badges">
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
    </div>

    <p v-if="models.length" class="agent-card__models" :title="modelsTitle">
      <span v-for="(model, index) in models" :key="model">
        <span v-if="index > 0" class="agent-card__arrow" aria-hidden="true">→</span>{{ model }}
      </span>
      <span v-if="entry.definition?.fields.reasoningEffort" class="agent-card__effort">
        · {{ entry.definition.fields.reasoningEffort }}
      </span>
    </p>

    <div class="agent-card__usage">
      <span v-if="usageLine" class="agent-card__usage-text">{{ usageLine }}</span>
      <span v-else class="agent-card__usage-text agent-card__usage-text--muted">
        No runs in this range
      </span>
      <UsageSparkline
        v-if="sparkValues.length > 1"
        :values="sparkValues"
        :label="`Daily runs for ${entry.name}`"
        :tone="entry.flags.includes('failing') ? 'danger' : 'accent'"
      />
    </div>
  </article>
</template>

<style scoped>
.agent-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  overflow: hidden;
  transition: all 0.2s ease;
}

.agent-card:hover {
  border-color: var(--border-accent, var(--accent-fg));
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.agent-card--disabled {
  opacity: 0.7;
}

.agent-card:hover .agent-card__accent {
  opacity: 1;
}

.agent-card:has(.agent-card__open:focus-visible) {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

.agent-card__accent {
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: var(--gradient-accent, var(--accent-emphasis));
  opacity: 0;
  transition: opacity 0.2s ease;
}

.agent-card__top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.agent-card__icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--canvas-default, var(--canvas-subtle));
  color: var(--accent-fg);
  line-height: 0;
}

.agent-card__info {
  flex: 1;
  min-width: 0;
}

.agent-card__name-row {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-bottom: 2px;
  min-width: 0;
}

.agent-card__name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

/* The title's button owns the card click surface; the badges and tooltips
   stay above it so they keep their own activation. */
.agent-card__open::after {
  content: "";
  position: absolute;
  inset: 0;
}

.agent-card:hover .agent-card__name {
  color: var(--accent-fg);
}

.agent-card__display {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-card__desc {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.agent-card__badges {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.agent-card__chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
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
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border-muted, var(--border-default));
}

.agent-card__usage-text {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-card__usage-text--muted {
  color: var(--text-tertiary);
}
</style>
