<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useConfigInjectorStore, type ConfigTab } from '@/stores/configInjector';
import type { AgentDefinition, CopilotVersion } from '@tracepilot/types';

const store = useConfigInjectorStore();

const tabs: { key: ConfigTab; label: string }[] = [
  { key: 'agents', label: 'Agents' },
  { key: 'global', label: 'Global Config' },
  { key: 'versions', label: 'Versions' },
  { key: 'backups', label: 'Backups' },
];

// Agents tab
const backupBeforeSave = ref(false);

async function handleSaveAgent() {
  if (backupBeforeSave.value && store.selectedAgent) {
    await store.createBackup(store.selectedAgent.filePath, `Pre-save: ${store.selectedAgent.name}`);
  }
  await store.saveAgent();
}

// Global Config tab
const editModel = ref('');
const editReasoningEffort = ref('');
const editTrustedFolders = ref<string[]>([]);
const newFolder = ref('');

const rawJsonPreview = computed(() =>
  JSON.stringify(
    {
      model: editModel.value,
      reasoningEffort: editReasoningEffort.value,
      trustedFolders: editTrustedFolders.value,
    },
    null,
    2,
  ),
);

function syncGlobalFields() {
  if (store.copilotConfig) {
    editModel.value = store.copilotConfig.model ?? '';
    editReasoningEffort.value = store.copilotConfig.reasoningEffort ?? '';
    editTrustedFolders.value = [...(store.copilotConfig.trustedFolders ?? [])];
  }
}

function addFolder() {
  const folder = newFolder.value.trim();
  if (folder && !editTrustedFolders.value.includes(folder)) {
    editTrustedFolders.value.push(folder);
    newFolder.value = '';
  }
}

function removeFolder(index: number) {
  editTrustedFolders.value.splice(index, 1);
}

function handleSaveGlobalConfig() {
  store.saveGlobalConfig({
    model: editModel.value,
    reasoningEffort: editReasoningEffort.value,
    trustedFolders: editTrustedFolders.value,
  });
}

// Versions tab
const migrationFrom = ref('');
const migrationTo = ref('');

async function handleLoadDiffs() {
  if (migrationFrom.value && migrationTo.value) {
    await store.loadMigrationDiffs(migrationFrom.value, migrationTo.value);
  }
}

function handleMigrateAgent(fileName: string) {
  store.migrateAgent(fileName, migrationFrom.value, migrationTo.value);
}

// Backups tab
const newBackupPath = ref('');
const newBackupLabel = ref('');

