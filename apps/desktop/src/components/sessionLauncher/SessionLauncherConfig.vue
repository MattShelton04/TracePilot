<script setup lang="ts">
import { SearchableSelect } from "@tracepilot/ui";
import { useId } from "vue";
import { useSessionLauncherContext } from "@/composables/useSessionLauncher";

const fieldId = `launcher-config-${useId()}`;

const {
  store,
  prefsStore,
  worktreeStore,
  repoPath,
  branch,
  selectedModel,
  reasoningEffort,
  createWorktree,
  defaultBranch,
  fetchingRemote,
  handleFetchRemote,
  resetBranch,
  selectRecentRepo,
  handleBrowseRepo,
  clearTemplateSelection,
  tierLabel,
} = useSessionLauncherContext();
</script>

<template>
  <section class="section-block">
    <h2 class="section-label">Configuration</h2>
    <div class="section-panel">
      <div class="form-grid-2col">
        <div class="form-group">
          <div class="form-label-row">
            <label :for="`${fieldId}-repository`" class="form-label form-label--inline">Repository <span class="required">*</span></label>
            <button
              v-if="repoPath"
              type="button"
              class="link-btn"
              :disabled="fetchingRemote"
              @click="handleFetchRemote"
            >
              {{ fetchingRemote ? 'Fetching...' : 'Fetch Latest From Remote' }}
            </button>
          </div>
          <div class="repo-picker repo-picker--spaced">
            <select
              v-if="worktreeStore.registeredRepos.length || prefsStore.recentRepoPaths.length"
              class="form-input form-select repo-recent"
              aria-label="Registered or recent repository"
              :value="repoPath"
              @change="selectRecentRepo"
            >
              <option value="">Select a repository…</option>
              <optgroup v-if="worktreeStore.registeredRepos.length" label="Registered Repositories">
                <option v-for="r in worktreeStore.registeredRepos" :key="r.path" :value="r.path">{{ r.name }} — {{ r.path }}</option>
              </optgroup>
              <optgroup v-if="prefsStore.recentRepoPaths.length" label="Recent">
                <option v-for="p in prefsStore.recentRepoPaths" :key="p" :value="p">{{ p }}</option>
              </optgroup>
            </select>
            <div class="repo-input-row">
              <input
                :id="`${fieldId}-repository`"
                v-model="repoPath"
                type="text"
                class="form-input"
                placeholder="C:\git\MyProject"
                required
                @input="clearTemplateSelection"
              />
              <button class="btn btn-secondary repo-browse-btn" type="button" @click="handleBrowseRepo">Browse</button>
            </div>
          </div>
        </div>
        <div class="form-group">
          <div class="form-label-row">
            <label :for="`${fieldId}-branch`" class="form-label form-label--inline">Branch</label>
            <button
              v-if="defaultBranch && branch !== defaultBranch"
              type="button"
              class="link-btn"
              @click="resetBranch"
            >
              Reset to Default
            </button>
          </div>
          <div class="branch-select-wrap">
            <SearchableSelect
              :input-id="`${fieldId}-branch`"
              v-model="branch"
              :options="worktreeStore.branches"
              allowCustom
              :placeholder="createWorktree ? 'feature/my-branch (required)' : 'Leave blank to stay on current branch'"
              clearable
              @update:model-value="clearTemplateSelection"
            />
          </div>
          <span class="form-hint">{{ createWorktree ? 'New branch to create with the worktree' : 'Optional — checks out or creates this branch before starting' }}</span>
        </div>
        <div class="form-group">
          <label :for="`${fieldId}-model`" class="form-label">Model</label>
          <select :id="`${fieldId}-model`" v-model="selectedModel" class="form-input form-select" @change="clearTemplateSelection">
            <option value="">— Default —</option>
            <optgroup
              v-for="(group, tier) in store.modelsByTier"
              :key="tier"
              :label="tierLabel(String(tier))"
            >
              <option v-for="m in group" :key="m.id" :value="m.id">{{ m.name }}</option>
            </optgroup>
          </select>
        </div>
        <div class="form-group">
          <span :id="`${fieldId}-reasoning`" class="form-label">Reasoning Effort</span>
          <div class="btn-group" role="group" :aria-labelledby="`${fieldId}-reasoning`">
            <button
              v-for="level in (['low', 'medium', 'high'] as const)"
              :key="level"
              type="button"
              class="btn-group-item"
              :class="{ active: reasoningEffort === level }"
              :aria-pressed="reasoningEffort === level"
              @click="reasoningEffort = level; clearTemplateSelection()"
            >{{ tierLabel(level) }}</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.form-label-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  justify-content: space-between;
  align-items: flex-end;
}

.form-label--inline {
  margin-bottom: 0;
}

.link-btn {
  background: none;
  border: none;
  font-size: 0.75rem;
  color: var(--accent-fg);
  cursor: pointer;
}

.repo-picker--spaced,
.branch-select-wrap {
  margin-top: 6px;
}
</style>
