<script setup lang="ts">
/**
 * Cross-session usage for one skill.
 *
 * The four figures that answer "is this skill earning its keep?" lead: how
 * often it was used, over how many sessions, what each use costs in injected
 * context, and what it costs per turn just by being listed. Everything else
 * is context you go looking for, so it sits in collapsed sections.
 *
 * Denominators are shown wherever the CLI records a field on only some
 * invocations — a trigger split over three of 162 uses would be a lie
 * without one.
 */
import { formatNumber } from "@tracepilot/types";
import { formatRelativeTime, LoadingSpinner, Tooltip } from "@tracepilot/ui";
import { computed } from "vue";
import SkillRecentInvocations from "@/components/skillEditor/SkillRecentInvocations.vue";
import UsageBreakdownBars, { type BreakdownRow } from "@/components/usage/UsageBreakdownBars.vue";
import UsageSparkline from "@/components/usage/UsageSparkline.vue";
import UsageStackedBar, { type StackedSegment } from "@/components/usage/UsageStackedBar.vue";
import { useSkillEditorContext } from "@/composables/useSkillEditor";
import { USAGE_RANGE_LABELS, zeroFilledDays } from "@/utils/usage/range";

const ctx = useSkillEditorContext();

const stats = computed(() => ctx.usage?.stats ?? null);
const rangeLabel = computed(() => USAGE_RANGE_LABELS[ctx.usageRange]);

const dailyUses = computed(() =>
  zeroFilledDays(stats.value?.dailyUses ?? [], ctx.usageRange, stats.value?.firstUsed ?? null),
);

/** The headline figures, each with the caveat it needs in its tooltip. */
const kpis = computed(() => {
  const value = stats.value;
  if (!value) return [];
  const listing = ctx.tokenUsage.frontmatterTokens;
  return [
    {
      key: "uses",
      label: "Uses",
      value: formatNumber(value.uses),
      note: `${formatNumber(value.sessions)} session${value.sessions === 1 ? "" : "s"}`,
      description: `Invoked ${formatNumber(value.uses)} times across ${formatNumber(value.sessions)} session${value.sessions === 1 ? "" : "s"} in ${rangeLabel.value}.`,
    },
    {
      key: "repos",
      label: "Repositories",
      value: formatNumber(value.repositories),
      note: value.repositories === 0 ? "None recorded" : "distinct",
      description: "Repositories whose sessions invoked this skill.",
    },
    {
      key: "injected",
      label: "Injected per use",
      value:
        value.medianContentTokens != null ? `~${formatNumber(value.medianContentTokens)}` : "—",
      note:
        value.usesWithContent > 0
          ? `median of ${formatNumber(value.usesWithContent)} of ${formatNumber(value.uses)}`
          : "No content recorded",
      description:
        value.usesWithContent > 0
          ? `Median estimated tokens this skill added to the context when invoked, over the ${formatNumber(value.usesWithContent)} invocations that recorded their content.`
          : "No invocation recorded its content, so the injected cost is unknown.",
    },
    {
      key: "listing",
      label: "Listing cost",
      value: `~${formatNumber(listing)}`,
      note: "every turn while enabled",
      description:
        "Estimated tokens the frontmatter adds to every turn while this skill is enabled, whether or not it is used.",
    },
  ];
});

/**
 * Shown only when at least one invocation recorded a trigger. A split where
 * every slice is "unknown" tells you nothing the coverage note does not.
 */
const triggers = computed<StackedSegment[]>(() => {
  const value = stats.value;
  if (!value) return [];
  return [
    { key: "user", label: "You invoked it", value: value.userInvoked, tone: "accent" },
    { key: "agent", label: "The model invoked it", value: value.agentInvoked, tone: "success" },
    { key: "unknown", label: "Not recorded", value: value.unknownTrigger, tone: "neutral" },
  ];
});
const triggerKnown = computed(
  () => (stats.value?.userInvoked ?? 0) + (stats.value?.agentInvoked ?? 0) > 0,
);

const invokedBy = computed<BreakdownRow[]>(
  () =>
    ctx.usage?.invokedBy.map((row) => ({
      key: row.label,
      label: row.label,
      value: row.uses,
    })) ?? [],
);

const models = computed<BreakdownRow[]>(() => {
  const value = stats.value;
  if (!value) return [];
  const rows = (ctx.usage?.models ?? []).map((row) => ({
    key: row.label,
    label: row.label,
    value: row.uses,
  }));
  const missing = value.uses - rows.reduce((sum, row) => sum + row.value, 0);
  if (missing > 0) rows.push({ key: "not-recorded", label: "Not recorded", value: missing });
  return rows;
});

const repositories = computed<BreakdownRow[]>(
  () =>
    ctx.usage?.repositories.map((row) => ({
      key: row.label,
      label: row.label,
      value: row.uses,
    })) ?? [],
);

/** Directories this name resolved to — two means two installs, not one. */
const paths = computed<BreakdownRow[]>(
  () =>
    stats.value?.paths.map((path) => ({
      key: path.directory,
      label: path.path,
      value: path.uses,
    })) ?? [],
);

const lastUsed = computed(() =>
  stats.value?.lastUsed ? formatRelativeTime(stats.value.lastUsed) : null,
);
const firstUsed = computed(() =>
  stats.value?.firstUsed ? formatRelativeTime(stats.value.firstUsed) : null,
);

/**
 * The installed file differs from the content of the last invocation, so the
 * figures above describe an older version of this skill.
 */
const drifted = computed(
  () =>
    Boolean(stats.value?.latestContentSha256) &&
    Boolean(ctx.installedSha256) &&
    stats.value?.latestContentSha256 !== ctx.installedSha256,
);

