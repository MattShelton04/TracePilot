<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useConfigInjectorStore, type ConfigTab } from '@/stores/configInjector';
import type { AgentDefinition } from '@tracepilot/types';
import {
  MODEL_REGISTRY,
  getModelsByTier,
  getAllModelIds,
  getModelTier,
  getTierLabel,
  DEFAULT_PREMIUM_MODEL_ID,
} from '@tracepilot/types';

const store = useConfigInjectorStore();

// ── Dismissible Warning ─────────────────────────────────────────────────────
const warningDismissed = ref(false);

// ── Agent Metadata ──────────────────────────────────────────────────────────
const AGENT_META: Record<string, { emoji: string; colorVar: string; motto: string }> = {
  explore:             { emoji: '🔍', colorVar: '--accent-emphasis',   motto: 'Fast & thorough explorer' },
  task:                { emoji: '⚡', colorVar: '--warning-emphasis',  motto: 'Reliable command runner' },
  'code-review':       { emoji: '📝', colorVar: '--success-emphasis',  motto: 'High signal-to-noise reviewer' },
  research:            { emoji: '🔬', colorVar: '--done-emphasis',     motto: 'Deep analysis specialist' },
  'configure-copilot': { emoji: '⚙️', colorVar: '--neutral-emphasis',  motto: 'System configurator' },
};

function agentMeta(name: string) {
  return AGENT_META[name] ?? { emoji: '🤖', colorVar: '--neutral-emphasis', motto: '' };
}

// ── Available Models (derived from shared registry) ─────────────────────────
const ALL_MODELS = getAllModelIds();
const PREMIUM_MODELS = getModelsByTier('premium').map(m => m.id);
const STANDARD_MODELS = getModelsByTier('standard').map(m => m.id);
const FAST_MODELS = getModelsByTier('fast').map(m => m.id);

function modelTier(model: string): 'premium' | 'standard' | 'fast' {
  return getModelTier(model);
}

function tierLabel(tier: string): string {
  return getTierLabel(tier as 'premium' | 'standard' | 'fast');
}

// ── Tabs ────────────────────────────────────────────────────────────────────
const tabs: { key: ConfigTab; label: string; emoji: string }[] = [
  { key: 'agents',   label: 'Agent Models',  emoji: '🤖' },
  { key: 'global',   label: 'Global Config', emoji: '📋' },
  { key: 'versions', label: 'Environment',   emoji: '🔧' },
  { key: 'backups',  label: 'Backups',       emoji: '💾' },
];

function tabCount(key: ConfigTab): number | null {
  if (key === 'agents') return store.agents.length;
  if (key === 'backups') return store.backups.length;
  return null;
}

// ── Stat Cards (Agents Tab) ─────────────────────────────────────────────────
const uniqueModelCount = computed(() => new Set(store.agents.map(a => a.model)).size);
const premiumAgentCount = computed(() => store.agents.filter(a => PREMIUM_MODELS.includes(a.model)).length);

// ── Agent Tools Expand State ────────────────────────────────────────────────
const TOOLS_COLLAPSE_LIMIT = 5;
const expandedTools = reactive<Record<string, boolean>>({});

function visibleTools(agent: AgentDefinition): string[] {
  if (!agent.tools?.length) return [];
  if (expandedTools[agent.filePath] || agent.tools.length <= TOOLS_COLLAPSE_LIMIT) return agent.tools;
  return agent.tools.slice(0, TOOLS_COLLAPSE_LIMIT);
}

function hiddenToolCount(agent: AgentDefinition): number {
  if (!agent.tools?.length || agent.tools.length <= TOOLS_COLLAPSE_LIMIT) return 0;
  return agent.tools.length - TOOLS_COLLAPSE_LIMIT;
}

function truncateTool(name: string): string {
  return name.length > 50 ? name.slice(0, 47) + '…' : name;
}

// ── Auto-save Indicator ─────────────────────────────────────────────────────
const autoSavedAgent = ref<string | null>(null);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function flashAutoSaved(filePath: string) {
  autoSavedAgent.value = filePath;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { autoSavedAgent.value = null; }, 2000);
}

// ── Agent Model State ───────────────────────────────────────────────────────
const agentModels = ref<Record<string, string>>({});

watch(() => store.agents, (agents) => {
  const map: Record<string, string> = {};
  for (const a of agents) map[a.filePath] = a.model;
  agentModels.value = map;
}, { immediate: true });

