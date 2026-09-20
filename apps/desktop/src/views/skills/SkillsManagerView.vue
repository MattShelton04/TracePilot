<script setup lang="ts">
import {
  formatNumber as formatCompactNumber,
  formatNumberFull,
  type SkillBatchImportResult,
} from "@tracepilot/types";
import {
  Banner,
  PageHeader,
  PageShell,
  SearchInput,
  SegmentedControl,
  type SegmentOption,
  Select,
  Tooltip,
  useConfirmDialog,
  useOverlayFocus,
} from "@tracepilot/ui";
import { Brain } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SkillCard from "@/components/skills/SkillCard.vue";
import SkillImportWizard from "@/components/skills/SkillImportWizard.vue";
import { confirmSkillDeletion } from "@/components/skills/skillActions";
import {
  SKILL_FLAG_BADGES,
  SKILL_FLAG_FILTERS,
  SKILL_SCOPE_FILTERS,
} from "@/components/skills/skillBadges";
import { SKILL_TOKEN_ESTIMATE_TOOLTIP } from "@/components/skills/tokenEstimate";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import "@/styles/features/skills-manager.css";
import { useSkillsStore } from "@/stores/skills";
import type { SkillFlag, SkillScopeFilter, SkillSortKey } from "@/utils/skills/entries";
import { USAGE_RANGE_LABELS, USAGE_RANGES, type UsageRange } from "@/utils/usage/range";

const store = useSkillsStore();
const router = useRouter();
const route = useRoute();
const { confirm: showConfirm } = useConfirmDialog();
const showImportWizard = ref(false);
const showNewSkillModal = ref(false);
const newSkillPanelRef = ref<HTMLElement | null>(null);
useOverlayFocus({
  active: showNewSkillModal,
  panel: newSkillPanelRef,
  onEscape: () => {
    showNewSkillModal.value = false;
  },
});

// New skill form
const newSkillName = ref("");
const newSkillDesc = ref("");
const creating = ref(false);
const createError = ref<string | null>(null);

const CONTEXT_WINDOW = 128_000;

const contextPct = computed(() => {
  const pct = (store.tokenBudget.enabledTokens / CONTEXT_WINDOW) * 100;
  return pct.toFixed(1);
});

const scopeOptions = computed<SegmentOption[]>(() =>
  SKILL_SCOPE_FILTERS.map((option) => ({
    ...option,
    count:
      option.value === "all"
        ? store.entries.length
        : store.entries.filter((entry) => entry.scope === option.value).length,
  })).filter((option) => option.value === "all" || (option.count ?? 0) > 0),
);

const rangeOptions = computed<SegmentOption[]>(() => [...USAGE_RANGES]);

const sortOptions = [
  { value: "uses", label: "Most used" },
  { value: "lastUsed", label: "Last used" },
  { value: "listingCost", label: "Listing cost" },
  { value: "name", label: "Name" },
] as const;

const rangeLabel = computed(() => USAGE_RANGE_LABELS[store.range]);

/**
 * No usage came back for this range. Which of the two reasons that is depends
 * on the range: over all time it means the index has nothing, and over a
 * window it means only that nothing happened inside it. Conflating the two
 * would tell a reader with months-old skill use that their index is broken.
 */
const noUsageInRange = computed(
  () =>
    !store.usageLoading && !store.usageError && store.usage !== null && store.usage.totalUses === 0,
);
const usageNeverIndexed = computed(() => noUsageInRange.value && store.range === "all");

// A deep link (from the Analytics card or a conversation row) must be visible
// even after a previous visit narrowed the filters.
watch(
  () => route.query.q,
  (query) => {
    if (typeof query !== "string") return;
    store.clearFilters();
    store.searchQuery = query;
  },
  { immediate: true },
);

onMounted(() => store.loadAll());

function formatTokensWithCommas(n: number): string {
  return formatNumberFull(n);
}

async function handleCreateSkill() {
  if (creating.value || !newSkillName.value.trim()) return;
  createError.value = null;
  creating.value = true;
  const dir = await store.createSkill(newSkillName.value.trim(), newSkillDesc.value.trim(), "");
  creating.value = false;
  if (dir) {
    showNewSkillModal.value = false;
    newSkillName.value = "";
    newSkillDesc.value = "";
    pushRoute(router, ROUTE_NAMES.skillEditor, { params: { name: dir } });
  } else {
    createError.value = store.error ?? "Could not create the skill. Try again.";
    store.clearError();
  }
}

function openNewSkill() {
  store.clearError();
  createError.value = null;
  showNewSkillModal.value = true;
}

function handleImported(_result: SkillBatchImportResult) {
  store.clearError();
  showImportWizard.value = false;
}

async function handleDeleteSkill(dir: string) {
  await confirmSkillDeletion(showConfirm, store.deleteSkill, dir);
}

