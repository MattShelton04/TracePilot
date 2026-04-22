<script setup lang="ts">
import type { SkillImportResult } from "@tracepilot/types";
import { useShortcut } from "@tracepilot/ui";
import { provide } from "vue";
import SkillImportStep1Local from "@/components/skills/import-wizard/SkillImportStep1Local.vue";
import SkillImportStep2GitHub from "@/components/skills/import-wizard/SkillImportStep2GitHub.vue";
import SkillImportStep3File from "@/components/skills/import-wizard/SkillImportStep3File.vue";
import {
  SkillImportWizardKey,
  useSkillImportWizard,
} from "@/composables/useSkillImportWizard";
import "@/styles/features/skill-import-wizard.css";

const emit = defineEmits<{
  close: [];
  imported: [result: SkillImportResult];
}>();

const wizard = useSkillImportWizard({
  onImported: (r) => emit("imported", r),
  onClose: () => emit("close"),
});

provide(SkillImportWizardKey, wizard);

useShortcut("Escape", () => emit("close"));
</script>

<template>
  <div class="skill-import-wizard-root wizard-overlay" @click.self="emit('close')">
    <div class="wizard">
      <div class="wizard__header">
        <div>
          <h3 class="wizard__title">Import Skills</h3>
          <p class="wizard__subtitle">Bring skills from local repos, GitHub, or files into your library</p>
        </div>
        <button class="wizard__close" @click="emit('close')">✕</button>
      </div>

      <!-- Result View -->
      <div v-if="wizard.showResult && wizard.importResult" class="wizard__body">
        <div class="wizard__result">
          <div class="wizard__result-icon">✅</div>
          <h4 class="wizard__result-title">Skill Imported</h4>
          <p class="wizard__result-name">{{ wizard.importResult.skillName }}</p>
          <p class="wizard__result-detail">
            {{ wizard.importResult.filesCopied }} file{{ wizard.importResult.filesCopied === 1 ? "" : "s" }} copied
          </p>
          <div v-if="wizard.importResult.warnings.length > 0" class="wizard__warnings">
            <p v-for="(w, i) in wizard.importResult.warnings" :key="i" class="wizard__warning">
              ⚠️ {{ w }}
            </p>
          </div>
        </div>
        <div class="wizard__actions">
          <button class="wizard__btn wizard__btn--primary" @click="wizard.finish">Done</button>
        </div>
      </div>

      <!-- Tabbed Import View -->
      <template v-else>
        <!-- Source Tabs -->
        <div class="source-tabs">
          <button
            :class="['source-tab', { active: wizard.activeTab === 'local' }]"
            @click="wizard.activeTab = 'local'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            Local Repository
          </button>
          <button
            :class="['source-tab', { active: wizard.activeTab === 'github' }]"
            @click="wizard.activeTab = 'github'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
            GitHub
          </button>
          <button
            :class="['source-tab', { active: wizard.activeTab === 'file' }]"
            @click="wizard.activeTab = 'file'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
            File Upload
          </button>
        </div>

        <SkillImportStep1Local v-if="wizard.activeTab === 'local'" />
        <SkillImportStep2GitHub v-if="wizard.activeTab === 'github'" />
        <SkillImportStep3File v-if="wizard.activeTab === 'file'" />

        <!-- Error -->
        <div v-if="wizard.importError" class="wizard__error">{{ wizard.importError }}</div>

        <!-- Import progress -->
        <div v-if="wizard.importing" class="import-progress">
          <div class="import-progress__status">
            <span class="gh-scan-spinner" aria-hidden="true"></span>
            <span class="import-progress__message">{{ wizard.importStatusMessage }}</span>
          </div>
          <div v-if="wizard.importTotal > 1" class="import-progress__bar-wrapper">
            <div class="import-progress__bar">
              <div
                class="import-progress__bar-fill"
                :style="{ width: `${Math.round((wizard.importCurrent / wizard.importTotal) * 100)}%` }"
              />
            </div>
            <span class="import-progress__count">{{ wizard.importCurrent }} / {{ wizard.importTotal }}</span>
          </div>
        </div>

        <!-- Footer: scope + import button -->
        <div class="wizard__footer">
          <div class="scope-select">
            <label>Target Scope</label>
            <select v-model="wizard.targetScope">
              <option value="global">Global (~/.copilot/skills/)</option>
              <option value="project">Project (.github/skills/)</option>
            </select>
          </div>
          <div class="wizard__footer-right">
            <button class="wizard__btn wizard__btn--secondary" @click="emit('close')">Cancel</button>
            <button
              class="wizard__btn wizard__btn--primary"
              :disabled="!wizard.canImport || wizard.importing"
              @click="wizard.doImport"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              {{ wizard.importing ? "Importing…" : "Import Skills" }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
