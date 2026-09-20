<script setup lang="ts">
import { formatNumber } from "@tracepilot/types";
import { formatRelativeTime, LoadingSpinner, normalizePath, Tooltip } from "@tracepilot/ui";
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
      label: "Tokens per use",
      value:
        value.medianContentTokens != null ? `~${formatNumber(value.medianContentTokens)}` : "—",
      note:
        value.usesWithContent === 0
          ? "No content recorded"
          : value.usesWithContent === value.uses
            ? `median of ${formatNumber(value.uses)} uses`
            : `median of ${formatNumber(value.usesWithContent)} of ${formatNumber(value.uses)}`,
      description:
        value.usesWithContent > 0
          ? `Median estimated tokens this skill added to the context when invoked, over the ${formatNumber(value.usesWithContent)} invocations that recorded their content.`
          : "No invocation recorded its content, so the injected cost is unknown.",
    },
    {
      key: "listing",
      label: "Listing tokens",
      value: ctx.isUsageOnly ? "—" : `~${formatNumber(listing)}`,
      note: ctx.isUsageOnly ? "No installed definition" : "per turn when available",
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
      label: normalizePath(path.path),
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
  <div class="usage-detail skill-usage">
    <p v-if="ctx.usageError" class="usage-detail__error" role="alert">{{ ctx.usageError }}</p>
    <div v-else-if="ctx.usageLoading && !stats" class="usage-detail__loading">
      <LoadingSpinner size="sm" />
      Loading usage…
    </div>

    <template v-else-if="stats && stats.uses > 0">
      <p v-if="drifted" class="usage-detail__notice">
        This skill has changed since it was last used, so these figures describe an earlier
        version of it.
      </p>
      <p v-if="fallbackOnly" class="usage-detail__notice usage-detail__notice--muted">
        These invocations were recorded as skill tool calls without a content event, so their
        injected cost is unknown.
      </p>

      <p class="usage-detail__help">Usage over {{ rangeLabel }} · grouped by skill name across installs</p>
      <dl class="usage-detail__summary">
        <div v-for="kpi in kpis" :key="kpi.key" :title="kpi.description">
          <dt>{{ kpi.label }}</dt>
          <dd>{{ kpi.value }}</dd>
          <small>{{ kpi.note }}</small>
        </div>
      </dl>

      <section class="usage-detail__section">
        <h4 class="usage-detail__title">
          Uses over {{ rangeLabel }}
          <span v-if="lastUsed" class="usage-detail__denominator">last used {{ lastUsed }}</span>
        </h4>
        <UsageSparkline
          v-if="dailyUses.length > 1"
          class="usage-detail__trend"
          :values="dailyUses"
          :label="`Daily uses for ${stats.name}`"
          :width="320"
          :height="32"
        />
        <p v-if="firstUsed" class="usage-detail__empty">First used {{ firstUsed }}.</p>
      </section>

      <section class="usage-detail__section">
        <h4 class="usage-detail__title">
          Who invoked it
          <Tooltip
            v-if="!triggerKnown"
            text="Copilot CLI only began recording whether a skill was invoked by you or by the model in 1.0.49. Earlier invocations are shown as not recorded rather than guessed."
            position="bottom"
          >
            <span class="usage-detail__denominator" tabindex="0">not recorded before CLI 1.0.49</span>
          </Tooltip>
        </h4>
        <UsageStackedBar v-if="triggerKnown" :segments="triggers" :total="stats.uses" />
        <p v-else class="usage-detail__empty">
          No invocation in this range recorded who triggered it.
        </p>
      </section>

      <details class="usage-detail__more" :open="invokedBy.length > 1">
        <summary>Agents, models and repositories</summary>
        <div class="usage-detail__more-body">
          <div>
            <h4 class="usage-detail__title">
              Invoked by
              <span class="usage-detail__denominator">
                {{ formatNumber(stats.subagentUses) }} of {{ formatNumber(stats.uses) }} by subagents
              </span>
            </h4>
            <p class="usage-detail__help">Which agent loaded the skill. This is separate from whether you or the model requested it.</p>
            <UsageBreakdownBars :rows="invokedBy" :total="stats.uses" unit="uses" />
          </div>
          <div>
            <h4 class="usage-detail__title">Models in use at the time</h4>
            <p class="usage-detail__help">The model recorded when the skill was loaded, as a share of all uses.</p>
            <UsageBreakdownBars
              :rows="models"
              unit="uses"
              :total="stats.uses"
              empty-text="No invocation recorded a model."
            />
          </div>
          <div v-if="repositories.length">
            <h4 class="usage-detail__title">Repositories</h4>
            <UsageBreakdownBars :rows="repositories" :total="stats.uses" unit="uses" />
          </div>
        </div>
      </details>

      <details class="usage-detail__more" :open="paths.length > 1">
        <summary>
          Where it was loaded from
          <span v-if="paths.length > 1" class="usage-detail__denominator">
            {{ paths.length }} directories
          </span>
        </summary>
        <div class="usage-detail__more-body">
          <p class="usage-detail__help">Historical file locations for this skill name. Different paths can be separate installations.</p>
          <UsageBreakdownBars
            :rows="paths"
            unit="uses"
            wrap-labels
            :total="stats.uses"
            :limit="10"
            empty-text="No invocation recorded a path, which is how SDK-provided skills appear."
          />
          <p v-if="stats.contentVersions > 1" class="usage-detail__empty">
            {{ stats.contentVersions }} distinct versions of this skill were invoked in this range.
          </p>
        </div>
      </details>

      <section class="usage-detail__section">
        <h4 class="usage-detail__title">Recent uses</h4>
        <SkillRecentInvocations :invocations="ctx.usage?.recentInvocations ?? []" />
      </section>
    </template>

    <p v-else class="usage-detail__empty">
      This skill was not invoked in {{ rangeLabel }}.
    </p>
  </div>
</template>

<style src="../usage/usage-detail.css"></style>
