<script setup lang="ts">
import { EmptyState, formatBytes, formatDate, shortenPath } from "@tracepilot/ui";
import { useConfigInjectorContext } from "@/composables/useConfigInjector";

const {
  store,
  newBackupPath,
  newBackupLabel,
  backupableFiles,
  handleCreateBackup,
  batchBackingUp,
  handleBackupAllAgents,
  backupEmoji,
  formatBackupLabel,
  confirmingDeleteBackupId,
  toggleDeleteBackup,
  previewingBackupId,
  backupDiffLoading,
  backupDiffData,
  toggleBackupPreview,
} = useConfigInjectorContext();
</script>

<template>
  <div class="tab-panel">
    <!-- Create Backup Form -->
    <div class="backup-create">
      <h3 class="section-heading">Create Backup</h3>
      <p class="backup-guidance">
        Select a config file to back up. This creates a timestamped copy you can restore later.
        Backups are stored in <code>~/.copilot/tracepilot/backups/</code>.
      </p>
      <div class="backup-form">
        <select v-model="newBackupPath" class="form-input">
          <option value="">— Select file to back up —</option>
          <option v-for="file in backupableFiles" :key="file.path" :value="file.path">
            {{ file.label }}
          </option>
        </select>
        <input v-model="newBackupLabel" class="form-input" placeholder="Label (optional)" />
        <button
          class="btn btn-primary"
          :disabled="!newBackupPath.trim() || store.saving"
          @click="handleCreateBackup"
        >
          {{ store.saving ? 'Creating…' : '💾 Create Backup' }}
        </button>
      </div>
      <div v-if="store.agents.length" class="backup-batch">
        <button
          class="btn btn-sm"
          :disabled="store.saving || batchBackingUp"
          @click="handleBackupAllAgents"
        >
          {{ batchBackingUp ? 'Backing up…' : '📦 Back Up All Agents' }}
        </button>
      </div>
    </div>

    <!-- Backup List -->
    <div v-if="store.backups.length" class="backup-list">
      <h3 class="section-heading">Existing Backups</h3>
      <div v-for="backup in store.backups" :key="backup.id" class="backup-item-wrapper">
        <div class="backup-item">
          <span class="backup-emoji">{{ backupEmoji(backup.sourcePath) }}</span>
          <div class="backup-info">
            <span class="backup-name">{{ formatBackupLabel(backup) }}</span>
            <span class="backup-meta">
              {{ formatDate(backup.createdAt) }} · {{ formatBytes(backup.sizeBytes) }}
              <template v-if="backup.sourcePath"> · {{ shortenPath(backup.sourcePath) }}</template>
            </span>
          </div>
          <div class="backup-actions">
            <button
              class="btn btn-sm"
              :disabled="!backup.sourcePath || backupDiffLoading"
              :title="backup.sourcePath ? 'Preview changes before restoring' : 'Source path unknown'"
              @click="toggleBackupPreview(backup)"
            >
              {{ previewingBackupId === backup.id ? '✕ Close' : '📝 Preview' }}
            </button>
            <button
              class="btn btn-sm"
              :disabled="!backup.sourcePath"
              :title="backup.sourcePath ? 'Restore to ' + backup.sourcePath : 'Source path unknown — cannot restore'"
              @click="store.restoreBackup(backup.backupPath, backup.sourcePath)"
            >
              ↩ Restore
            </button>
            <button
              class="btn btn-sm"
              :class="confirmingDeleteBackupId === backup.id ? 'btn-danger' : 'btn-danger-subtle'"
              :title="confirmingDeleteBackupId === backup.id ? 'Click again to confirm deletion' : 'Delete this backup'"
              @click="toggleDeleteBackup(backup)"
            >
              {{ confirmingDeleteBackupId === backup.id ? 'Confirm?' : '🗑' }}
            </button>
          </div>
        </div>
        <!-- Backup Diff Preview -->
        <div v-if="previewingBackupId === backup.id && backupDiffLoading" class="backup-diff-loading">
          Loading preview…
        </div>
        <div v-if="previewingBackupId === backup.id && backupDiffData" class="diff-side-by-side backup-diff-panel">
          <div class="diff-panel diff-panel--left">
            <div class="diff-panel-header diff-panel-header--left">← Current</div>
            <pre class="diff-panel-body"><template v-for="(line, i) in backupDiffData.left" :key="i"><span :class="{ 'diff-line--removed': line.changed }">{{ line.text }}{{ '\n' }}</span></template></pre>
          </div>
          <div class="diff-panel diff-panel--right">
            <div class="diff-panel-header diff-panel-header--right">→ Backup (restore)</div>
            <pre class="diff-panel-body"><template v-for="(line, i) in backupDiffData.right" :key="i"><span :class="{ 'diff-line--added': line.changed }">{{ line.text }}{{ '\n' }}</span></template></pre>
          </div>
        </div>
      </div>
    </div>

    <EmptyState v-else icon="📦" title="No Backups Yet" message="Create a backup above to safeguard your configuration before making changes." />
  </div>
</template>