/** The two warning counts are the way into their own evidence. */
function showUnused() {
  store.showOnlyFlag("unused");
}

function showMissing() {
  store.clearFilters();
  store.setFilterScope("missing");
}

async function handleToggleEnabled(name: string, enabled: boolean) {
  await store.setSkillEnabled(name, enabled);
}
</script>

<template>
  <PageShell>
    <div class="skills-manager-view">
      <PageHeader title="Skills" subtitle="What is installed, what gets used, and what each one costs">
        <template #icon>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
            <path d="M9 1L5 9h4l-2 6 6-8H9l2-6z"/>
          </svg>
        </template>
        <template #actions>
          <button class="btn btn--ghost" @click="store.clearError(); showImportWizard = true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <path d="M8 2v8M4 6l4-4 4 4" /><path d="M2 12v2h12v-2" />
            </svg>
            Import
          </button>
          <button class="btn btn--primary" @click="openNewSkill">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
              <line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />
            </svg>
            New Skill
          </button>
        </template>
      </PageHeader>

      <!-- Stats Strip -->
      <div class="stats-strip">
        <span class="stat-chip">
          <span class="stat-dot stat-dot--installed" />
          {{ store.tokenBudget.totalSkills }} Installed
        </span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          <span class="stat-dot stat-dot--global" />
          {{ store.globalSkills.length }} Global
        </span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          <span class="stat-dot stat-dot--project" />
          {{ store.repoSkills.length }} Project
        </span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          <span class="stat-dot stat-dot--builtin" />
          {{ store.builtinSkills.length }} Built-in
        </span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          <span class="stat-dot stat-dot--active" />
          {{ store.tokenBudget.enabledSkills }} Active
        </span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          <span class="stat-dot stat-dot--used" />
          {{ store.usageLoading ? "…" : store.usedSkillCount }} Used
          <span class="stat-chip__muted">in {{ rangeLabel }}</span>
        </span>
        <template v-if="store.unusedEnabledSkills.length">
          <span class="stat-sep">&middot;</span>
          <button
            type="button"
            class="stat-chip stat-chip--warning stat-chip--action"
            :title="`Show the ${store.unusedEnabledSkills.length} enabled skills with no use in ${rangeLabel}`"
            @click="showUnused"
          >
            {{ store.unusedEnabledSkills.length }} Unused &amp; enabled
          </button>
        </template>
        <template v-if="store.missingSkills.length">
          <span class="stat-sep">&middot;</span>
          <button
            type="button"
            class="stat-chip stat-chip--warning stat-chip--action"
            title="Show the skills that sessions invoked but are not installed here"
            @click="showMissing"
          >
            {{ store.missingSkills.length }} Not installed
          </button>
        </template>
      </div>

      <!-- Token Usage Summary -->
      <div class="token-info">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M8.5 1.5L4 9h4l-.5 5.5L12 7H8l.5-5.5z" />
        </svg>
        <span class="token-info__text">
          <Tooltip :text="SKILL_TOKEN_ESTIMATE_TOOLTIP" position="bottom">
            <code tabindex="0">~{{ formatTokensWithCommas(store.tokenBudget.enabledTokens) }}</code>
          </Tooltip>
          tokens across {{ store.tokenBudget.enabledSkills }} active skill{{ store.tokenBudget.enabledSkills === 1 ? "" : "s" }}
          · {{ contextPct }}% of 128k context
        </span>
        <div class="token-info__bar">
          <div
            class="token-info__bar-fill"
            :style="{ width: Math.min(100, Number(contextPct)) + '%' }"
          />
        </div>
      </div>

      <!-- Filter Row: Scope + Range + Sort + Search -->
      <div class="filter-row">
        <SegmentedControl
          :model-value="store.filterScope"
          :options="scopeOptions"
          @update:model-value="store.setFilterScope($event as SkillScopeFilter)"
        />
        <SegmentedControl
          :model-value="store.range"
          :options="rangeOptions"
          aria-label="Usage range"
          @update:model-value="store.setRange($event as UsageRange)"
        />
        <Select
          :model-value="store.sort"
          :options="[...sortOptions]"
          size="sm"
          aria-label="Sort skills"
          @update:model-value="store.sort = $event as SkillSortKey"
        />
        <SearchInput v-model="store.searchQuery" class="filter-row__search" placeholder="Search skills…" />
      </div>

      <div class="flag-row">
        <Tooltip
          v-for="flag in SKILL_FLAG_FILTERS"
          :key="flag"
          :text="SKILL_FLAG_BADGES[flag].title"
          position="bottom"
        >
          <button
            type="button"
            class="flag-chip"
            :class="{ 'flag-chip--active': store.filterFlags.has(flag) }"
            :aria-pressed="store.filterFlags.has(flag)"
            @click="store.toggleFlag(flag as SkillFlag)"
          >{{ SKILL_FLAG_BADGES[flag].label }}</button>
        </Tooltip>
        <button
          v-if="store.filterFlags.size || store.searchQuery || store.filterScope !== 'all'"
          type="button"
          class="flag-chip flag-chip--clear"
          @click="store.clearFilters()"
        >Clear filters</button>
      </div>

      <!-- Loading / Error -->
      <div v-if="store.loading" class="state-message">Loading skills…</div>
      <div v-else-if="store.error" class="state-message state-message--error">
        {{ store.error }}
        <button class="btn btn--secondary btn--sm" @click="store.loadSkills()">Retry</button>
      </div>

      <template v-else>
        <details v-if="store.diagnostics.length" class="state-message state-message--warning">
          <summary>
            {{ store.diagnostics.length }} skill{{ store.diagnostics.length === 1 ? '' : 's' }} could not be loaded
          </summary>
          <ul>
            <li v-for="diagnostic in store.diagnostics" :key="diagnostic.path">
              <code>{{ diagnostic.path }}</code>: {{ diagnostic.message }}
            </li>
          </ul>
        </details>

        <Banner v-if="store.usageError" tone="warning" title="Usage unavailable">
          Skills are shown without cross-session usage: {{ store.usageError }}
        </Banner>
        <Banner v-else-if="usageNeverIndexed" tone="info" title="No usage indexed yet">
          Usage appears once the session index has been rebuilt for this version. Until then every
          skill shows as never used.
        </Banner>
        <Banner
          v-else-if="noUsageInRange"
          tone="info"
          :title="`No skill uses in the last ${rangeLabel}`"
        >
          Skills are shown without usage figures for this window.
          <button type="button" class="banner-action" @click="store.setRange('all')">
            Show all time
          </button>
        </Banner>

        <!-- Skills Grid -->
        <div v-if="store.filteredSkills.length > 0" class="skills-grid">
          <SkillCard
            v-for="entry in store.filteredSkills"
            :key="entry.key"
            :entry="entry"
            :range="store.range"
            @delete="handleDeleteSkill"
            @toggle-enabled="(_dir, enabled) => handleToggleEnabled(entry.name, enabled)"
          />
        </div>

        <!-- Empty State -->
        <div v-else class="empty-state">
          <div class="empty-state__icon" aria-hidden="true">
            <Brain :size="48" :stroke-width="1.5" />
          </div>
          <h3 class="empty-state__title">No skills match</h3>
          <p class="empty-state__desc">
            {{
              store.entries.length
                ? "Try a different search, scope or flag."
                : "Create your first skill or import one to get started"
            }}
          </p>
          <div class="empty-state__actions">
            <template v-if="store.entries.length">
              <button class="btn btn--primary" @click="store.clearFilters()">Clear filters</button>
            </template>
            <template v-else>
              <button class="btn btn--primary" @click="openNewSkill">Create Skill</button>
              <button class="btn btn--secondary" @click="store.clearError(); showImportWizard = true">Import</button>
            </template>
          </div>
        </div>
      </template>

      <!-- New Skill Modal -->
      <div v-if="showNewSkillModal" class="modal-overlay" @click.self="showNewSkillModal = false">
          <div ref="newSkillPanelRef" class="modal" role="dialog" aria-modal="true" aria-label="New Skill" tabindex="-1">
          <div class="modal__header">
            <h3 class="modal__title">New Skill</h3>
            <button
              class="modal__close"
              aria-label="Close new skill dialog"
              @click="showNewSkillModal = false"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <div class="modal__body">
            <p v-if="createError" class="modal__validation-hint" role="alert">{{ createError }}</p>
            <label for="new-skill-name" class="modal__label">Name</label>
            <input
              id="new-skill-name"
              v-model="newSkillName"
              class="modal__input"
              type="text"
              placeholder="my-skill-name"
              @keydown.enter="handleCreateSkill"
            />
            <p v-if="newSkillName.length > 0 && !newSkillName.trim()" class="modal__validation-hint">Name cannot be blank</p>
            <label for="new-skill-description" class="modal__label">Description <span class="modal__optional">(optional)</span></label>
            <textarea
              id="new-skill-description"
              v-model="newSkillDesc"
              class="modal__textarea"
              rows="3"
              placeholder="What does this skill do?"
            />
            <p class="modal__hint">You'll be able to customize this skill's instructions on the next page.</p>
          </div>
          <div class="modal__footer">
            <button class="btn btn--secondary" @click="showNewSkillModal = false">Cancel</button>
            <button
              class="btn btn--primary"
              :disabled="!newSkillName.trim() || creating"
              @click="handleCreateSkill"
            >
              {{ creating ? "Creating…" : "Create" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Import Wizard -->
      <SkillImportWizard
        v-if="showImportWizard"
        @close="showImportWizard = false"
        @imported="handleImported"
      />
    </div>
  </PageShell>
</template>