async function handleCreateBackup() {
  if (newBackupPath.value.trim()) {
    await store.createBackup(newBackupPath.value.trim(), newBackupLabel.value.trim() || 'Manual backup');
    newBackupPath.value = '';
    newBackupLabel.value = '';
  }
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

onMounted(() => {
  store.initialize().then(() => syncGlobalFields());
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Success / Error banners -->
      <Transition name="banner">
        <div v-if="store.successMessage" class="banner banner-success">
          {{ store.successMessage }}
        </div>
      </Transition>
      <Transition name="banner">
        <div v-if="store.error" class="banner banner-error">
          {{ store.error }}
        </div>
      </Transition>

      <!-- Header -->
      <div class="page-header">
        <h1 class="page-title">Config Injector</h1>
        <span v-if="store.activeVersionStr" class="version-badge">
          v{{ store.activeVersionStr }}
        </span>
      </div>

      <!-- Tab Bar -->
      <nav class="tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-btn"
          :class="{ active: store.activeTab === tab.key }"
          @click="store.activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <!-- Loading overlay -->
      <div v-if="store.loading" class="loading-state">Loading…</div>

      <!-- ===================== TAB: AGENTS ===================== -->
      <div v-if="store.activeTab === 'agents'" class="tab-panel agents-panel">
        <div class="split-pane">
          <!-- Agent list (left) -->
          <aside class="agent-list">
            <div
              v-for="agent in store.agents"
              :key="agent.filePath"
              class="agent-card"
              :class="{ selected: store.selectedAgent?.filePath === agent.filePath }"
              @click="store.selectAgent(agent)"
            >
              <div class="agent-card-header">
                <span class="agent-name">{{ agent.name }}</span>
                <span class="agent-model">{{ agent.model }}</span>
              </div>
              <p class="agent-desc">{{ agent.description?.slice(0, 100) }}{{ (agent.description?.length ?? 0) > 100 ? '…' : '' }}</p>
              <div v-if="agent.tools?.length" class="tool-chips">
                <span v-for="tool in agent.tools" :key="tool" class="chip">{{ tool }}</span>
              </div>
            </div>
            <div v-if="!store.agents.length" class="empty-state-small">No agent definitions found.</div>
          </aside>

          <!-- YAML editor (right) -->
          <section v-if="store.selectedAgent" class="editor-pane">
            <div class="editor-header">
              <h2 class="editor-title">{{ store.selectedAgent.name }}</h2>
              <span class="editor-path">{{ store.selectedAgent.filePath }}</span>
            </div>

            <textarea
              v-model="store.editingYaml"
              class="yaml-editor"
              spellcheck="false"
            />

            <div class="editor-actions">
              <label class="checkbox-label">
                <input v-model="backupBeforeSave" type="checkbox" />
                Create Backup Before Save
              </label>
              <button class="btn btn-primary" :disabled="store.saving" @click="handleSaveAgent">
                {{ store.saving ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </section>

          <section v-else class="editor-pane editor-empty">
            <p>Select an agent to edit its configuration.</p>
          </section>
        </div>
      </div>

      <!-- ===================== TAB: GLOBAL CONFIG ===================== -->
      <div v-if="store.activeTab === 'global'" class="tab-panel global-panel">
        <div class="config-form">
          <div class="form-group">
            <label class="form-label">Model</label>
            <select v-model="editModel" class="form-select">
              <option value="">— select —</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4.1">gpt-4.1</option>
              <option value="gpt-4.1-mini">gpt-4.1-mini</option>
              <option value="claude-sonnet-4">claude-sonnet-4</option>
              <option value="claude-sonnet-4-thinking">claude-sonnet-4-thinking</option>
              <option value="o3-mini">o3-mini</option>
              <option value="o4-mini">o4-mini</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Reasoning Effort</label>
            <select v-model="editReasoningEffort" class="form-select">
              <option value="">— default —</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Trusted Folders</label>
            <div class="folder-list">
              <div v-for="(folder, i) in editTrustedFolders" :key="i" class="folder-item">
                <span class="folder-path">{{ folder }}</span>
                <button class="btn-icon-sm" title="Remove" @click="removeFolder(i)">✕</button>
              </div>
              <div v-if="!editTrustedFolders.length" class="empty-state-small">No trusted folders configured.</div>
            </div>
            <div class="folder-add">
              <input
                v-model="newFolder"
                class="form-input"
                placeholder="Add folder path…"
                @keyup.enter="addFolder"
              />
              <button class="btn btn-secondary" @click="addFolder">Add</button>
            </div>
          </div>

          <button class="btn btn-primary" :disabled="store.saving" @click="handleSaveGlobalConfig">
            {{ store.saving ? 'Saving…' : 'Save Config' }}
          </button>
        </div>

        <div class="json-preview">
          <h3 class="section-heading">Raw JSON Preview</h3>
          <pre class="json-block">{{ rawJsonPreview }}</pre>
        </div>
      </div>

      <!-- ===================== TAB: VERSIONS ===================== -->
      <div v-if="store.activeTab === 'versions'" class="tab-panel versions-panel">
        <div class="version-grid">
          <div v-for="ver in store.versions" :key="ver.version" class="version-card">
            <div class="version-card-header">
              <span class="version-number">v{{ ver.version }}</span>
              <span v-if="ver.isActive" class="badge badge-active">Active</span>
              <span v-if="ver.isComplete" class="badge badge-complete">Complete</span>
            </div>
            <div class="version-meta">
              <span v-if="ver.hasCustomizations" class="meta-tag customized">Customized</span>
              <span class="meta-tag">Locks: {{ ver.lockCount ?? 0 }}</span>
            </div>
          </div>
          <div v-if="!store.versions.length" class="empty-state-small">No Copilot CLI versions discovered.</div>
        </div>

        <!-- Migration panel -->
        <div class="migration-panel">
          <h3 class="section-heading">Migration</h3>
          <div class="migration-controls">
            <div class="form-group">
              <label class="form-label">From</label>
              <select v-model="migrationFrom" class="form-select">
                <option value="">— source —</option>
                <option v-for="v in store.versions" :key="v.version" :value="v.version">
                  v{{ v.version }}
                </option>
              </select>
            </div>
            <span class="migration-arrow">→</span>
            <div class="form-group">
              <label class="form-label">To</label>
              <select v-model="migrationTo" class="form-select">
                <option value="">— target —</option>
                <option v-for="v in store.versions" :key="v.version" :value="v.version">
                  v{{ v.version }}
                </option>
              </select>
            </div>
            <button
              class="btn btn-secondary"
              :disabled="!migrationFrom || !migrationTo || migrationFrom === migrationTo"
              @click="handleLoadDiffs"
            >
              Load Diffs
            </button>
          </div>

          <div v-if="store.migrationDiffs.length" class="diff-results">
            <div v-for="diff in store.migrationDiffs" :key="diff.fileName" class="diff-card">
              <div class="diff-header">
                <span class="diff-agent-name">{{ diff.agentName ?? diff.fileName }}</span>
                <span v-if="diff.hasConflicts" class="badge badge-danger">Conflicts</span>
                <button class="btn btn-primary btn-sm" @click="handleMigrateAgent(diff.fileName)">
                  Migrate
                </button>
              </div>
              <pre class="diff-block"><template v-for="(line, i) in (diff.diff ?? '').split('\n')" :key="i"><span :class="{ 'diff-add': line.startsWith('+'), 'diff-remove': line.startsWith('-') }">{{ line }}{{ '\n' }}</span></template></pre>
            </div>
          </div>
        </div>
      </div>

      <!-- ===================== TAB: BACKUPS ===================== -->
      <div v-if="store.activeTab === 'backups'" class="tab-panel backups-panel">
        <!-- Create backup form -->
        <div class="backup-create">
          <h3 class="section-heading">Create Backup</h3>
          <div class="backup-form">
            <input v-model="newBackupPath" class="form-input" placeholder="Source path…" />
            <input v-model="newBackupLabel" class="form-input" placeholder="Label (optional)" />
            <button class="btn btn-primary" :disabled="!newBackupPath.trim() || store.saving" @click="handleCreateBackup">
              {{ store.saving ? 'Creating…' : 'Create Backup' }}
            </button>
          </div>
        </div>

        <!-- Backup table -->
        <div v-if="store.backups.length" class="backup-table-wrap">
          <table class="backup-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Source</th>
                <th>Created At</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="backup in store.backups" :key="backup.id">
                <td class="cell-label">{{ backup.label }}</td>
                <td class="cell-path">{{ backup.sourcePath }}</td>
                <td class="cell-date">{{ formatDate(backup.createdAt) }}</td>
                <td class="cell-size">{{ formatBytes(backup.sizeBytes) }}</td>
                <td class="cell-action">
                  <button class="btn btn-secondary btn-sm" @click="store.restoreBackup(backup.backupPath, backup.sourcePath)">
                    Restore
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="empty-state">
          <div class="empty-state-icon">📦</div>
          <h2 class="empty-state-title">No Backups Yet</h2>
          <p class="empty-state-desc">Create a backup above to safeguard your configuration before making changes.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Layout ── */
.page-content {
  height: 100%;
  overflow-y: auto;
  background: var(--canvas-default);
  color: var(--text-primary);
}

.page-content-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px 28px 48px;
}

/* ── Banners ── */
.banner {
  padding: 10px 16px;
  border-radius: var(--radius-md);
  margin-bottom: 16px;
  font-size: 0.875rem;
  font-weight: 500;
}

.banner-success {
  background: var(--success-subtle);
  color: var(--success-fg);
  border: 1px solid var(--success-muted);
}

.banner-error {
  background: var(--danger-subtle);
  color: var(--danger-fg);
  border: 1px solid var(--danger-muted);
}

.banner-enter-active,
.banner-leave-active {
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}

.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ── Header ── */
.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
}

.version-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
  background: var(--accent-subtle);
  color: var(--accent-fg);
  border: 1px solid var(--accent-emphasis);
}

/* ── Tab Bar ── */
.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-default);
  margin-bottom: 24px;
}

