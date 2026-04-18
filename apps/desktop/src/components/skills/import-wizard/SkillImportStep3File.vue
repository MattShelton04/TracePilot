<script setup lang="ts">
import { useSkillImportWizardContext } from "@/composables/useSkillImportWizard";

const wizard = useSkillImportWizardContext();
</script>

<template>
  <div class="tab-panel">
    <div class="drop-zone" @click="wizard.browseFile">
      <div class="drop-zone__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
      </div>
      <div class="drop-zone__label">Click to browse or drop SKILL.md here</div>
      <div class="drop-zone__hint">Or drag a .zip archive containing a skill directory</div>
      <div class="drop-zone__formats">
        <span class="drop-zone__format">SKILL.md</span>
        <span class="drop-zone__format">.zip archive</span>
        <span class="drop-zone__format">directory</span>
      </div>
    </div>
    <div class="input-row" style="margin-top: 12px;">
      <div class="input-field">
        <label>Or enter file path</label>
        <input
          v-model="wizard.filePath"
          type="text"
          placeholder="/path/to/SKILL.md"
        />
      </div>
      <button class="btn-browse" @click="wizard.browseFile" title="Browse for file">
        📂
      </button>
    </div>
  </div>
</template>
