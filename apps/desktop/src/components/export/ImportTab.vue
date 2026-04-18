<script setup lang="ts">
import { Badge, BtnGroup, FormSwitch, ProgressBar } from "@tracepilot/ui";
import { useRouter } from "vue-router";
import { useImportFlow } from "@/composables/useImportFlow";
import { ROUTE_NAMES } from "@/config/routes";

const router = useRouter();
const importFlow = useImportFlow();
</script>

<template>
  <div class="import-container">
    <!-- Step 1: File Selection -->
    <div v-if="importFlow.step.value === 'select'">
      <div
        class="drop-zone"
        @click="importFlow.browseFile"
      >
        <div class="drop-zone-icon">📂</div>
        <div class="drop-zone-text">
          Drop a <strong>.tpx.json</strong> file here, or click to browse
        </div>
        <div class="drop-zone-hint">Supports TracePilot export files v1.0+</div>
      </div>
      <div v-if="importFlow.error.value" class="import-error">
        ⚠️ {{ importFlow.error.value }}
      </div>
    </div>

    <!-- Step 2: Validating -->
    <div v-if="importFlow.step.value === 'validating'" class="import-validating">
      <div class="import-file-card">
        <span class="import-file-icon">📄</span>
        <div>
          <div class="import-file-name">{{ importFlow.fileName.value }}</div>
          <div class="import-file-meta">Validating…</div>
        </div>
      </div>
      <div class="validation-list">
        <div class="validation-item checking">
          <span class="validation-icon spinner">⟳</span>
          <span class="validation-label">Parsing and validating archive…</span>
        </div>
      </div>
    </div>

    <!-- Step 3: Review -->
    <div v-if="importFlow.step.value === 'review' && importFlow.preview.value">
      <div class="import-file-card">
        <span class="import-file-icon">📄</span>
        <div>
          <div class="import-file-name">{{ importFlow.fileName.value }}</div>
          <div class="import-file-meta">
            {{ importFlow.preview.value.sessions.length }} session(s) ·
            Schema v{{ importFlow.preview.value.schemaVersion }}
            <Badge v-if="importFlow.preview.value.needsMigration" variant="warning">
              Migration needed
            </Badge>
          </div>
        </div>
      </div>

      <!-- Validation Issues -->
      <div v-if="importFlow.preview.value.issues.length > 0" class="validation-list">
        <div
          v-for="(issue, i) in importFlow.preview.value.issues"
          :key="i"
          class="validation-item"
          :class="{
            'issue-error': issue.severity === 'error',
            'issue-warning': issue.severity === 'warning',
          }"
        >
          <span class="validation-icon">
            {{ issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️' }}
          </span>
          <span class="validation-label">{{ issue.message }}</span>
        </div>
      </div>
      <div v-else class="validation-list">
        <div class="validation-item passed">
          <span class="validation-icon">✅</span>
          <span class="validation-label">Archive is valid</span>
        </div>
      </div>

      <!-- Session List -->
      <section class="config-section" style="margin-top: 20px">
        <h3 class="config-section-title">Sessions to Import</h3>
        <div
          v-for="session in importFlow.preview.value.sessions"
          :key="session.id"
          class="import-session-row"
        >
          <FormSwitch
            :model-value="importFlow.selectedSessions.value.includes(session.id)"
            @update:model-value="importFlow.toggleSession(session.id)"
            :aria-label="`Import session ${session.summary ?? session.id.slice(0, 12)}`"
          />
          <div class="import-session-info">
            <div class="import-session-name">
              {{ session.summary ?? session.id.slice(0, 12) }}
            </div>
            <div class="import-session-meta">
              {{ session.repository ?? 'Unknown repo' }}
              · {{ session.sectionCount }} sections
              <Badge v-if="session.alreadyExists" variant="warning">Exists</Badge>
            </div>
          </div>
        </div>
      </section>

      <!-- Conflict Strategy -->
      <section class="config-section" style="margin-top: 16px">
        <h3 class="config-section-title">Conflict Handling</h3>
        <BtnGroup
          v-model="importFlow.conflictStrategy.value"
          :options="[
            { value: 'skip', label: 'Skip' },
            { value: 'replace', label: 'Replace' },
            { value: 'duplicate', label: 'Duplicate' },
          ]"
        />
      </section>

      <!-- Error display -->
      <div v-if="importFlow.error.value" class="import-error" style="margin-top: 12px">
        ⚠️ {{ importFlow.error.value }}
      </div>

      <!-- Import Actions -->
      <div class="import-actions">
        <button class="btn btn-secondary" @click="importFlow.reset">
          Cancel
        </button>
        <button
          class="btn btn-primary"
          :disabled="!importFlow.canImport.value"
          @click="importFlow.executeImport"
        >
          Import {{ importFlow.selectedSessions.value.length }} Session(s)
        </button>
      </div>
    </div>

    <!-- Step 4: Importing -->
    <div v-if="importFlow.step.value === 'importing'" class="import-progress-container">
      <div class="import-file-card">
        <span class="import-file-icon">📄</span>
        <div>
          <div class="import-file-name">{{ importFlow.fileName.value }}</div>
          <div class="import-file-meta">Importing…</div>
        </div>
      </div>
      <ProgressBar :percent="importFlow.importProgress.value" color="accent" aria-label="Import progress" />
      <p class="text-secondary import-progress-label">
        {{ importFlow.importProgress.value < 30 ? 'Parsing sessions…'
          : importFlow.importProgress.value < 60 ? 'Restoring data…'
          : importFlow.importProgress.value < 90 ? 'Indexing events…'
          : 'Finalizing…' }}
      </p>
    </div>

    <!-- Step 5: Complete -->
    <div v-if="importFlow.step.value === 'complete'" class="import-success">
      <div class="import-success-icon">✅</div>
      <h2 class="import-success-title">Import Complete</h2>
      <p class="import-success-desc">
        {{ importFlow.importedCount.value }} session(s) imported successfully.
        <template v-if="importFlow.skippedCount.value > 0">
          {{ importFlow.skippedCount.value }} skipped.
        </template>
      </p>
      <div v-if="importFlow.importErrors.value.length > 0" class="import-note-list">
        <div v-for="(err, i) in importFlow.importErrors.value" :key="i" class="import-note">
          ℹ️ {{ err }}
        </div>
      </div>
      <div class="import-actions">
        <button class="btn btn-secondary" @click="importFlow.reset">
          Import Another
        </button>
        <button class="btn btn-primary" @click="router.push({ name: ROUTE_NAMES.sessions })">
          View Sessions
        </button>
      </div>
    </div>
  </div>
</template>
