<script setup lang="ts">
/**
 * Skills summary on the Analytics dashboard.
 *
 * It queries `skills_usage_summary` directly with the dashboard's range,
 * repository and source, the way the Agents panel does, because skill
 * invocations come from their own index table.
 *
 * The question this answers is what skills cost and what that bought. The
 * injected total is a floor — only invocations that recorded their content
 * contribute — so its denominator is always on screen. The listing overhead
 * of never-used skills is the one line worth acting on, and it appears only
 * when no repository or source filter is applied: the catalog is
 * machine-wide, so comparing it against one repository's or source's usage
 * would call skills unused that are used constantly elsewhere.
 */
import { skillsUsageSummary } from "@tracepilot/client";
import type { SkillUsageSummary } from "@tracepilot/types";
import { formatNumber, toErrorMessage } from "@tracepilot/ui";
import { ArrowRight, BookOpen, Database, Layers, Sparkles, TriangleAlert } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useFirstReveal } from "@/composables/useFirstReveal";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useAnalyticsStore } from "@/stores/analytics";
import { useSkillsStore } from "@/stores/skills";
import { buildSkillEntries } from "@/utils/skills/entries";

const store = useAnalyticsStore();
const skillsStore = useSkillsStore();
const router = useRouter();

const summary = ref<SkillUsageSummary | null>(null);
const panelRoot = ref<HTMLElement | null>(null);
// The panel loads its own data, usually after the dashboard's reveal window.
const { revealing } = useFirstReveal({
  key: "analytics:skills",
  ready: () => (summary.value?.totalUses ?? 0) > 0,
  root: panelRoot,
  countUpSelector: ".skills-panel__value",
});
const loading = ref(false);
const error = ref<string | null>(null);

// A finished reindex refreshes the figures in place; only a new filter (or
// the first load) shows the loading note.
watch(
  [
    () => store.dateRange,
    () => store.selectedRepo,
    () => store.selectedSource,
    () => store.dataRevision,
  ],
  async ([range, repo, source, revision], previous, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    const [oldRange, oldRepo, oldSource, oldRevision] = previous;
    const reindexOnly =
      summary.value !== null &&
      revision !== oldRevision &&
      range === oldRange &&
      repo === oldRepo &&
      source === oldSource;
    if (!reindexOnly) loading.value = true;
    error.value = null;
    try {
      const result = await skillsUsageSummary({
        fromDate: range.fromDate ?? null,
        toDate: range.toDate ?? null,
        repo: repo ?? null,
        source: source ?? null,
      });
      if (active) summary.value = result;
    } catch (cause) {
      if (active) error.value = toErrorMessage(cause);
    } finally {
      if (active) loading.value = false;
    }
  },
  { immediate: true, deep: true },
);

// The catalog is only needed for the unused-skills line, and the manager may
// never have been opened, so fetch it once here.
watch(
  () => skillsStore.skills.length,
  (length) => {
    if (length === 0 && !skillsStore.loading) skillsStore.loadSkills();
  },
  { immediate: true },
);

/**
 * Enabled skills with no use in this range, and what they cost per turn.
 * Suppressed under a repository or source filter, where "unused" would be a
 * guess.
 */
const unused = computed(() => {
  if (store.selectedRepo || store.selectedSource) return null;
  if (!summary.value || skillsStore.skills.length === 0) return null;
  const entries = buildSkillEntries(skillsStore.skills, summary.value, "all");
  const idle = entries.filter((entry) => entry.flags.includes("unused"));
  if (idle.length === 0) return null;
  return {
    count: formatNumber(idle.length),
    tokens: formatNumber(idle.reduce((sum, entry) => sum + entry.listingTokens, 0)),
    plural: idle.length === 1 ? "skill" : "skills",
  };
});

/** The same four-tile header as Agents, so the two panels line up. */
const tiles = computed(() => {
  const value = summary.value;
  if (!value) return [];
  const last = unused.value
    ? {
        key: "unused",
        icon: TriangleAlert,
        label: "Unused",
        value: unused.value.count,
        detail: `~${unused.value.tokens} tokens`,
      }
    : {
        key: "per-session",
        icon: Layers,
        label: "Per session",
        value: (value.totalUses / Math.max(1, value.totalSessions)).toFixed(1),
        detail: "average uses",
      };
  return [
    {
      key: "uses",
      icon: Sparkles,
      label: "Uses",
      value: formatNumber(value.totalUses),
      detail: `${formatNumber(value.totalSessions)} session${value.totalSessions === 1 ? "" : "s"}`,
    },
    {
      key: "distinct",
      icon: BookOpen,
      label: "Distinct",
      value: formatNumber(value.skills.length),
      detail: "skills used",
    },
    {
      key: "injected",
      icon: Database,
      label: "Injected",
      value: value.usesWithContent > 0 ? `~${formatNumber(value.totalContentTokens)}` : "—",
      detail: `${formatNumber(value.usesWithContent)} of ${formatNumber(value.totalUses)} uses`,
    },
    last,
  ];
});