async function handleModelChange(agent: AgentDefinition, newModel: string) {
  store.selectAgent(agent);
  const updatedYaml = agent.rawYaml.replace(/^(\s*model:\s*).+$/m, `$1${newModel}`);
  if (updatedYaml === agent.rawYaml) {
    // model: key not found — append it after the first line
    store.editingYaml = `${agent.rawYaml.trimEnd()}\nmodel: ${newModel}\n`;
  } else {
    store.editingYaml = updatedYaml;
  }
  const saved = await store.saveAgent();
  if (saved !== false) {
    flashAutoSaved(agent.filePath);
  }
}

function onAgentModelSelect(agent: AgentDefinition) {
  const newModel = agentModels.value[agent.filePath];
  if (newModel && newModel !== agent.model) {
    handleModelChange(agent, newModel);
  }
}

async function upgradeAgent(agent: AgentDefinition) {
  agentModels.value[agent.filePath] = DEFAULT_PREMIUM_MODEL_ID;
  await handleModelChange(agent, DEFAULT_PREMIUM_MODEL_ID);
}

const batchUpgrading = ref(false);

async function upgradeAllToOpus() {
  batchUpgrading.value = true;
  try {
    const toUpgrade = store.agents.filter(a => a.model !== DEFAULT_PREMIUM_MODEL_ID);
    for (const agent of toUpgrade) {
      agentModels.value[agent.filePath] = DEFAULT_PREMIUM_MODEL_ID;
      await handleModelChange(agent, DEFAULT_PREMIUM_MODEL_ID);
    }
  } finally {
    batchUpgrading.value = false;
  }
}

async function resetAllDefaults() {
  await store.initialize();
  // Force re-sync agentModels from refreshed store data
  const map: Record<string, string> = {};
  for (const a of store.agents) map[a.filePath] = a.model;
  agentModels.value = map;
  syncGlobalFields();
}

// ── Global Config ───────────────────────────────────────────────────────────
const editModel = ref('');
const editReasoningEffort = ref('');
const editShowReasoning = ref(false);
const editRenderMarkdown = ref(true);
const editTrustedFolders = ref<string[]>([]);
const newFolder = ref('');

