<script setup lang="ts">
import { getModelsByTier } from "@tracepilot/types";
import { Banner, EmptyState } from "@tracepilot/ui";
import { FileText, X } from "lucide-vue-next";
import { computed, useId } from "vue";
import { useConfigInjectorContext } from "@/composables/useConfigInjector";

const {
  store,
  editModel,
  editReasoningEffort,
  editShowReasoning,
  editRenderMarkdown,
  editTrustedFolders,
  newFolder,
  addFolder,
  removeFolder,
  configDiffLines,
  hasConfigChanges,
  configParseError,
  configSettingsPath,
  handleSaveGlobalConfig,
} = useConfigInjectorContext();

const PREMIUM_MODELS = getModelsByTier("premium").map((m) => m.id);
const STANDARD_MODELS = getModelsByTier("standard").map((m) => m.id);
const FAST_MODELS = getModelsByTier("fast").map((m) => m.id);
const formId = useId();

// Memoize the change counter so it isn't recomputed (two array filters) on every
// unrelated re-render of the diff preview details element.
const diffChangeCount = computed(
  () =>
    configDiffLines.value.left.filter((l) => l.changed).length +
    configDiffLines.value.right.filter((l) => l.changed).length,
);
</script>

<template>
  <div class="tab-panel">
    <div class="global-layout">
      <!-- Parse-error banner: surfaced when ~/.copilot/{config,settings}.json
           cannot be parsed. Saving is gated until the underlying file is
           fixed so we never silently overwrite invalid user data. -->
      <Banner
        v-if="configParseError"
        tone="warning"
        title="Copilot settings file could not be parsed."
        role="alert"
        class="config-parse-error"
      >
        <p>{{ configParseError }}</p>
        <p v-if="configSettingsPath" class="config-parse-error__hint">
          Edit <code>{{ configSettingsPath }}</code> to fix the syntax, then reload.
          Saving is disabled to avoid clobbering existing data.
        </p>
      </Banner>

      <!-- Config Form -->
      <div class="config-form">
        <!-- Default Model -->
        <div class="form-group">
          <label :for="`${formId}-model`" class="form-label">Default Model</label>
          <select :id="`${formId}-model`" v-model="editModel" class="form-input">
            <option value="">— select —</option>
            <optgroup label="Premium">
              <option v-for="m in PREMIUM_MODELS" :key="m" :value="m">{{ m }}</option>
            </optgroup>
            <optgroup label="Standard">
              <option v-for="m in STANDARD_MODELS" :key="m" :value="m">{{ m }}</option>
            </optgroup>
            <optgroup label="Fast / Cheap">
              <option v-for="m in FAST_MODELS" :key="m" :value="m">{{ m }}</option>
            </optgroup>
          </select>
        </div>

        <!-- Reasoning Effort -->
        <div class="form-group">
          <span :id="`${formId}-effort`" class="form-label">Reasoning Effort</span>
          <div class="toggle-group" role="group" :aria-labelledby="`${formId}-effort`">
            <button
              v-for="level in ['low', 'medium', 'high']"
              :key="level"
              type="button"
              class="toggle-btn"
              :class="{ active: editReasoningEffort === level }"
              :aria-pressed="editReasoningEffort === level"
              @click="editReasoningEffort = level"
            >
              {{ level.charAt(0).toUpperCase() + level.slice(1) }}
            </button>
          </div>
        </div>

        <!-- Show Reasoning -->
        <div class="switch-row">
          <div>
            <label :for="`${formId}-show-reasoning`" class="form-label">Show Reasoning</label>
            <span :id="`${formId}-show-reasoning-hint`" class="form-hint">Controls whether Copilot CLI displays reasoning traces</span>
          </div>
          <button
            :id="`${formId}-show-reasoning`"
            type="button"
            class="switch-track"
            :class="{ active: editShowReasoning }"
            role="switch"
            :aria-checked="editShowReasoning"
            :aria-describedby="`${formId}-show-reasoning-hint`"
            @click="editShowReasoning = !editShowReasoning"
          >
            <span class="switch-thumb" />
          </button>
        </div>

        <!-- Render Markdown -->
        <div class="switch-row">
          <div>
            <label :for="`${formId}-render-markdown`" class="form-label">Render Markdown</label>
            <span :id="`${formId}-render-markdown-hint`" class="form-hint">Controls whether Copilot CLI renders markdown in responses</span>
          </div>
          <button
            :id="`${formId}-render-markdown`"
            type="button"
            class="switch-track"
            :class="{ active: editRenderMarkdown }"
            role="switch"
            :aria-checked="editRenderMarkdown"
            :aria-describedby="`${formId}-render-markdown-hint`"
            @click="editRenderMarkdown = !editRenderMarkdown"
          >
            <span class="switch-thumb" />
          </button>
        </div>

        <!-- Trusted Folders -->
        <div class="form-group">
          <label :for="`${formId}-trusted-folder`" class="form-label">Trusted Folders</label>
          <div class="folder-list">
            <div v-for="(folder, i) in editTrustedFolders" :key="i" class="folder-item">
              <span class="folder-path">{{ folder }}</span>
              <button type="button" class="btn-icon-sm" :title="`Remove ${folder}`" :aria-label="`Remove trusted folder ${folder}`" @click="removeFolder(i)">
                <X :size="13" :stroke-width="1.5" aria-hidden="true" />
              </button>
            </div>
            <EmptyState v-if="!editTrustedFolders.length" size="sm" description="No trusted folders configured." />
          </div>
          <div class="folder-add">
            <input
              :id="`${formId}-trusted-folder`"
              v-model="newFolder"
              class="form-input"
              placeholder="Add folder path…"
              @keyup.enter="addFolder"
            />
            <button type="button" class="btn btn-sm" aria-label="Add trusted folder" @click="addFolder">Add</button>
          </div>
        </div>

        <!-- Save Button -->
        <button
          type="button"
          class="btn btn-primary"
          :disabled="store.saving || !hasConfigChanges || !!configParseError"
          @click="handleSaveGlobalConfig"
        >
          {{ store.saving ? 'Saving…' : 'Save Config' }}
        </button>
      </div>

      <!-- Diff Preview -->
      <details v-if="hasConfigChanges" class="diff-preview-details" open>
        <summary class="diff-preview-summary">
          <span class="diff-preview-summary__title">
            <FileText :size="14" :stroke-width="1.5" />
            Diff Preview
          </span>
          <span class="diff-badge">{{ diffChangeCount }} changes</span>
        </summary>
        <div class="diff-side-by-side diff-side-by-side--compact">
          <div class="diff-panel diff-panel--left">
            <div class="diff-panel-header diff-panel-header--left">← Current</div>
            <pre class="diff-panel-body"><template v-for="(line, i) in configDiffLines.left" :key="i"><span :class="{ 'diff-line--removed': line.changed }">{{ line.text }}{{ '\n' }}</span></template></pre>
          </div>
          <div class="diff-panel diff-panel--right">
            <div class="diff-panel-header diff-panel-header--right">→ Modified</div>
            <pre class="diff-panel-body"><template v-for="(line, i) in configDiffLines.right" :key="i"><span :class="{ 'diff-line--added': line.changed }">{{ line.text }}{{ '\n' }}</span></template></pre>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>
