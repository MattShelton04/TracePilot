<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { useLauncherStore } from '@/stores/launcher';
import {
  FormInput,
  FormSwitch,
  SectionPanel,
  ActionButton,
  Badge,
  ErrorAlert,
} from '@tracepilot/ui';
import StubBanner from '@/components/StubBanner.vue';
import type { LaunchConfig, SessionTemplate } from '@tracepilot/types';

const store = useLauncherStore();

// ── Form state ──────────────────────────────────────────────────────
const repoPath = ref('');
const branch = ref('');
const selectedModel = ref('');
const createWorktree = ref(false);
const autoApprove = ref(false);
const headless = ref(false);
const reasoningEffort = ref<'low' | 'medium' | 'high'>('medium');
const prompt = ref('');
const customInstructions = ref('');

const selectedTemplateId = ref('');
const launchSuccess = ref<{ pid: number } | null>(null);

// ── Save-template inline form ───────────────────────────────────────
const showTemplateForm = ref(false);
const templateForm = reactive({
  name: '',
  description: '',
  category: '',
  tags: '',
});

// ── Derived ─────────────────────────────────────────────────────────
const selectedModelInfo = computed(() =>
  store.models.find((m) => m.id === selectedModel.value),
);

const launchConfig = computed<LaunchConfig>(() => ({
  repoPath: repoPath.value,
  branch: branch.value || undefined,
  model: selectedModel.value || undefined,
  prompt: prompt.value || undefined,
  customInstructions: customInstructions.value || undefined,
  reasoningEffort: reasoningEffort.value,
  headless: headless.value,
  createWorktree: createWorktree.value,
  autoApprove: autoApprove.value,
  envVars: {},
}));

const estimatedCommand = computed(() => {
  const parts = ['copilot-cli'];
  if (launchConfig.value.repoPath) {
    parts.push(`--repo "${launchConfig.value.repoPath}"`);
  }
  if (launchConfig.value.branch) {
    parts.push(`--branch ${launchConfig.value.branch}`);
  }
  if (launchConfig.value.model) {
    parts.push(`--model ${launchConfig.value.model}`);
  }
  if (launchConfig.value.headless) parts.push('--headless');
  if (launchConfig.value.createWorktree) parts.push('--worktree');
  if (launchConfig.value.autoApprove) parts.push('--auto-approve');
  if (launchConfig.value.reasoningEffort && launchConfig.value.reasoningEffort !== 'medium') {
    parts.push(`--reasoning-effort ${launchConfig.value.reasoningEffort}`);
  }
  if (launchConfig.value.prompt) parts.push(`"${launchConfig.value.prompt}"`);
  return parts.join(' ');
});

const canLaunch = computed(() => repoPath.value.trim().length > 0 && !store.loading);

// ── Actions ─────────────────────────────────────────────────────────
function applyTemplate(templateId: string) {
  const tpl = store.templates.find((t: SessionTemplate) => t.id === templateId);
  if (!tpl) return;
  repoPath.value = tpl.config.repoPath;
  branch.value = tpl.config.branch ?? '';
  selectedModel.value = tpl.config.model ?? '';
  createWorktree.value = tpl.config.createWorktree;
  autoApprove.value = tpl.config.autoApprove;
  headless.value = tpl.config.headless;
  reasoningEffort.value = (tpl.config.reasoningEffort as 'low' | 'medium' | 'high') ?? 'medium';
  prompt.value = tpl.config.prompt ?? '';
  customInstructions.value = tpl.config.customInstructions ?? '';
}

async function handleLaunch() {
  launchSuccess.value = null;
  const session = await store.launch(launchConfig.value);
  if (session) {
    launchSuccess.value = { pid: session.pid };
    setTimeout(() => (launchSuccess.value = null), 5000);
  }
}

