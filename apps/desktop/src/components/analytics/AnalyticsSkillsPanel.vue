<script setup lang="ts">
/**
 * Skills summary on the Analytics dashboard.
 *
 * It queries `skills_usage_summary` directly with the dashboard's range and
 * repository, the way the Agents panel does, because skill invocations come
 * from their own index table.
 *
 * The question this answers is what skills cost and what that bought. The
 * injected total is a floor — only invocations that recorded their content
 * contribute — so its denominator is always on screen. The listing overhead
 * of never-used skills is the one line worth acting on, and it appears only
 * when no repository filter is applied: the catalog is machine-wide, so
 * comparing it against one repository's usage would call skills unused that
 * are used constantly elsewhere.
 */
import { skillsUsageSummary } from "@tracepilot/client";
import type { SkillUsageSummary } from "@tracepilot/types";
import { formatNumber, SectionPanel, toErrorMessage } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useAnalyticsStore } from "@/stores/analytics";
import { useSkillsStore } from "@/stores/skills";
import { buildSkillEntries } from "@/utils/skills/entries";

const store = useAnalyticsStore();
const skillsStore = useSkillsStore();
const router = useRouter();

const summary = ref<SkillUsageSummary | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

watch(
  [() => store.dateRange, () => store.selectedRepo],
  async ([range, repo], _previous, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    loading.value = true;
    error.value = null;
    try {
      const result = await skillsUsageSummary({
        fromDate: range.fromDate ?? null,
        toDate: range.toDate ?? null,
        repo: repo ?? null,
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

const metrics = computed(() => {
  const value = summary.value;
  if (!value) return [];
  return [
    { key: "uses", value: formatNumber(value.totalUses), label: "Skill Uses", accent: true },
    { key: "distinct", value: formatNumber(value.skills.length), label: "Distinct Skills" },
    { key: "sessions", value: formatNumber(value.totalSessions), label: "Sessions" },
    {
      key: "injected",
      value: value.usesWithContent > 0 ? `~${formatNumber(value.totalContentTokens)}` : "—",
      label: "Tokens Injected",
    },
  ];
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

/**
 * Enabled skills with no use in this range, and what they cost per turn.
 * Suppressed under a repository filter, where "unused" would be a guess.
 */
const unused = computed(() => {
  if (store.selectedRepo || !summary.value || skillsStore.skills.length === 0) return null;
  const entries = buildSkillEntries(skillsStore.skills, summary.value, "all");
  const idle = entries.filter((entry) => entry.flags.includes("unused"));
  if (idle.length === 0) return null;
  return {
    count: formatNumber(idle.length),
    tokens: formatNumber(idle.reduce((sum, entry) => sum + entry.listingTokens, 0)),
    plural: idle.length === 1 ? "skill" : "skills",
  };
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
  <SectionPanel title="Skills">
    <template #actions>
      <button type="button" class="skills-panel__link" @click="openSkills()">Open Skills</button>
    </template>

    <p v-if="error" class="skills-panel__note" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="skills-panel__note" role="status">Loading skill uses…</p>

    <div v-else-if="summary && summary.totalUses > 0" class="skills-panel">
      <div class="skills-panel__metrics">
        <div v-for="metric in metrics" :key="metric.key" class="skills-panel__metric">
          <span
            class="skills-panel__value"
            :class="{ 'skills-panel__value--accent': metric.accent }"
          >{{ metric.value }}</span>
          <span class="skills-panel__metric-label">{{ metric.label }}</span>
        </div>
      </div>

      <div class="skills-panel__top">
        <div class="skills-panel__head">
          <h4 class="skills-panel__title">Most used skills</h4>
          <span class="skills-panel__legend">Uses</span>
          <span class="skills-panel__legend">Sessions</span>
          <span class="skills-panel__legend">Injected</span>
        </div>
        <ul class="skills-panel__list">
          <li v-for="skill in topSkills" :key="skill.name">
            <button
              type="button"
              class="skills-panel__row"
              :aria-label="`Find skill ${skill.name}: ${skill.uses} uses across ${skill.sessions} sessions, ${skill.injected} tokens injected per use`"
              @click="openSkills(skill.name)"
            >
              <span class="skills-panel__name" :title="skill.name">{{ skill.name }}</span>
              <span class="skills-panel__track" aria-hidden="true">
                <span class="skills-panel__fill" :style="{ width: skill.width }" />
              </span>
              <span class="skills-panel__figure">{{ skill.uses }}</span>
              <span class="skills-panel__figure skills-panel__figure--muted">
                {{ skill.sessions }}
              </span>
              <span class="skills-panel__figure skills-panel__figure--muted">
                {{ skill.injected }}
              </span>
            </button>
          </li>
        </ul>
      </div>

      <p v-if="unused" class="skills-panel__note">
        {{ unused.count }} enabled {{ unused.plural }} went unused here, adding about
        {{ unused.tokens }} tokens to every turn ·
        <button type="button" class="skills-panel__link" @click="openSkills()">Review them</button>
      </p>
      <p v-if="coverage" class="skills-panel__note">{{ coverage }}</p>
    </div>

    <p v-else class="skills-panel__note">No skill uses were indexed for this range.</p>
  </SectionPanel>
</template>

<style scoped>
.skills-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skills-panel__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr));
  gap: 16px;
}

.skills-panel__metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.skills-panel__value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.skills-panel__value--accent {
  color: var(--accent-fg);
}

.skills-panel__metric-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: center;
}

.skills-panel__top {
  --skill-columns: minmax(7rem, 1fr) minmax(3rem, 1.2fr) 3rem 4.5rem 5rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skills-panel__head {
  display: grid;
  grid-template-columns: var(--skill-columns);
  align-items: baseline;
  gap: 8px;
  padding: 0 8px;
}

.skills-panel__title {
  grid-column: span 2;
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.skills-panel__legend {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  text-align: right;
}

.skills-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Each row is the way into that skill, so the whole row is the target. */
.skills-panel__row {
  display: grid;
  grid-template-columns: var(--skill-columns);
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.skills-panel__row:hover {
  background: var(--neutral-subtle);
}

.skills-panel__name {
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skills-panel__row:hover .skills-panel__name {
  color: var(--text-primary);
}

.skills-panel__track {
  height: 4px;
  border-radius: var(--radius-sm);
  background: var(--canvas-inset);
  overflow: hidden;
}

.skills-panel__fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent-emphasis);
}

.skills-panel__figure {
  font-size: 0.6875rem;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
}

.skills-panel__figure--muted {
  color: var(--text-tertiary);
}

.skills-panel__link {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.6875rem;
  color: var(--accent-fg);
  cursor: pointer;
}

.skills-panel__link:hover {
  text-decoration: underline;
}

.skills-panel__note {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
</style>
