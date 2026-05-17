<script setup lang="ts">
import {
  formatNumber as formatCompactNumber,
  formatNumberFull,
  type SkillImportResult,
} from "@tracepilot/types";
import { PageHeader, PageShell, useConfirmDialog } from "@tracepilot/ui";
import { Brain } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import SkillCard from "@/components/skills/SkillCard.vue";
import SkillImportWizard from "@/components/skills/SkillImportWizard.vue";
import "@/styles/features/skills-manager.css";
import { useSkillsStore } from "@/stores/skills";

const store = useSkillsStore();
const { confirm: showConfirm } = useConfirmDialog();
const showImportWizard = ref(false);
const showNewSkillModal = ref(false);

// New skill form
const newSkillName = ref("");
const newSkillDesc = ref("");
const creating = ref(false);

const CONTEXT_WINDOW = 128_000;

const contextPct = computed(() => {
  const pct = (store.tokenBudget.enabledTokens / CONTEXT_WINDOW) * 100;
  return pct.toFixed(1);
});

onMounted(async () => {
  await store.loadSkills();
  if (store.error) return;
  await store.loadEncounteredProjectSkills();
});

function formatTokens(n: number): string {
  return formatCompactNumber(n);
}

function formatTokensWithCommas(n: number): string {
  return formatNumberFull(n);
}

async function handleCreateSkill() {
  if (!newSkillName.value.trim()) return;
  creating.value = true;
  const dir = await store.createSkill(newSkillName.value.trim(), newSkillDesc.value.trim(), "");
  creating.value = false;
  if (dir) {
    showNewSkillModal.value = false;
    newSkillName.value = "";
    newSkillDesc.value = "";
  }
}

function handleImported(_result: SkillImportResult) {
  store.clearError();
  showImportWizard.value = false;
}

async function handleDeleteSkill(dir: string) {
  const ok = await showConfirm({
    title: "Delete Skill",
    message: "Delete this skill? This cannot be undone.",
    variant: "danger",
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
  });
  if (ok) store.deleteSkill(dir);
}
</script>

<template>
  <PageShell>
    <div class="skills-manager-view">
    <PageHeader title="Skills">
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
          <button class="btn btn--primary" @click="store.clearError(); showNewSkillModal = true">
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
        <template v-if="store.encounteredLoading">
          <span class="stat-sep">&middot;</span>
          <span class="stat-chip">Scanning recent sessions…</span>
        </template>
        <span class="stat-sep">&middot;</span>
        <span class="stat-chip">
          <span class="stat-dot stat-dot--active" />
          {{ store.tokenBudget.enabledSkills }} Active
        </span>
      </div>

      <!-- Token Usage Summary -->
      <div class="token-info">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M8.5 1.5L4 9h4l-.5 5.5L12 7H8l.5-5.5z" />
        </svg>
        <span class="token-info__text">
          ~<code>{{ formatTokensWithCommas(store.tokenBudget.enabledTokens) }}</code>
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

      <!-- Filter Row: Scope + Search -->
      <div class="filter-row">
        <div class="scope-segmented">
          <button
            :class="['scope-seg-btn', { active: store.filterScope === 'global' }]"
            @click="store.setFilterScope('global')"
          >Global</button>
          <button
            :class="['scope-seg-btn', { active: store.filterScope === 'repository' }]"
            @click="store.setFilterScope('repository')"
          >Project</button>
          <button
            :class="['scope-seg-btn', { active: store.filterScope === 'all' }]"
            @click="store.setFilterScope('all')"
          >All</button>
        </div>

        <div class="search-box">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
          </svg>
          <input
            v-model="store.searchQuery"
            class="search-input"
            type="text"
            placeholder="Search skills…"
          />
        </div>
      </div>

      <!-- Loading / Error -->
      <div v-if="store.loading" class="state-message">Loading skills…</div>
      <div v-else-if="store.error" class="state-message state-message--error">
        {{ store.error }}
        <button class="btn btn--secondary btn--sm" @click="store.loadSkills()">Retry</button>
      </div>

      <template v-else>
        <div v-if="store.encounteredError" class="state-message state-message--warning">
          Session-encountered project skills could not be loaded: {{ store.encounteredError }}
        </div>

        <!-- Skills Grid -->
        <div v-if="store.filteredSkills.length > 0" class="skills-grid">
          <SkillCard
            v-for="skill in store.filteredSkills"
            :key="skill.directory"
            :skill="skill"
            @delete="handleDeleteSkill"
          />
        </div>

        <!-- Empty State -->
        <div v-else class="empty-state">
          <div class="empty-state__icon" aria-hidden="true">
            <Brain :size="48" :stroke-width="1.5" />
          </div>
          <h3 class="empty-state__title">No skills found</h3>
          <p class="empty-state__desc">
            {{ store.searchQuery ? "Try a different search term" : "Create your first skill or import one to get started" }}
          </p>
          <div class="empty-state__actions">
            <button class="btn btn--primary" @click="store.clearError(); showNewSkillModal = true">Create Skill</button>
            <button class="btn btn--secondary" @click="store.clearError(); showImportWizard = true">Import</button>
          </div>
        </div>
      </template>

      <!-- New Skill Modal -->
      <div v-if="showNewSkillModal" class="modal-overlay" @click.self="showNewSkillModal = false">
        <div class="modal">
          <div class="modal__header">
            <h3 class="modal__title">New Skill</h3>
            <button class="modal__close" @click="showNewSkillModal = false">✕</button>
          </div>
          <div class="modal__body">
            <label class="modal__label">Name</label>
            <input
              v-model="newSkillName"
              class="modal__input"
              type="text"
              placeholder="my-skill-name"
              @keydown.enter="handleCreateSkill"
            />
            <p v-if="newSkillName.length > 0 && !newSkillName.trim()" class="modal__validation-hint">Name cannot be blank</p>
            <label class="modal__label">Description <span class="modal__optional">(optional)</span></label>
            <textarea
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