async function handleSaveTemplate() {
  await store.saveTemplate({
    id: crypto.randomUUID(),
    name: templateForm.name,
    description: templateForm.description,
    category: templateForm.category,
    tags: templateForm.tags
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean),
    config: launchConfig.value,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  });
  showTemplateForm.value = false;
  templateForm.name = '';
  templateForm.description = '';
  templateForm.category = '';
  templateForm.tags = '';
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// ── Lifecycle ───────────────────────────────────────────────────────
onMounted(() => store.initialize());
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner launcher-root">
      <StubBanner />

      <!-- Warning banner when system deps missing -->
      <div v-if="!store.isReady && !store.loading" class="readiness-banner">
        <ErrorAlert>
          System dependencies missing — ensure <strong>git</strong> and
          <strong>GitHub Copilot CLI</strong> are installed and on your PATH.
        </ErrorAlert>
      </div>

      <!-- Success toast -->
      <Transition name="toast">
        <div v-if="launchSuccess" class="toast-success">
          ✓ Session launched — PID <strong>{{ launchSuccess.pid }}</strong>
        </div>
      </Transition>

      <div class="split-panel">
        <!-- ═══════════════════ LEFT: Config Form ═══════════════════ -->
        <div class="panel-left">
          <header class="page-header">
            <div class="page-header-row">
              <h1 class="page-title">Session Launcher</h1>
              <span
                class="readiness-dot"
                :class="store.isReady ? 'ready' : 'not-ready'"
                :title="store.isReady ? 'System ready' : 'Dependencies missing'"
              />
            </div>
            <p class="page-subtitle">Configure and launch a Copilot coding session</p>
          </header>

          <!-- Store error -->
          <ErrorAlert v-if="store.error" style="margin-bottom: 16px">
            {{ store.error }}
          </ErrorAlert>

          <!-- Template selector -->
          <SectionPanel title="Template">
            <div class="form-group">
              <label class="form-label">Load from template</label>
              <select
                v-model="selectedTemplateId"
                class="form-select"
                @change="applyTemplate(selectedTemplateId)"
              >
                <option value="">— None —</option>
                <option
                  v-for="tpl in store.templates"
                  :key="tpl.id"
                  :value="tpl.id"
                >
                  {{ tpl.name }}
                </option>
              </select>
            </div>
          </SectionPanel>

          <!-- Repository -->
          <SectionPanel title="Repository">
            <div class="form-group">
              <label class="form-label">Repository path <span class="required">*</span></label>
              <FormInput
                v-model="repoPath"
                placeholder="/path/to/your/repo"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Branch</label>
              <FormInput
                v-model="branch"
                placeholder="main (optional)"
              />
            </div>
          </SectionPanel>

          <!-- Model -->
          <SectionPanel title="Model">
            <div class="form-group">
              <label class="form-label">Model</label>
              <select v-model="selectedModel" class="form-select">
                <option value="">— Default —</option>
                <optgroup
                  v-for="(group, tier) in store.modelsByTier"
                  :key="tier"
                  :label="tierLabel(String(tier))"
                >
                  <option
                    v-for="m in group"
                    :key="m.id"
                    :value="m.id"
                  >
                    {{ m.name }}
                  </option>
                </optgroup>
              </select>
            </div>
          </SectionPanel>

          <!-- Options -->
          <SectionPanel title="Options">
            <div class="option-row">
              <div class="option-info">
                <span class="option-label">Create worktree</span>
                <span class="option-desc">Launch in an isolated git worktree</span>
              </div>
              <FormSwitch v-model="createWorktree" />
            </div>

            <div class="option-row">
              <div class="option-info">
                <span class="option-label">Auto-approve</span>
                <span class="option-desc">Skip confirmation prompts for actions</span>
              </div>
              <FormSwitch v-model="autoApprove" />
            </div>

            <div class="option-row">
              <div class="option-info">
                <span class="option-label">Headless</span>
                <span class="option-desc">Run without interactive terminal UI</span>
              </div>
              <FormSwitch v-model="headless" />
            </div>

            <div class="form-group" style="margin-top: 12px">
              <label class="form-label">Reasoning effort</label>
              <select v-model="reasoningEffort" class="form-select">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </SectionPanel>

          <!-- Prompt & Instructions -->
          <SectionPanel title="Prompt">
            <div class="form-group">
              <label class="form-label">Initial prompt</label>
              <textarea
                v-model="prompt"
                class="form-textarea"
                rows="3"
                placeholder="Describe what the session should work on…"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Custom instructions</label>
              <textarea
                v-model="customInstructions"
                class="form-textarea"
                rows="3"
                placeholder="Additional context or constraints…"
              />
            </div>
          </SectionPanel>

          <!-- Action buttons -->
          <div class="action-bar">
            <ActionButton
              size="md"
              class="btn btn-primary btn-launch"
              :disabled="!canLaunch"
              @click="handleLaunch"
            >
              {{ store.loading ? 'Launching…' : 'Launch Session' }}
            </ActionButton>

            <button
              class="btn btn-secondary"
              :disabled="!repoPath.trim()"
              @click="showTemplateForm = !showTemplateForm"
            >
              {{ showTemplateForm ? 'Cancel' : 'Save as Template' }}
            </button>
          </div>

          <!-- Inline template save form -->
          <Transition name="slide">
            <SectionPanel v-if="showTemplateForm" title="Save Template" class="template-save-panel">
              <div class="form-group">
                <label class="form-label">Name <span class="required">*</span></label>
                <FormInput v-model="templateForm.name" placeholder="My launch template" />
              </div>
              <div class="form-group">
                <label class="form-label">Description</label>
                <FormInput v-model="templateForm.description" placeholder="Quick description" />
              </div>
              <div class="form-row-2col">
                <div class="form-group">
                  <label class="form-label">Category</label>
                  <FormInput v-model="templateForm.category" placeholder="e.g. frontend" />
                </div>
                <div class="form-group">
                  <label class="form-label">Tags</label>
                  <FormInput v-model="templateForm.tags" placeholder="tag1, tag2" />
                </div>
              </div>
              <ActionButton
                size="sm"
                class="btn btn-primary"
                :disabled="!templateForm.name.trim()"
                @click="handleSaveTemplate"
              >
                Save Template
              </ActionButton>
            </SectionPanel>
          </Transition>
        </div>

        <!-- ═══════════════════ RIGHT: Live Preview ═══════════════════ -->
        <aside class="panel-right">
          <div class="preview-sticky">
            <!-- Preview Card -->
            <SectionPanel title="Launch Preview">
              <div class="preview-section">
                <div class="preview-row">
                  <span class="preview-label">Repository</span>
                  <span class="preview-value" :class="{ placeholder: !repoPath }">
                    {{ repoPath || 'Not set' }}
                  </span>
                </div>

                <div class="preview-row">
                  <span class="preview-label">Branch</span>
                  <span class="preview-value" :class="{ placeholder: !branch }">
                    {{ branch || 'default' }}
                  </span>
                </div>

                <div class="preview-row">
                  <span class="preview-label">Model</span>
                  <span class="preview-value model-value">
                    <template v-if="selectedModelInfo">
                      {{ selectedModelInfo.name }}
                      <Badge :variant="selectedModelInfo.tier === 'premium' ? 'warning' : selectedModelInfo.tier === 'fast' ? 'accent' : 'default'">
                        {{ tierLabel(selectedModelInfo.tier) }}
                      </Badge>
                    </template>
                    <span v-else class="placeholder">Default</span>
                  </span>
                </div>

                <div class="preview-row">
                  <span class="preview-label">Options</span>
                  <span class="preview-value options-list">
                    <span v-if="createWorktree" class="option-tag">Worktree</span>
                    <span v-if="autoApprove" class="option-tag">Auto-approve</span>
                    <span v-if="headless" class="option-tag">Headless</span>
                    <span
                      v-if="!createWorktree && !autoApprove && !headless"
                      class="placeholder"
                    >
                      None
                    </span>
                  </span>
                </div>

                <div class="preview-row">
                  <span class="preview-label">Reasoning</span>
                  <span class="preview-value">{{ tierLabel(reasoningEffort) }}</span>
                </div>
              </div>

              <div class="command-preview">
                <label class="form-label">Estimated command</label>
                <code class="command-block">{{ estimatedCommand }}</code>
              </div>
            </SectionPanel>

            <!-- Recent launches -->
            <SectionPanel title="Recent Launches" class="recent-panel">
              <div v-if="store.recentLaunches.length === 0" class="recent-empty">
                No sessions launched yet
              </div>
              <ul v-else class="recent-list">
                <li
                  v-for="session in store.recentLaunches.slice(0, 5)"
                  :key="session.pid"
                  class="recent-item"
                >
                  <div class="recent-item-header">
                    <Badge variant="default">PID {{ session.pid }}</Badge>
                    <span class="recent-time">{{ formatTimestamp(session.launchedAt) }}</span>
                  </div>
                  <code class="recent-command">{{ session.command }}</code>
                </li>
              </ul>
            </SectionPanel>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Layout ──────────────────────────────────────────────────────── */