const fallbackOnly = computed(
  () => (stats.value?.fallbackUses ?? 0) > 0 && stats.value?.usesWithContent === 0,
);
</script>

<template>
  <div class="skill-usage">
    <p v-if="ctx.usageError" class="skill-usage__error" role="alert">{{ ctx.usageError }}</p>
    <div v-else-if="ctx.usageLoading && !stats" class="skill-usage__loading">
      <LoadingSpinner size="sm" />
      Loading usage…
    </div>

    <template v-else-if="stats && stats.uses > 0">
      <p v-if="drifted" class="skill-usage__notice">
        This skill has changed since it was last used, so these figures describe an earlier
        version of it.
      </p>
      <p v-if="fallbackOnly" class="skill-usage__notice skill-usage__notice--muted">
        These invocations were recorded as skill tool calls without a content event, so their
        injected cost is unknown.
      </p>

      <dl class="skill-usage__summary">
        <div v-for="kpi in kpis" :key="kpi.key" :title="kpi.description">
          <dt>{{ kpi.label }}</dt>
          <dd>{{ kpi.value }}</dd>
          <small>{{ kpi.note }}</small>
        </div>
      </dl>

      <section class="skill-usage__section">
        <h4 class="skill-usage__title">
          Uses over {{ rangeLabel }}
          <span v-if="lastUsed" class="skill-usage__denominator">last used {{ lastUsed }}</span>
        </h4>
        <UsageSparkline
          v-if="dailyUses.length > 1"
          class="skill-usage__trend"
          :values="dailyUses"
          :label="`Daily uses for ${stats.name}`"
          :width="320"
          :height="32"
        />
        <p v-if="firstUsed" class="skill-usage__empty">First used {{ firstUsed }}.</p>
      </section>

      <section class="skill-usage__section">
        <h4 class="skill-usage__title">
          Who invoked it
          <Tooltip
            v-if="!triggerKnown"
            text="Copilot CLI only began recording whether a skill was invoked by you or by the model in 1.0.49. Earlier invocations are shown as not recorded rather than guessed."
            position="bottom"
          >
            <span class="skill-usage__denominator" tabindex="0">not recorded before CLI 1.0.49</span>
          </Tooltip>
        </h4>
        <UsageStackedBar :segments="triggers" :total="stats.uses" />
      </section>

      <details class="skill-usage__more" :open="invokedBy.length > 1">
        <summary>Agents, models and repositories</summary>
        <div class="skill-usage__more-body">
          <div>
            <h4 class="skill-usage__title">
              Invoked by
              <span class="skill-usage__denominator">
                {{ formatNumber(stats.subagentUses) }} of {{ formatNumber(stats.uses) }} by subagents
              </span>
            </h4>
            <UsageBreakdownBars :rows="invokedBy" :total="stats.uses" />
          </div>
          <div>
            <h4 class="skill-usage__title">Models in use at the time</h4>
            <UsageBreakdownBars
              :rows="models"
              :total="stats.uses"
              empty-text="No invocation recorded a model."
            />
          </div>
          <div v-if="repositories.length">
            <h4 class="skill-usage__title">Repositories</h4>
            <UsageBreakdownBars :rows="repositories" :total="stats.uses" />
          </div>
        </div>
      </details>

      <details class="skill-usage__more" :open="paths.length > 1">
        <summary>
          Where it was loaded from
          <span v-if="paths.length > 1" class="skill-usage__denominator">
            {{ paths.length }} directories
          </span>
        </summary>
        <div class="skill-usage__more-body">
          <UsageBreakdownBars
            :rows="paths"
            :total="stats.uses"
            :limit="10"
            empty-text="No invocation recorded a path, which is how SDK-provided skills appear."
          />
          <p v-if="stats.contentVersions > 1" class="skill-usage__empty">
            {{ stats.contentVersions }} distinct versions of this skill were invoked in this range.
          </p>
        </div>
      </details>

      <section class="skill-usage__section">
        <h4 class="skill-usage__title">Recent uses</h4>
        <SkillRecentInvocations :invocations="ctx.usage?.recentInvocations ?? []" />
      </section>
    </template>

    <p v-else class="skill-usage__empty">
      This skill was not invoked in {{ rangeLabel }}.
    </p>
  </div>
</template>

<style scoped>
.skill-usage {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.skill-usage__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
  margin: 0;
  padding: 16px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.skill-usage__summary dt,
.skill-usage__summary small {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.skill-usage__summary dd {
  margin: 4px 0;
  font-size: 1.25rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

@container (min-width: 560px) {
  .skill-usage__summary {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.skill-usage__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skill-usage__trend {
  width: 100%;
}

.skill-usage__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.skill-usage__denominator {
  font-size: 0.625rem;
  font-weight: 400;
  color: var(--text-tertiary);
}

/* Context you go looking for, rather than a wall of bars on arrival. */
.skill-usage__more > summary {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 0;
  list-style-position: inside;
}

.skill-usage__more > summary:hover {
  color: var(--text-primary);
}

.skill-usage__more-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0 4px;
}

.skill-usage__empty,
.skill-usage__loading {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-usage__notice {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--attention-subtle);
  border: 1px solid color-mix(in srgb, var(--attention-fg) 22%, transparent);
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.skill-usage__notice--muted {
  background: var(--canvas-subtle);
  border-color: var(--border-default);
  color: var(--text-tertiary);
}

.skill-usage__error {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--danger-subtle);
  color: var(--danger-fg);
  font-size: 0.75rem;
}
</style>
