<script setup lang="ts">
import { useSkillImportWizardContext } from "@/composables/useSkillImportWizard";

const wizard = useSkillImportWizardContext();
</script>

<template>
  <div class="tab-panel">
    <!-- Quick-select from known repos -->
    <div
      v-if="wizard.worktreeStore.registeredRepos.length > 0 || wizard.prefsStore.recentRepoPaths.length > 0"
      class="input-field"
      style="margin-bottom: 8px;"
    >
      <label>Quick Select</label>
      <select @change="wizard.onSelectRepo($event)" class="repo-select">
        <option value="">Choose a repository…</option>
        <optgroup v-if="wizard.worktreeStore.registeredRepos.length" label="Registered Repositories">
          <option v-for="r in wizard.worktreeStore.registeredRepos" :key="r.path" :value="r.path">
            {{ r.name }} — {{ r.path }}
          </option>
        </optgroup>
        <optgroup v-if="wizard.prefsStore.recentRepoPaths.length" label="Recent">
          <option v-for="p in wizard.prefsStore.recentRepoPaths" :key="p" :value="p">{{ p }}</option>
        </optgroup>
      </select>
    </div>
    <!-- Manual entry + browse -->
    <div class="input-row">
      <div class="input-field">
        <label>Repository Path</label>
        <input
          v-model="wizard.localDir"
          type="text"
          placeholder="C:\path\to\repository"
        />
      </div>
      <button class="btn-browse" @click="wizard.browseLocalDir" title="Browse for directory">
        📂
      </button>
      <button
        class="btn-scan"
        @click="wizard.scanLocal"
        :disabled="!wizard.localDir.trim() || wizard.localScanning"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        {{ wizard.localScanning ? "Scanning…" : "Scan" }}
      </button>
    </div>
    <div class="input-hint">
      Scans <code>.github/skills/</code>, <code>.copilot/skills/</code>, <code>skills/</code>, <code>.github/copilot-skills/</code>
    </div>

    <!-- Scanning progress -->
    <div v-if="wizard.localScanning" class="gh-scan-status">
      <span class="gh-scan-spinner" aria-hidden="true"></span>
      Scanning directory…
    </div>

    <!-- Local Skill Preview Cards -->
    <div v-if="wizard.localPreviews.length > 0" class="gh-preview">
      <div class="gh-preview__header">
        <label class="gh-preview__toggle-all">
          <input
            type="checkbox"
            :checked="wizard.localSelected.size === wizard.localPreviews.length"
            :indeterminate="wizard.localSelected.size > 0 && wizard.localSelected.size < wizard.localPreviews.length"
            @change="wizard.toggleAllLocalSkills"
          />
          {{ wizard.localPreviews.length }} skill{{ wizard.localPreviews.length === 1 ? "" : "s" }} found
        </label>
        <span class="gh-preview__selected">{{ wizard.localSelected.size }} selected</span>
      </div>
      <ul class="gh-preview__list">
        <li
          v-for="preview in wizard.localPreviews"
          :key="preview.path"
          class="gh-preview__item"
          :class="{ selected: wizard.localSelected.has(preview.path) }"
          @click="wizard.toggleLocalSkill(preview.path)"
        >
          <input
            type="checkbox"
            :checked="wizard.localSelected.has(preview.path)"
            @click.stop
            @change="wizard.toggleLocalSkill(preview.path)"
          />
          <div class="gh-preview__info">
            <span class="gh-preview__name">{{ preview.name }}</span>
            <span
              class="gh-preview__desc"
              :class="{ 'gh-preview__desc--empty': !preview.description }"
            >{{ preview.description || 'No description' }}</span>
            <span class="gh-preview__path">{{ preview.path }}</span>
          </div>
          <span class="gh-preview__badge">
            {{ preview.fileCount }} file{{ preview.fileCount === 1 ? "" : "s" }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
