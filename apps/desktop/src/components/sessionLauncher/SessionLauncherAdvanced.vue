<script setup lang="ts">
import { Banner, SearchableSelect } from "@tracepilot/ui";
import { ChevronRight, FolderOpen } from "lucide-vue-next";
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
  sdkFeatureEnabled,
} = useSessionLauncherContext();

const sdkDisabledHint = "Enable copilotSdk in Settings → Experimental";

function toggleHeadless() {
  if (!sdkFeatureEnabled.value) return;
  headless.value = !headless.value;
  clearTemplateSelection();
}

function toggleUiServer() {
  if (!sdkFeatureEnabled.value || headless.value) return;
  uiServer.value = !uiServer.value;
  clearTemplateSelection();
}
</script>

<template>
  <section class="section-block">
    <button class="advanced-trigger" @click="showAdvanced = !showAdvanced">
      <span class="advanced-arrow" :class="{ open: showAdvanced }" aria-hidden="true">
        <ChevronRight :size="14" :stroke-width="1.5" />
      </span>
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
            <Banner v-if="!branch" tone="warning" class="worktree-warning">
              A branch name is required when creating a worktree. Enter one in the Branch field above.
            </Banner>
            <div v-if="worktreePreviewPath" class="worktree-path-preview">
              <FolderOpen :size="14" :stroke-width="1.5" aria-hidden="true" />
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
            :disabled="!sdkFeatureEnabled"
            :title="!sdkFeatureEnabled ? sdkDisabledHint : undefined"
            @click="toggleHeadless"
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
            :disabled="headless || !sdkFeatureEnabled"
            :title="!sdkFeatureEnabled ? sdkDisabledHint : undefined"
            @click="toggleUiServer"
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