function syncGlobalFields() {
  if (store.copilotConfig) {
    editModel.value = store.copilotConfig.model ?? '';
    editReasoningEffort.value = store.copilotConfig.reasoningEffort ?? '';
    editTrustedFolders.value = [...(store.copilotConfig.trustedFolders ?? [])];
    const raw = store.copilotConfig.raw ?? {};
    editShowReasoning.value = Boolean(raw.showReasoning);
    editRenderMarkdown.value = raw.renderMarkdown !== false;
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

const configDiffLines = computed(() => {
  if (!store.copilotConfig) return { left: [] as { text: string; changed: boolean }[], right: [] as { text: string; changed: boolean }[] };
  const current = { model: store.copilotConfig.model ?? '', reasoningEffort: store.copilotConfig.reasoningEffort ?? '', trustedFolders: store.copilotConfig.trustedFolders ?? [] };
  const modified = { model: editModel.value, reasoningEffort: editReasoningEffort.value, trustedFolders: editTrustedFolders.value };
  const curLines = JSON.stringify(current, null, 2).split('\n');
  const modLines = JSON.stringify(modified, null, 2).split('\n');
  const maxLen = Math.max(curLines.length, modLines.length);
  const left: { text: string; changed: boolean }[] = [];
  const right: { text: string; changed: boolean }[] = [];
  for (let i = 0; i < maxLen; i++) {
    const cl = curLines[i] ?? '';
    const ml = modLines[i] ?? '';
    const changed = cl !== ml;
    left.push({ text: cl, changed });
    right.push({ text: ml, changed });
  }
  return { left, right };
});

const hasConfigChanges = computed(() => configDiffLines.value.left.some(l => l.changed));

function handleSaveGlobalConfig() {
  store.saveGlobalConfig({
    model: editModel.value,
    reasoningEffort: editReasoningEffort.value,
    showReasoning: editShowReasoning.value,
    renderMarkdown: editRenderMarkdown.value,
    trustedFolders: editTrustedFolders.value,
  });
}

// ── Versions / Migration ────────────────────────────────────────────────────
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

// ── Backups ─────────────────────────────────────────────────────────────────
const newBackupPath = ref('');
const newBackupLabel = ref('');

const backupableFiles = computed(() => {
  const files: { label: string; path: string }[] = [];
  // Derive copilot home from active version path (~/.copilot/pkg/universal/<ver>)
  if (store.activeVersion?.path) {
    const parts = store.activeVersion.path.replace(/\\/g, '/').split('/');
    // Go up 3 levels: <ver> -> universal -> pkg -> .copilot
    const copilotHome = parts.slice(0, -3).join(parts[0].includes(':') ? '\\' : '/');
    if (copilotHome) {
      const sep = store.activeVersion.path.includes('\\') ? '\\' : '/';
      files.push({ label: '📋 Global Config (config.json)', path: `${copilotHome}${sep}config.json` });
    }
  }
  for (const agent of store.agents) {
    files.push({ label: `🤖 ${agent.name} agent`, path: agent.filePath });
  }
  return files;
});

async function handleCreateBackup() {
  if (newBackupPath.value.trim()) {
    const label = (newBackupLabel.value.trim() || 'manual').replace(/\s+/g, '-').toLowerCase();
    await store.createBackup(newBackupPath.value.trim(), label);
    newBackupPath.value = '';
    newBackupLabel.value = '';
  }
}

const batchBackingUp = ref(false);

async function handleBackupAllAgents() {
  if (!store.agents.length || batchBackingUp.value) return;
  batchBackingUp.value = true;
  let succeeded = 0;
  let failed = 0;
  try {
    for (const agent of store.agents) {
      try {
        const ok = await store.createBackup(agent.filePath, 'batch', true);
        if (ok) succeeded++;
        else failed++;
      } catch {
        failed++;
      }
    }
    // Show single summary instead of per-agent toasts
    store.successMessage = failed
      ? `Backed up ${succeeded} agents, ${failed} failed`
      : `Backed up all ${succeeded} agents`;
    setTimeout(() => { store.successMessage = null; }, 3000);
  } finally {
    batchBackingUp.value = false;
  }
}

function backupEmoji(path: string): string {
  if (path.includes('agent') || path.endsWith('.md')) return '🤖';
  return '📋';
}

function formatBackupLabel(backup: { label: string; backupPath: string; sourcePath: string }): string {
  // Prefer the sidecar label if it's descriptive
  const label = backup.label || '';
  const fileName = backup.backupPath.split(/[/\\]/).pop() || 'Unknown';

  // Extract the agent/file stem from the backup filename (before the label/timestamp)
  // Format: {stem}-{label}-{timestamp} or {stem}-{timestamp}
  const stemMatch = fileName.match(/^(.+?)(?:-(?:batch|manual|pre-migrate-\S+))?-\d{8}-/);
  const stem = stemMatch?.[1] || fileName.replace(/-\d{8}-.*$/, '');

  // Build human-readable name
  const prefix = stem.replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (label === 'batch') return `${prefix} (batch)`;
  if (label === 'manual') return `${prefix} (manual)`;
  if (label.startsWith('pre-migrate')) return `${prefix} (pre-migrate)`;
  if (label && label !== fileName) return `${prefix} — ${label}`;
  return prefix;
}

function shortenPath(path: string): string {
  if (!path) return '';
  // Show last 2 path segments for brevity
  const parts = path.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : path;
}

const confirmingDeleteBackupId = ref<string | null>(null);

async function toggleDeleteBackup(backup: { id: string; backupPath: string }) {
  if (confirmingDeleteBackupId.value === backup.id) {
    await store.deleteBackup(backup.backupPath);
    confirmingDeleteBackupId.value = null;
  } else {
    confirmingDeleteBackupId.value = backup.id;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
import { formatBytes, formatDate } from '@tracepilot/ui';

// ── Init ────────────────────────────────────────────────────────────────────
onMounted(() => {
  store.initialize().then(() => syncGlobalFields());
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- ── Success / Error Banners ── -->
      <Transition name="banner">
        <div v-if="store.successMessage" class="banner banner-success">
          ✓ {{ store.successMessage }}
        </div>
      </Transition>
      <Transition name="banner">
        <div v-if="store.error" class="banner banner-error">
          ✕ {{ store.error }}
        </div>
      </Transition>

      <!-- ── Breadcrumb ── -->
      <nav class="breadcrumb">
        <span class="breadcrumb-link">Orchestration</span>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">Config Injector</span>
      </nav>

      <!-- ── Page Header ── -->
      <div class="page-header">
        <h1 class="page-title">⚙️ Config Injector</h1>
      </div>

      <!-- ── Warning Banner ── -->
      <Transition name="banner">
        <div v-if="store.hasCustomizations && !warningDismissed" class="warning-banner">
          <span class="warning-banner-text">
            ⚠️ Copilot will overwrite customizations on update. Set
            <code>COPILOT_AUTO_UPDATE=false</code> to prevent.
            We don't recommend disabling auto-update and suggest reinjecting after every update.
          </span>
          <button class="warning-banner-close" title="Dismiss" @click="warningDismissed = true">✕</button>
        </div>
      </Transition>

      <!-- ── Tab Navigation ── -->
      <nav class="tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-btn"
          :class="{ active: store.activeTab === tab.key }"
          @click="store.activeTab = tab.key"
        >
          {{ tab.emoji }} {{ tab.label }}
          <span v-if="tabCount(tab.key) !== null" class="tab-badge">
            {{ tabCount(tab.key) }}
          </span>
        </button>
      </nav>

      <!-- ── Loading State ── -->
      <div v-if="store.loading" class="loading-state">
        <div class="loading-spinner" />
        <span>Loading configuration…</span>
      </div>

      <!-- ════════════════════════════════════════════════════════════════════
           TAB 1: AGENT MODELS
           ════════════════════════════════════════════════════════════════════ -->
      <div v-if="!store.loading && store.activeTab === 'agents'" class="tab-panel">
        <!-- Stat Cards -->
        <div class="stat-grid">
          <div class="stat-card stat-card--accent">
            <span class="stat-value">{{ store.agents.length }}</span>
            <span class="stat-label">Agent Definitions</span>
          </div>
          <div class="stat-card stat-card--done">
            <span class="stat-value">{{ uniqueModelCount }}</span>
            <span class="stat-label">Unique Models Used</span>
          </div>
          <div class="stat-card stat-card--warning">
            <span class="stat-value">{{ premiumAgentCount }}</span>
            <span class="stat-label">Premium Agents</span>
          </div>
          <div class="stat-card stat-card--success">
            <span class="stat-value">{{ ALL_MODELS.length }}</span>
            <span class="stat-label">Models Available</span>
          </div>
        </div>

        <!-- Agent Grid -->
        <div class="agent-grid">
          <div
            v-for="agent in store.agents"
            :key="agent.filePath"
            class="agent-card"
            :style="{ '--agent-accent': `var(${agentMeta(agent.name).colorVar})` }"
          >
            <div class="agent-header">
              <div class="agent-icon">
                {{ agentMeta(agent.name).emoji }}
              </div>
              <div class="agent-info">
                <span class="agent-name">{{ agent.name }}</span>
                <span
                  class="tier-badge"
                  :class="`tier-badge--${modelTier(agentModels[agent.filePath] ?? agent.model)}`"
                >
                  {{ tierLabel(modelTier(agentModels[agent.filePath] ?? agent.model)) }}
                </span>
              </div>
            </div>

            <p class="agent-desc">
              {{ agent.description || agentMeta(agent.name).motto }}
            </p>

            <div v-if="agent.tools?.length" class="agent-tools">
              <span
                v-for="tool in visibleTools(agent)"
                :key="tool"
                class="tool-chip"
                :title="tool.length > 50 ? tool : undefined"
              >{{ truncateTool(tool) }}</span>
              <span
                v-if="hiddenToolCount(agent) > 0 && !expandedTools[agent.filePath]"
                class="tool-chip tool-chip--more"
                @click="expandedTools[agent.filePath] = true"
              >
                +{{ hiddenToolCount(agent) }} more
              </span>
              <span
                v-if="expandedTools[agent.filePath] && agent.tools.length > TOOLS_COLLAPSE_LIMIT"
                class="tool-chip tool-chip--more"
                @click="expandedTools[agent.filePath] = false"
              >
                Show less
              </span>
            </div>

            <div class="agent-model-section">
              <select
                v-model="agentModels[agent.filePath]"
                class="form-input model-select"
                @change="onAgentModelSelect(agent)"
              >
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

              <button
                v-if="modelTier(agentModels[agent.filePath] ?? agent.model) !== 'premium'"
                class="btn-upgrade"
                :disabled="store.saving"
                @click="upgradeAgent(agent)"
              >
                ⬆ Upgrade
              </button>
              <span v-else class="premium-active-badge">✓ Premium</span>
              <Transition name="banner">
                <span v-if="autoSavedAgent === agent.filePath" class="auto-saved-hint">(auto-saved)</span>
              </Transition>
            </div>
          </div>

          <div v-if="!store.agents.length" class="empty-state-small">
            No agent definitions found.
          </div>
        </div>

        <!-- Batch Actions -->
        <div v-if="store.agents.length" class="batch-actions">
          <span class="batch-label">Batch action:</span>
          <button
            class="btn-gradient"
            :disabled="store.saving || batchUpgrading"
            @click="upgradeAllToOpus"
          >
            {{ batchUpgrading ? 'Upgrading…' : '⬆ Upgrade All to Opus 4.6' }}
          </button>
          <button
            class="btn btn-sm"
            :disabled="store.saving"
            @click="resetAllDefaults"
          >
            ↩ Reload from Disk
          </button>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════════════════
           TAB 2: GLOBAL CONFIG
           ════════════════════════════════════════════════════════════════════ -->
      <div v-if="!store.loading && store.activeTab === 'global'" class="tab-panel">
        <div class="global-layout">
          <!-- Config Form -->
          <div class="config-form">
            <!-- Default Model -->
            <div class="form-group">
              <label class="form-label">Default Model</label>
              <select v-model="editModel" class="form-input">
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
              <label class="form-label">Reasoning Effort</label>
              <div class="toggle-group">
                <button
                  v-for="level in ['low', 'medium', 'high']"
                  :key="level"
                  class="toggle-btn"
                  :class="{ active: editReasoningEffort === level }"
                  @click="editReasoningEffort = level"
                >
                  {{ level.charAt(0).toUpperCase() + level.slice(1) }}
                </button>
              </div>
            </div>

            <!-- Show Reasoning -->
            <div class="switch-row">
              <div>
                <label class="form-label">Show Reasoning</label>
                <span class="form-hint">Controls whether Copilot CLI displays reasoning traces</span>
              </div>
              <button
                class="switch-track"
                :class="{ active: editShowReasoning }"
                role="switch"
                :aria-checked="editShowReasoning"
                @click="editShowReasoning = !editShowReasoning"
              >
                <span class="switch-thumb" />
              </button>
            </div>

            <!-- Render Markdown -->
            <div class="switch-row">
              <div>
                <label class="form-label">Render Markdown</label>
                <span class="form-hint">Controls whether Copilot CLI renders markdown in responses</span>
              </div>
              <button
                class="switch-track"
                :class="{ active: editRenderMarkdown }"
                role="switch"
                :aria-checked="editRenderMarkdown"
                @click="editRenderMarkdown = !editRenderMarkdown"
              >
                <span class="switch-thumb" />
              </button>
            </div>

            <!-- Trusted Folders -->
            <div class="form-group">
              <label class="form-label">Trusted Folders</label>
              <div class="folder-list">
                <div v-for="(folder, i) in editTrustedFolders" :key="i" class="folder-item">
                  <span class="folder-path">{{ folder }}</span>
                  <button class="btn-icon-sm" title="Remove" @click="removeFolder(i)">✕</button>
                </div>
                <div v-if="!editTrustedFolders.length" class="empty-state-small">
                  No trusted folders configured.
                </div>
              </div>
              <div class="folder-add">
                <input
                  v-model="newFolder"
                  class="form-input"
                  placeholder="Add folder path…"
                  @keyup.enter="addFolder"
                />
                <button class="btn btn-sm" @click="addFolder">Add</button>
              </div>
            </div>

            <!-- Save Button -->
            <button
              class="btn btn-primary"
              :disabled="store.saving || !hasConfigChanges"
              @click="handleSaveGlobalConfig"
            >
              {{ store.saving ? 'Saving…' : '💾 Save Config' }}
            </button>
          </div>

          <!-- Diff Preview -->
          <details v-if="hasConfigChanges" class="diff-preview-details" open>
            <summary class="diff-preview-summary">
              <span>📝 Diff Preview</span>
              <span class="diff-badge">{{ configDiffLines.left.filter(l => l.changed).length + configDiffLines.right.filter(l => l.changed).length }} changes</span>
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

      <!-- ════════════════════════════════════════════════════════════════════
           TAB 3: ENVIRONMENT / VERSIONS
           ════════════════════════════════════════════════════════════════════ -->
      <div v-if="!store.loading && store.activeTab === 'versions'" class="tab-panel">
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
          <div v-if="!store.versions.length" class="empty-state-small">
            No Copilot CLI versions discovered.
          </div>
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

      <!-- ════════════════════════════════════════════════════════════════════
           TAB 4: BACKUPS
           ════════════════════════════════════════════════════════════════════ -->
      <div v-if="!store.loading && store.activeTab === 'backups'" class="tab-panel">
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
          <div v-for="backup in store.backups" :key="backup.id" class="backup-item">
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
        </div>

        <div v-else class="empty-state">
          <div class="empty-state-icon">📦</div>
          <h2 class="empty-state-title">No Backups Yet</h2>
          <p class="empty-state-desc">
            Create a backup above to safeguard your configuration before making changes.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Layout ──────────────────────────────────────────────────────────────── */
.page-content {
  height: 100%;
  overflow-y: auto;
  background: var(--canvas-default);
  color: var(--text-primary);
}

.page-content-inner {
  max-width: var(--content-max-width, 1200px);
  margin: 0 auto;
  padding: 24px 28px 48px;
}

/* ── Banners ─────────────────────────────────────────────────────────────── */
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
  transition: opacity var(--transition-normal), transform var(--transition-normal);
}

.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ── Breadcrumb ──────────────────────────────────────────────────────────── */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  margin-bottom: 12px;
}

.breadcrumb-link {
  color: var(--text-tertiary);
}

.breadcrumb-sep {
  color: var(--text-tertiary);
}

.breadcrumb-current {
  color: var(--text-secondary);
}

/* ── Page Header ─────────────────────────────────────────────────────────── */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
}

/* ── Warning Banner ──────────────────────────────────────────────────────── */
.warning-banner {
  background: var(--warning-subtle);
  border: 1px solid var(--warning-muted);
  color: var(--warning-fg);
  border-radius: var(--radius-md);
  padding: 10px 16px;
  margin-bottom: 16px;
  font-size: 0.8125rem;
  line-height: 1.5;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.warning-banner-text {
  flex: 1;
}
.warning-banner-close {
  background: none;
  border: none;
  color: var(--warning-fg);
  cursor: pointer;
  font-size: 1rem;
  padding: 0 2px;
  opacity: 0.7;
  flex-shrink: 0;
  line-height: 1;
}
.warning-banner-close:hover {
  opacity: 1;
}
.banner-enter-active, .banner-leave-active {
  transition: opacity 0.2s ease, max-height 0.2s ease;
  overflow: hidden;
}
.banner-enter-from, .banner-leave-to {
  opacity: 0;
  max-height: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.warning-banner code {
  font-family: var(--font-mono);
  background: var(--neutral-subtle);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
}

/* ── Tab Bar ─────────────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-default);
  margin-bottom: 24px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 0.8125rem;
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
}

.tab-btn.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-emphasis);
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 0.6875rem;
  font-weight: 700;
  border-radius: var(--radius-full);
  background: var(--accent-muted);
  color: var(--accent-fg);
}

/* ── Loading ─────────────────────────────────────────────────────────────── */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px;
  color: var(--text-tertiary);
  font-size: 0.875rem;
}

.loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-fg);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Tab Panel ───────────────────────────────────────────────────────────── */
.tab-panel {
  min-height: 400px;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB 1: AGENT MODELS
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Stat Grid ── */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 24px;
}

.stat-card {
  padding: 16px 18px;
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.stat-card--accent .stat-value { color: var(--accent-fg); }
.stat-card--accent { border-color: var(--accent-muted); }
.stat-card--done .stat-value { color: var(--done-fg); }
.stat-card--done { border-color: var(--done-muted); }
.stat-card--warning .stat-value { color: var(--warning-fg); }
.stat-card--warning { border-color: var(--warning-muted); }
.stat-card--success .stat-value { color: var(--success-fg); }
.stat-card--success { border-color: var(--success-muted); }

/* ── Agent Grid ── */
.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.agent-card {
  position: relative;
  padding: 20px;
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  transition:
    border-color var(--transition-normal),
    box-shadow var(--transition-normal),
    transform var(--transition-normal);
}

.agent-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--agent-accent, var(--neutral-emphasis));
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.agent-card:hover {
  border-color: var(--border-accent);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

/* ── Agent Header ── */
.agent-header {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}

.agent-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  font-size: 28px;
  flex-shrink: 0;
}

.agent-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.agent-name {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Tier Badges ── */
.tier-badge {
  display: inline-flex;
  align-self: flex-start;
  padding: 1px 8px;
  font-size: 0.6875rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
}

.tier-badge--standard {
  background: var(--accent-subtle);
  color: var(--accent-fg);
  border: 1px solid var(--accent-muted);
}

.tier-badge--premium {
  background: var(--done-subtle);
  color: var(--done-fg);
  border: 1px solid var(--done-muted);
}

.tier-badge--fast {
  background: var(--neutral-subtle);
  color: var(--neutral-fg);
  border: 1px solid var(--neutral-muted);
}

/* ── Agent Body ── */
.agent-desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 10px;
}

.agent-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 14px;
}

.tool-chip {
  display: inline-block;
  padding: 2px 7px;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
  border: 1px solid var(--border-subtle);
  font-size: 0.6875rem;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

.tool-chip--more {
  cursor: pointer;
  background: var(--accent-subtle, var(--neutral-subtle));
  color: var(--accent-fg, var(--text-secondary));
  font-weight: 500;
}

.tool-chip--more:hover {
  background: var(--accent-muted, var(--canvas-default));
}

.auto-saved-hint {
  font-size: 0.75rem;
  color: var(--success-fg, #2ea043);
  font-weight: 500;
  white-space: nowrap;
}

/* ── Agent Model Section ── */
.agent-model-section {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
}

.model-select {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
}

.btn-upgrade {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-inverse);
  background: linear-gradient(135deg, var(--done-emphasis), var(--done-fg));
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: filter var(--transition-fast);
}

.btn-upgrade:hover:not(:disabled) {
  filter: brightness(1.15);
}

.btn-upgrade:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.premium-active-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--done-fg);
  background: var(--done-subtle);
  border: 1px solid var(--done-muted);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

/* ── Batch Actions ── */
.batch-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
}

.batch-label {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  font-weight: 500;
}

.btn-gradient {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-inverse);
  background: linear-gradient(135deg, var(--done-emphasis), var(--done-fg));
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: filter var(--transition-fast);
}

