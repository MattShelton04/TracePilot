<script setup lang="ts">
import { useSkillImportWizardContext } from "@/composables/useSkillImportWizard";

const wizard = useSkillImportWizardContext();
</script>

<template>
  <div class="tab-panel">
    <div class="input-row">
      <div class="input-field">
        <label>Repository URL</label>
        <input
          v-model="wizard.ghRepoUrl"
          type="text"
          placeholder="https://github.com/owner/repo  or  owner/repo/path"
          :disabled="wizard.ghScanning"
          @keyup.enter="!wizard.ghScanning && wizard.scanGitHub()"
        />
      </div>
      <button
        v-if="!wizard.ghScanning"
        class="btn-scan"
        :disabled="!wizard.ghRepoUrl.trim() && !wizard.ghOwner.trim()"
        @click="wizard.scanGitHub"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        Scan
      </button>
      <button
        v-else
        class="btn-cancel"
        @click="wizard.cancelScan"
      >
        Cancel
      </button>
    </div>

    <!-- Scanning progress -->
    <div v-if="wizard.ghScanning" class="gh-scan-status">
      <span class="gh-scan-spinner" aria-hidden="true"></span>
      {{ wizard.ghScanMessage }}
    </div>
    <div v-else class="input-hint">
      Accepts <code>https://github.com/owner/repo</code>, <code>owner/repo</code>,
      or a URL with a path like <code>.../tree/main/skills</code>
    </div>

    <!-- Skill Preview Cards -->
    <div v-if="wizard.ghPreviews.length > 0" class="gh-preview">
      <div class="gh-preview__header">
        <label class="gh-preview__toggle-all">
          <input
            type="checkbox"
            :checked="wizard.ghSelected.size === wizard.ghPreviews.length"
            :indeterminate="wizard.ghSelected.size > 0 && wizard.ghSelected.size < wizard.ghPreviews.length"
            @change="wizard.toggleAllGhSkills"
          />
          {{ wizard.ghPreviews.length }} skill{{ wizard.ghPreviews.length === 1 ? "" : "s" }} found
        </label>
        <span class="gh-preview__selected">{{ wizard.ghSelected.size }} selected</span>
      </div>
      <ul class="gh-preview__list">
        <li
          v-for="preview in wizard.ghPreviews"
          :key="preview.path"
          class="gh-preview__item"
          :class="{ selected: wizard.ghSelected.has(preview.path) }"
          @click="wizard.toggleGhSkill(preview.path)"
        >
          <input
            type="checkbox"
            :checked="wizard.ghSelected.has(preview.path)"
            @click.stop
            @change="wizard.toggleGhSkill(preview.path)"
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