/** Who asked for the skill: the user, the agent, or (before CLI 1.0.49) unknown. */
const triggers = computed(() => {
  const value = summary.value;
  if (!value || value.totalUses === 0) return [];
  const sum = (key: "userInvoked" | "agentInvoked") =>
    value.skills.reduce((total, skill) => total + skill[key], 0);
  const user = sum("userInvoked");
  const agent = sum("agentInvoked");
  return [
    { key: "user", label: "Asked by you", value: user, color: "var(--accent-fg)" },
    { key: "agent", label: "Chosen by the agent", value: agent, color: "var(--done-fg)" },
    {
      key: "unknown",
      label: "Trigger not recorded",
      value: Math.max(0, value.totalUses - user - agent),
      color: "var(--text-tertiary)",
    },
  ]
    .filter((segment) => segment.value > 0)
    .map((segment) => ({ ...segment, width: (segment.value / value.totalUses) * 100 }));
});

/** Ranked by uses, with what each use costs in injected context. */
const topSkills = computed(() => {
  const skills = summary.value?.skills ?? [];
  const max = Math.max(1, ...skills.map((skill) => skill.uses));
  return skills.slice(0, 6).map((skill) => ({
    name: skill.name,
    uses: formatNumber(skill.uses),
    width: `${Math.max(2, (skill.uses / max) * 100)}%`,
    sessions: formatNumber(skill.sessions),
    injected:
      skill.medianContentTokens != null ? `~${formatNumber(skill.medianContentTokens)}` : "—",
  }));
});

/** Denominator for the injected total, which not every use contributes to. */
const coverage = computed(() => {
  const value = summary.value;
  if (!value || value.totalUses === 0 || value.usesWithContent === value.totalUses) return null;
  return `${formatNumber(value.usesWithContent)} of ${formatNumber(value.totalUses)} uses recorded their content`;
});

function openSkills(search?: string) {
  pushRoute(router, ROUTE_NAMES.skillsManager, search ? { query: { q: search } } : {});
}
</script>

<template>
  <OverviewPanel
    title="Skills"
    :flush="!!summary && summary.totalUses > 0 && !loading && !error"
    data-testid="analytics-skills"
  >
    <template #aside>
      <button type="button" class="ad-link" @click="openSkills()">
        Open Skills <ArrowRight :size="12" aria-hidden="true" />
      </button>
    </template>

    <p v-if="error" class="ad-empty" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="ad-empty" role="status">Loading skill uses…</p>

    <div
      v-else-if="summary && summary.totalUses > 0"
      ref="panelRoot"
      class="ad-usage"
      :class="{ 'chart-reveal': revealing }"
    >
      <div class="ad-tiles ad-usage__tiles">
        <div v-for="tile in tiles" :key="tile.key" class="ad-tile">
          <div class="ad-tile__label">
            <component :is="tile.icon" :size="13" aria-hidden="true" />{{ tile.label }}
          </div>
          <div class="ad-tile__value skills-panel__value">{{ tile.value }}</div>
          <div class="ad-tile__detail" :title="tile.detail">{{ tile.detail }}</div>
        </div>
      </div>

      <div class="ad-usage__body">
        <div class="ad-usage__split">
          <div class="ad-meter ad-meter--lg" aria-hidden="true">
            <i
              v-for="segment in triggers"
              :key="segment.key"
              :title="`${segment.label}: ${segment.value}`"
              :style="{ width: `${segment.width}%`, background: segment.color }"
              data-reveal="grow-x"
            />
          </div>
          <div class="ad-legend ad-legend--nowrap">
            <span v-for="segment in triggers" :key="segment.key" class="ad-usage__item">
              <i class="ad-sw" :style="{ background: segment.color }" />{{ segment.label }}<b>{{ segment.value }}</b>
            </span>
          </div>
        </div>

        <div class="ad-rows" role="list" aria-label="Most used skills">
          <div class="ad-rowh ad-usage__grid">
            <span>Most used</span><span /><span class="ad-num">Uses</span>
            <span class="ad-num">Sessions</span><span class="ad-num">Each</span>
          </div>
          <button
            v-for="skill in topSkills"
            :key="skill.name"
            type="button"
            role="listitem"
            class="ad-row ad-usage__grid skills-panel__row"
            :aria-label="`Find skill ${skill.name}: ${skill.uses} uses across ${skill.sessions} sessions, ${skill.injected} tokens injected per use`"
            @click="openSkills(skill.name)"
          >
            <span class="ad-row__name">
              <span class="skills-panel__name" :title="skill.name">{{ skill.name }}</span>
            </span>
            <span class="ad-track" aria-hidden="true">
              <i data-reveal="grow-x" :style="{ width: skill.width, background: 'var(--done-fg)' }" />
            </span>
            <span class="ad-num">{{ skill.uses }}</span>
            <span class="ad-num ad-num--muted">{{ skill.sessions }}</span>
            <span class="ad-num ad-num--muted">{{ skill.injected }}</span>
          </button>
        </div>

        <div v-if="unused || coverage" class="ad-usage__notes">
          <p v-if="unused" class="ad-note">
            {{ unused.count }} enabled {{ unused.plural }} went unused here, adding about
            {{ unused.tokens }} listing tokens across all projects ·
            <button type="button" class="ad-link" @click="openSkills()">Review them</button>
          </p>
          <p v-if="coverage" class="ad-note">{{ coverage }}</p>
        </div>
      </div>
    </div>

    <p v-else class="ad-empty">
      <b>No skill uses</b>
      No skill uses were indexed for this range.
    </p>
  </OverviewPanel>
</template>