.btn-gradient:hover:not(:disabled) {
  filter: brightness(1.15);
}

.btn-gradient:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB 2: GLOBAL CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */
.global-layout {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 24px;
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

.form-hint {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 400;
  margin-top: 1px;
}

.form-input {
  padding: 8px 12px;
  font-size: 0.875rem;
  color: var(--text-primary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.form-input:focus {
  outline: none;
  border-color: var(--accent-emphasis);
}

/* ── Toggle Group ── */
.toggle-group {
  display: inline-flex;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.toggle-btn {
  padding: 6px 18px;
  font-size: 0.8125rem;
  font-weight: 500;
  background: var(--canvas-subtle);
  border: none;
  border-radius: 0;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.toggle-btn:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.toggle-btn:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.toggle-btn + .toggle-btn {
  border-left: 1px solid var(--border-default);
}

.toggle-btn.active {
  background: var(--accent-muted);
  color: var(--accent-fg);
}

.toggle-btn:hover:not(.active) {
  background: var(--canvas-default);
}

/* ── Switch ── */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.switch-track {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: var(--neutral-muted);
  border: none;
  padding: 2px;
  cursor: pointer;
  transition: background var(--transition-fast);
  flex-shrink: 0;
}

.switch-track.active {
  background: var(--accent-emphasis);
}

.switch-thumb {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--text-primary);
  transition: transform var(--transition-fast);
}

.switch-track.active .switch-thumb {
  transform: translateX(18px);
}

/* ── Folders ── */
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
  background: var(--canvas-default);
  border: 1px solid var(--border-subtle);
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
  transition: color var(--transition-fast), background var(--transition-fast);
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

/* ── Diff Preview ── */
.diff-preview-details {
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.diff-preview-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
  background: var(--canvas-subtle);
  user-select: none;
}
.diff-preview-summary::-webkit-details-marker {
  display: none;
}
.diff-preview-summary::before {
  content: '▶';
  font-size: 0.65rem;
  transition: transform 0.15s ease;
}
.diff-preview-details[open] .diff-preview-summary::before {
  transform: rotate(90deg);
}
.diff-badge {
  font-size: 0.7rem;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--accent-subtle);
  color: var(--accent-fg);
}
.diff-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.diff-side-by-side {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.diff-side-by-side--compact {
  gap: 0;
  border-top: 1px solid var(--border-muted);
}
.diff-side-by-side--compact .diff-panel {
  border: none;
  border-radius: 0;
}

.diff-panel {
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.diff-panel-header {
  padding: 2px 8px;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.diff-panel-header--left {
  color: var(--danger-fg);
  background: var(--danger-subtle);
  border-bottom: 1px solid var(--danger-muted);
}

.diff-panel-header--right {
  color: var(--success-fg);
  background: var(--success-subtle);
  border-bottom: 1px solid var(--success-muted);
}

.diff-panel-body {
  padding: 6px 10px;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.5;
  background: var(--canvas-inset);
  overflow-x: auto;
  overflow-y: auto;
  white-space: pre;
  max-height: 120px;
}

.diff-line--removed {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}

.diff-line--added {
  background: var(--success-subtle);
  color: var(--success-fg);
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB 3: ENVIRONMENT / VERSIONS
   ═══════════════════════════════════════════════════════════════════════════ */
.version-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  margin-bottom: 28px;
}

.version-card {
  padding: 16px 18px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  transition: border-color var(--transition-fast);
}

.version-card:hover {
  border-color: var(--border-default);
}

.version-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.version-number {
  font-weight: 700;
  font-size: 0.9375rem;
  font-family: var(--font-mono);
}

.version-badges {
  display: flex;
  gap: 4px;
}

.badge {
  display: inline-flex;
  padding: 1px 8px;
  font-size: 0.6875rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
}

.badge--accent {
  background: var(--accent-subtle);
  color: var(--accent-fg);
  border: 1px solid var(--accent-muted);
}

.badge--success {
  background: var(--success-subtle);
  color: var(--success-fg);
  border: 1px solid var(--success-muted);
}

.badge--danger {
  background: var(--danger-subtle);
  color: var(--danger-fg);
  border: 1px solid var(--danger-muted);
}

.version-meta {
  display: flex;
  gap: 10px;
}

.meta-tag {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.meta-tag--warn {
  color: var(--warning-fg);
}

/* ── Migration ── */
.migration-panel {
  border-top: 1px solid var(--border-muted);
  padding-top: 20px;
}

.migration-guidance {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 6px 0 0;
}

.migration-from-hint {
  color: var(--danger-fg);
  font-weight: 600;
}

.migration-to-hint {
  color: var(--success-fg);
  font-weight: 600;
}

.migration-label--from {
  color: var(--danger-fg);
}

.migration-label--to {
  color: var(--success-fg);
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

.diff-card-header {
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

/* ═══════════════════════════════════════════════════════════════════════════
   TAB 4: BACKUPS
   ═══════════════════════════════════════════════════════════════════════════ */
.backup-create {
  margin-bottom: 24px;
}

.backup-guidance {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 6px 0 0;
}

.backup-guidance code {
  font-family: var(--font-mono);
  background: var(--neutral-subtle);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
}

.backup-batch {
  margin-top: 8px;
}

.backup-form {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.backup-form .form-input {
  flex: 1;
}

.backup-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.backup-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  transition: border-color var(--transition-fast);
}

.backup-item:hover {
  border-color: var(--border-default);
}

.backup-emoji {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.backup-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.backup-name {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.backup-meta {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.backup-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.btn-danger-subtle {
  color: var(--danger-fg);
  background: none;
  border: 1px solid transparent;
}
.btn-danger-subtle:hover {
  background: var(--danger-subtle);
  border-color: var(--danger-muted);
}
.btn-danger {
  color: #fff;
  background: var(--danger-fg);
  border: 1px solid var(--danger-fg);
  font-weight: 600;
}
.btn-danger:hover {
  filter: brightness(1.1);
}

/* ── Section Heading ─────────────────────────────────────────────────────── */
.section-heading {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

/* ── Empty States ────────────────────────────────────────────────────────── */
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

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.btn:hover:not(:disabled) {
  background: var(--canvas-default);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent-emphasis);
  color: var(--text-inverse);
  border-color: var(--accent-emphasis);
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
  background: var(--accent-emphasis);
}

.btn-sm {
  padding: 5px 12px;
  font-size: 0.8125rem;
}

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .agent-grid {
    grid-template-columns: 1fr;
  }

  .diff-side-by-side {
    grid-template-columns: 1fr;
  }

  .batch-actions {
    flex-wrap: wrap;
  }
}
</style>
