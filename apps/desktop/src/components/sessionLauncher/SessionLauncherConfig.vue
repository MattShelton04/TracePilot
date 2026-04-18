<script setup lang="ts">
import { SearchableSelect } from "@tracepilot/ui";
import { useSessionLauncherContext } from "@/composables/useSessionLauncher";

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
          <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <label class="form-label" style="margin-bottom: 0;">Repository <span class="required">*</span></label>
            <button
              v-if="repoPath"
              type="button"
              style="background: none; border: none; font-size: 0.75rem; color: var(--accent-fg); cursor: pointer;"
              :disabled="fetchingRemote"
              @click="handleFetchRemote"
            >
              {{ fetchingRemote ? 'Fetching...' : 'Fetch Latest From Remote' }}
            </button>
          </div>
          <div class="repo-picker" style="margin-top: 6px;">
            <select
              v-if="worktreeStore.registeredRepos.length || prefsStore.recentRepoPaths.length"
              class="form-input form-select repo-recent"
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
          <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <label class="form-label" style="margin-bottom: 0;">Branch</label>
            <button
              v-if="defaultBranch && branch !== defaultBranch"
              type="button"
              style="background: none; border: none; font-size: 0.75rem; color: var(--accent-fg); cursor: pointer;"
              @click="resetBranch"
            >
              Reset to Default
            </button>
          </div>
          <div style="margin-top: 6px;">
            <SearchableSelect
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
          <label class="form-label">Model</label>
          <select v-model="selectedModel" class="form-input form-select" @change="clearTemplateSelection">
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
          <label class="form-label">Reasoning Effort</label>
          <div class="btn-group">
            <button
              v-for="level in (['low', 'medium', 'high'] as const)"
              :key="level"
              class="btn-group-item"
              :class="{ active: reasoningEffort === level }"
              @click="reasoningEffort = level; clearTemplateSelection()"
            >{{ tierLabel(level) }}</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