.tab-btn {
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast);
}

.tab-btn:hover {
  color: var(--text-primary);
  background: var(--canvas-subtle);
}

.tab-btn.active {
  color: var(--accent-fg);
  border-bottom-color: var(--accent-fg);
}

/* ── Loading ── */
.loading-state {
  text-align: center;
  padding: 40px;
  color: var(--text-tertiary);
  font-size: 0.875rem;
}

/* ── Tab Panels ── */
.tab-panel {
  min-height: 400px;
}

/* ── AGENTS TAB ── */
.split-pane {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 20px;
  min-height: 520px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  max-height: 600px;
  padding-right: 4px;
}

.agent-card {
  padding: 12px 14px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}

.agent-card:hover {
  border-color: var(--border-default);
  background: var(--canvas-default);
}

.agent-card.selected {
  border-color: var(--accent-emphasis);
  background: var(--canvas-default);
}

.agent-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.agent-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.agent-model {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.agent-desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin: 0 0 6px;
  line-height: 1.4;
}

.tool-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  display: inline-block;
  padding: 1px 7px;
  font-size: 0.7rem;
  border-radius: var(--radius-sm);
  background: var(--neutral-subtle);
  color: var(--text-secondary);
  border: 1px solid var(--border-muted);
}

/* ── Editor Pane ── */
.editor-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.editor-pane.editor-empty {
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  border: 1px dashed var(--border-muted);
  border-radius: var(--radius-md);
}