.launcher-root {
  max-width: 1200px;
}

.split-panel {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 28px;
  align-items: start;
}

.panel-left {
  min-width: 0;
}

.panel-right {
  min-width: 0;
}

.preview-sticky {
  position: sticky;
  top: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Page header ─────────────────────────────────────────────────── */
.page-header {
  margin-bottom: 20px;
}

.page-header-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.page-subtitle {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 4px 0 0;
}

.readiness-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.readiness-dot.ready {
  background: var(--success-fg, #3fb950);
  box-shadow: 0 0 6px var(--success-fg, #3fb950);
}

.readiness-dot.not-ready {
  background: var(--danger-fg, #f85149);
  box-shadow: 0 0 6px var(--danger-fg, #f85149);
}

/* ── Readiness banner ────────────────────────────────────────────── */
.readiness-banner {
  margin-bottom: 16px;
}

/* ── Form elements ───────────────────────────────────────────────── */
.form-group {
  margin-bottom: 14px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 5px;
}

.required {
  color: var(--danger-fg, #f85149);
}

.form-select {
  width: 100%;
  padding: 7px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23848d97' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.form-select:focus {
  outline: none;
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-emphasis) 25%, transparent);
}

.form-textarea {
  width: 100%;
  padding: 8px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  resize: vertical;
  min-height: 60px;
  transition: border-color 0.15s ease;
}

.form-textarea:focus {
  outline: none;
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-emphasis) 25%, transparent);
}

/* ── Options rows ────────────────────────────────────────────────── */
.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-muted);
}

