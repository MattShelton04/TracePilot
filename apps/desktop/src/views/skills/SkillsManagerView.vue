<script setup lang="ts">
import type { SkillImportResult } from "@tracepilot/types";
import { PageHeader, PageShell, useConfirmDialog } from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import SkillCard from "@/components/skills/SkillCard.vue";
import SkillImportWizard from "@/components/skills/SkillImportWizard.vue";
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

onMounted(() => {
  store.loadSkills();
});

function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatTokensWithCommas(n: number): string {
  return n.toLocaleString("en-US");
}

async function handleCreateSkill() {
  if (!newSkillName.value.trim()) return;
  creating.value = true;
  const dir = await store.createSkill(
    newSkillName.value.trim(),
    newSkillDesc.value.trim(),
    "",
  );
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
            :class="['scope-seg-btn', { active: store.filterScope === 'all' }]"
            @click="store.setFilterScope('all')"
          >All</button>
          <button
            :class="['scope-seg-btn', { active: store.filterScope === 'global' }]"
            @click="store.setFilterScope('global')"
          >Global</button>
          <button
            :class="['scope-seg-btn', { active: store.filterScope === 'repository' }]"
            @click="store.setFilterScope('repository')"
          >Project</button>
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

      <!-- Skills Grid -->
      <div v-else-if="store.filteredSkills.length > 0" class="skills-grid">
        <SkillCard
          v-for="skill in store.filteredSkills"
          :key="skill.directory"
          :skill="skill"
          @delete="handleDeleteSkill"
        />
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <div class="empty-state__icon">🧠</div>
        <h3 class="empty-state__title">No skills found</h3>
        <p class="empty-state__desc">
          {{ store.searchQuery ? "Try a different search term" : "Create your first skill or import one to get started" }}
        </p>
        <div class="empty-state__actions">
          <button class="btn btn--primary" @click="store.clearError(); showNewSkillModal = true">Create Skill</button>
          <button class="btn btn--secondary" @click="store.clearError(); showImportWizard = true">Import</button>
        </div>
      </div>

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
  </PageShell>
</template>

<style scoped>
/* ── Stats Strip ─────────────────────────────────────────── */
.stats-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 0 2px;
  flex-wrap: wrap;
}

.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.stat-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stat-dot--installed {
  background: var(--accent-fg);
}

.stat-dot--global {
  background: var(--accent-fg);
}

.stat-dot--project {
  background: var(--success-fg);
}

.stat-dot--active {
  background: var(--success-fg);
}

.stat-sep {
  color: var(--text-tertiary);
  font-size: 0.625rem;
  user-select: none;
}

/* ── Token Info ──────────────────────────────────────────── */
.token-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  margin-top: 8px;
  background: var(--accent-subtle, rgba(99, 102, 241, 0.04));
  border: 1px solid rgba(99, 102, 241, 0.12);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.token-info svg {
  width: 14px;
  height: 14px;
  color: var(--accent-fg);
  flex-shrink: 0;
  opacity: 0.7;
}

.token-info__text {
  flex: 1;
}

.token-info code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.6875rem;
  color: var(--accent-fg);
  background: var(--accent-muted);
  padding: 1px 5px;
  border-radius: 3px;
}

.token-info__bar {
  width: 80px;
  height: 6px;
  background: var(--canvas-inset);
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
}

.token-info__bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent-emphasis);
  transition: width 0.3s ease;
}

/* ── Filter Row ──────────────────────────────────────────── */
.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 20px;
  flex-wrap: wrap;
}

/* ── Scope Segmented Control ─────────────────────────────── */
.scope-segmented {
  display: inline-flex;
  gap: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  flex-shrink: 0;
}

.scope-seg-btn {
  padding: 6px 16px;
  height: 32px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-tertiary);
  background: var(--canvas-default, var(--canvas-subtle));
  border: none;
  border-right: 1px solid var(--border-default);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.scope-seg-btn:last-child {
  border-right: none;
}

.scope-seg-btn:hover {
  color: var(--text-primary);
  background: var(--canvas-subtle);
}

.scope-seg-btn.active {
  color: var(--accent-fg);
  background: var(--accent-muted);
  font-weight: 600;
}

/* ── Search ──────────────────────────────────────────────── */
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 32px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  max-width: 240px;
  flex: 1;
  transition: border-color var(--transition-fast);
  box-sizing: border-box;
}

.search-box:focus-within {
  border-color: var(--accent-fg);
}

.search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

/* ── Buttons ─────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.btn svg {
  width: 14px;
  height: 14px;
}

.btn--primary {
  background: var(--gradient-accent, var(--accent-emphasis));
  border: 1px solid transparent;
  color: var(--text-on-emphasis, #fff);
  font-weight: 600;
  box-shadow: 0 1px 6px rgba(99, 102, 241, 0.35);
}

.btn--primary:hover:not(:disabled) {
  box-shadow: 0 3px 14px rgba(99, 102, 241, 0.45);
  transform: translateY(-1px);
}

.btn--primary:active {
  transform: translateY(0);
}

.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn--secondary {
  background: var(--canvas-default, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.btn--secondary:hover {
  color: var(--text-primary);
  border-color: var(--accent-fg);
  background: var(--accent-subtle, var(--canvas-inset));
}

.btn--ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-tertiary);
}

.btn--ghost:hover {
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border-color: var(--border-default);
}

.btn--sm {
  padding: 4px 10px;
  font-size: 0.75rem;
}

/* ── Skills Grid ─────────────────────────────────────────── */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

/* ── State Messages ──────────────────────────────────────── */
.state-message {
  text-align: center;
  padding: 40px 20px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.state-message--error {
  color: var(--danger-fg);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

/* ── Empty State ─────────────────────────────────────────── */
.empty-state {
  text-align: center;
  padding: 60px 20px;
}

.empty-state__icon {
  font-size: 3rem;
  margin-bottom: 12px;
}

.empty-state__title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.empty-state__desc {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0 0 20px;
}

.empty-state__actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

/* ── Modal ───────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.modal {
  width: 440px;
  max-width: 90vw;
  background: var(--canvas-default);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-lg);
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-muted);
}

.modal__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.modal__close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 1rem;
  padding: 4px;
}

.modal__close:hover {
  color: var(--text-primary);
}

.modal__body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.modal__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.modal__input {
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.modal__input:focus {
  border-color: var(--accent-fg);
}

.modal__textarea {
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  font-family: inherit;
  resize: vertical;
  transition: border-color var(--transition-fast);
}

.modal__textarea:focus {
  border-color: var(--accent-fg);
}

.modal__hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin: 8px 0 0;
  font-style: italic;
}

.modal__validation-hint {
  font-size: 0.75rem;
  color: var(--danger-fg);
  margin: 2px 0 0;
}

.modal__optional {
  font-weight: 400;
  color: var(--text-tertiary);
  text-transform: none;
  letter-spacing: 0;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-muted);
}
</style>
