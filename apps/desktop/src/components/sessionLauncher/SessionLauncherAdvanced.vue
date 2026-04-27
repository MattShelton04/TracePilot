<script setup lang="ts">
import { SearchableSelect } from "@tracepilot/ui";
import { useSessionLauncherContext } from "@/composables/useSessionLauncher";

const {
  worktreeStore,
  showAdvanced,
  autoApprove,
  createWorktree,
  headless,
  uiServer,
  baseBranch,
  branch,
  worktreePreviewPath,
  customInstructions,
  envVars,
  addEnvVar,
  removeEnvVar,
  clearTemplateSelection,
} = useSessionLauncherContext();
</script>

<template>
  <section class="section-block">
    <button class="advanced-trigger" @click="showAdvanced = !showAdvanced">
      <span class="advanced-arrow" :class="{ open: showAdvanced }">▶</span>
      Advanced Options
    </button>
    <Transition name="slide">
      <div v-if="showAdvanced" class="section-panel adv-panel">
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">Auto-approve</span>
            <span class="toggle-desc">Skip confirmation prompts for file changes</span>
          </div>
          <button
            class="toggle-switch"
            :class="{ on: autoApprove }"
            role="switch"
            :aria-checked="autoApprove"
            @click="autoApprove = !autoApprove"
          >
            <span class="toggle-thumb" />
          </button>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">Create Worktree</span>
            <span class="toggle-desc">Create a new git worktree and launch the session inside it</span>
          </div>
          <button
            class="toggle-switch"
            :class="{ on: createWorktree }"
            role="switch"
            :aria-checked="createWorktree"
            @click="createWorktree = !createWorktree; clearTemplateSelection()"
          >
            <span class="toggle-thumb" />
          </button>
        </div>
        <Transition name="slide">
          <div v-if="createWorktree" class="worktree-options">
            <div class="form-group" style="margin: 8px 0 0 0">
              <label class="form-label">Base Branch</label>
              <SearchableSelect
                v-model="baseBranch"
                :options="worktreeStore.branches"
                placeholder="Leave blank to use current HEAD"
                clearable
              />
              <span class="form-hint">The branch to base the new worktree on. If left blank, the worktree is created from the current HEAD.</span>
            </div>
            <div v-if="!branch" class="worktree-warning">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"/></svg>
              <span>A branch name is required when creating a worktree. Enter one in the Branch field above.</span>
            </div>
            <div v-if="worktreePreviewPath" class="worktree-path-preview">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span class="wt-preview-label">Worktree folder:</span>
              <code class="wt-preview-path">{{ worktreePreviewPath }}</code>
            </div>
          </div>
        </Transition>
        <div class="toggle-row toggle-row-last">
          <div class="toggle-info">
            <span class="toggle-label">Copilot SDK Headless</span>
            <span class="toggle-desc">Create an SDK-owned session without opening a terminal</span>
          </div>
          <button
            class="toggle-switch"
            :class="{ on: headless }"
            role="switch"
            :aria-checked="headless"
            @click="headless = !headless; clearTemplateSelection()"
          >
            <span class="toggle-thumb" />
          </button>
        </div>

        <div class="toggle-row toggle-row-last">
          <div class="toggle-info">
            <span class="toggle-label">Launch with --ui-server</span>
            <span class="toggle-desc">Expose terminal-launched sessions to TracePilot's TCP SDK bridge</span>
          </div>
          <button
            class="toggle-switch"
            :class="{ on: uiServer && !headless }"
            role="switch"
            :aria-checked="uiServer && !headless"
            :disabled="headless"
            @click="uiServer = !uiServer; clearTemplateSelection()"
          >
            <span class="toggle-thumb" />
          </button>
        </div>

        <div class="form-group" style="margin-top: 14px">
          <label class="form-label">Custom Instructions Path</label>
          <input
            v-model="customInstructions"
            type="text"
            class="form-input form-mono"
            placeholder=".github/copilot-instructions.md"
          />
        </div>

        <div class="form-group" style="margin-top: 14px">
          <label class="form-label">Environment Variables</label>
          <div v-for="(ev, idx) in envVars" :key="idx" class="env-row">
            <input v-model="ev.key" type="text" class="form-input form-mono env-key" placeholder="KEY" />
            <input v-model="ev.value" type="text" class="form-input form-mono env-val" placeholder="value" />
            <button class="env-remove" @click="removeEnvVar(idx)" title="Remove variable">✕</button>
          </div>
          <button class="btn-add-var" @click="addEnvVar">+ Add Variable</button>
        </div>
      </div>
    </Transition>
  </section>
</template>