.option-row:last-of-type {
  border-bottom: none;
}

.option-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}

.option-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

/* ── Action bar ──────────────────────────────────────────────────── */
.action-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
  margin-bottom: 16px;
}

.btn-launch {
  padding: 10px 28px;
  font-size: 0.875rem;
  font-weight: 600;
}

.btn-secondary {
  padding: 8px 16px;
  font-size: 0.8125rem;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.btn-secondary:hover:not(:disabled) {
  background: var(--canvas-inset);
  color: var(--text-primary);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Template save panel ─────────────────────────────────────────── */
.template-save-panel {
  margin-bottom: 16px;
}

.form-row-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* ── Preview panel ───────────────────────────────────────────────── */
.preview-section {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-muted);
  gap: 12px;
}

.preview-row:last-child {
  border-bottom: none;
}

.preview-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
  padding-top: 1px;
}

.preview-value {
  font-size: 0.8125rem;
  color: var(--text-primary);
  text-align: right;
  word-break: break-all;
}

.preview-value.placeholder {
  color: var(--text-tertiary);
  font-style: italic;
}

.model-value {
  display: flex;
  align-items: center;
  gap: 6px;
}

.options-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}

.option-tag {
  display: inline-block;
  padding: 2px 8px;
  font-size: 0.6875rem;
  font-weight: 500;
  border-radius: 4px;
  background: var(--accent-subtle, color-mix(in srgb, var(--accent-emphasis) 12%, transparent));
  color: var(--accent-fg);
}

/* ── Command preview ─────────────────────────────────────────────── */
.command-preview {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border-muted);
}

.command-block {
  display: block;
  padding: 10px 12px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: 6px;
  font-size: 0.75rem;
  font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
  color: var(--text-secondary);
  word-break: break-all;
  white-space: pre-wrap;
  line-height: 1.5;
}

/* ── Recent launches ─────────────────────────────────────────────── */
.recent-panel {
  margin-top: 0;
}

.recent-empty {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  text-align: center;
  padding: 16px 0;
}

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.recent-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-muted);
}

.recent-item:last-child {
  border-bottom: none;
}

.recent-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.recent-time {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.recent-command {
  display: block;
  font-size: 0.6875rem;
  font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Toast ────────────────────────────────────────────────────────── */
.toast-success {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1000;
  padding: 10px 18px;
  background: var(--success-subtle, #0d1f0d);
  border: 1px solid var(--success-emphasis, #238636);
  border-radius: 8px;
  color: var(--success-fg, #3fb950);
  font-size: 0.8125rem;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ── Slide transition ────────────────────────────────────────────── */
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.2s ease, max-height 0.25s ease;
  overflow: hidden;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  max-height: 0;
}

.slide-enter-to,
.slide-leave-from {
  max-height: 400px;
}

/* ── Responsive ──────────────────────────────────────────────────── */
@media (max-width: 860px) {
  .split-panel {
    grid-template-columns: 1fr;
  }

  .preview-sticky {
    position: static;
  }
}
</style>