.editor-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.editor-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.editor-path {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.yaml-editor {
  flex: 1;
  min-height: 360px;
  padding: 14px;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--text-primary);
  background: var(--canvas-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  resize: vertical;
  tab-size: 2;
}

.yaml-editor:focus {
  outline: none;
  border-color: var(--accent-emphasis);
}

.editor-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: pointer;
}

/* ── GLOBAL CONFIG TAB ── */
.global-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.form-select,
.form-input {
  padding: 8px 12px;
  font-size: 0.875rem;
  color: var(--text-primary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.form-select:focus,
.form-input:focus {
  outline: none;
  border-color: var(--accent-emphasis);
}

.folder-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.folder-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
}

.folder-path {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.btn-icon-sm {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.875rem;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.btn-icon-sm:hover {
  color: var(--danger-fg);
  background: var(--danger-subtle);
}

.folder-add {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.folder-add .form-input {
  flex: 1;
}

.json-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-heading {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.json-block {
  padding: 14px;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.5;
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  overflow-x: auto;
  margin: 0;
}

/* ── VERSIONS TAB ── */
.version-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 28px;
}

.version-card {
  padding: 14px 16px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.version-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.version-number {
  font-weight: 700;
  font-size: 0.9375rem;
  font-family: var(--font-mono);
}

.badge {
  display: inline-flex;
  padding: 1px 8px;
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
}

.badge-active {
  background: var(--accent-subtle);
  color: var(--accent-fg);
  border: 1px solid var(--accent-emphasis);
}

.badge-complete {
  background: var(--success-subtle);
  color: var(--success-fg);
  border: 1px solid var(--success-muted);
}

.badge-danger {
  background: var(--danger-subtle);
  color: var(--danger-fg);
  border: 1px solid var(--danger-muted);
}

.version-meta {
  display: flex;
  gap: 8px;
}

.meta-tag {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.meta-tag.customized {
  color: var(--warning-fg);
}

/* Migration */
.migration-panel {
  border-top: 1px solid var(--border-muted);
  padding-top: 20px;
}

.migration-controls {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin: 12px 0 20px;
}

.migration-arrow {
  font-size: 1.25rem;
  color: var(--text-tertiary);
  padding-bottom: 8px;
}

.diff-results {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.diff-card {
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-muted);
}

.diff-agent-name {
  font-weight: 600;
  font-size: 0.875rem;
  flex: 1;
}

.diff-block {
  padding: 12px 14px;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.55;
  background: var(--canvas-inset);
  margin: 0;
  overflow-x: auto;
  white-space: pre;
}

.diff-add {
  color: var(--success-fg);
  background: var(--success-subtle);
}

.diff-remove {
  color: var(--danger-fg);
  background: var(--danger-subtle);
}

/* ── BACKUPS TAB ── */
.backup-create {
  margin-bottom: 24px;
}

.backup-form {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.backup-form .form-input {
  flex: 1;
}

.backup-table-wrap {
  overflow-x: auto;
}

.backup-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.backup-table th {
  text-align: left;
  padding: 10px 12px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 2px solid var(--border-default);
  font-size: 0.8125rem;
}

.backup-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-muted);
  color: var(--text-primary);
}

.cell-path {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.cell-date {
  white-space: nowrap;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

.cell-size {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.cell-action {
  text-align: right;
}

/* ── Empty State ── */
.empty-state {
  text-align: center;
  padding: 48px 20px;
}

.empty-state-icon {
  font-size: 2.5rem;
  margin-bottom: 12px;
}

.empty-state-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0 0 6px;
  color: var(--text-primary);
}

.empty-state-desc {
  color: var(--text-tertiary);
  font-size: 0.875rem;
  margin: 0;
}

.empty-state-small {
  padding: 16px;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

/* ── Buttons ── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis);
  border-color: var(--accent-emphasis);
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-secondary {
  background: var(--canvas-subtle);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--canvas-default);
  border-color: var(--border-default);
}

.btn-sm {
  padding: 4px 10px;
  font-size: 0.8rem;
}
</style>
