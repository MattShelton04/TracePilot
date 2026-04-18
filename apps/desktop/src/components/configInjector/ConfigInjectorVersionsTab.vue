<script setup lang="ts">
import { EmptyState } from "@tracepilot/ui";
import { useConfigInjectorContext } from "@/composables/useConfigInjector";

const {
  store,
  migrationFrom,
  migrationTo,
  handleLoadDiffs,
  handleMigrateAgent,
} = useConfigInjectorContext();
</script>

<template>
  <div class="tab-panel">
    <!-- Version Grid -->
    <div class="version-grid">
      <div v-for="ver in store.versions" :key="ver.version" class="version-card">
        <div class="version-card-header">
          <span class="version-number">v{{ ver.version }}</span>
          <div class="version-badges">
            <span v-if="ver.isActive" class="badge badge--accent">Active</span>
            <span v-if="ver.isComplete" class="badge badge--success">Complete</span>
          </div>
        </div>
        <div class="version-meta">
          <span v-if="ver.hasCustomizations" class="meta-tag meta-tag--warn">Customized</span>
          <span class="meta-tag">🔒 {{ ver.lockCount ?? 0 }}</span>
        </div>
      </div>
      <EmptyState v-if="!store.versions.length" compact message="No Copilot CLI versions discovered." />
    </div>

    <!-- Migration Panel -->
    <div class="migration-panel">
      <h3 class="section-heading">Migration</h3>
      <p class="migration-guidance">
        Preview differences between agent definitions across versions.
        <span class="migration-from-hint">Red (−) lines</span> show content in the <strong>From</strong> version that differs.
        <span class="migration-to-hint">Green (+) lines</span> show content in the <strong>To</strong> version.
        Clicking <strong>Migrate</strong> copies the From version's definition into the To version's directory
        (a backup is created automatically).
      </p>
      <div class="migration-controls">
        <div class="form-group">
          <label class="form-label migration-label--from">From (v{{ migrationFrom || '?' }})</label>
          <select v-model="migrationFrom" class="form-input">
            <option value="">— source —</option>
            <option v-for="v in store.versions" :key="v.version" :value="v.version">
              v{{ v.version }}
            </option>
          </select>
        </div>
        <span class="migration-arrow">→</span>
        <div class="form-group">
          <label class="form-label migration-label--to">To (v{{ migrationTo || '?' }})</label>
          <select v-model="migrationTo" class="form-input">
            <option value="">— target —</option>
            <option v-for="v in store.versions" :key="v.version" :value="v.version">
              v{{ v.version }}
            </option>
          </select>
        </div>
        <button
          class="btn btn-primary btn-sm"
          :disabled="!migrationFrom || !migrationTo || migrationFrom === migrationTo"
          @click="handleLoadDiffs"
        >
          Load Diffs
        </button>
      </div>

      <div v-if="store.migrationDiffs.length" class="diff-results">
        <div v-for="diff in store.migrationDiffs" :key="diff.fileName" class="diff-card">
          <div class="diff-card-header">
            <span class="diff-agent-name">{{ diff.agentName ?? diff.fileName }}</span>
            <span v-if="diff.hasConflicts" class="badge badge--danger">Conflicts</span>
            <button class="btn btn-primary btn-sm" @click="handleMigrateAgent(diff.fileName)">
              Migrate
            </button>
          </div>
          <pre class="diff-block"><template v-for="(line, i) in (diff.diff ?? '').split('\n')" :key="i"><span :class="{ 'diff-line--added': line.startsWith('+'), 'diff-line--removed': line.startsWith('-') }">{{ line }}{{ '\n' }}</span></template></pre>
        </div>
      </div>
    </div>
  </div>
</template>
