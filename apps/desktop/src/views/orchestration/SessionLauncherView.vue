<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { useLauncherStore } from '@/stores/launcher';
import { usePreferencesStore } from '@/stores/preferences';
import { useWorktreesStore } from '@/stores/worktrees';
import { browseForDirectory } from '@/composables/useBrowseDirectory';
import type { LaunchConfig, SessionTemplate } from '@tracepilot/types';

const store = useLauncherStore();
const prefsStore = usePreferencesStore();
const worktreeStore = useWorktreesStore();
const route = useRoute();
const launching = ref(false);
let successTimer: ReturnType<typeof setTimeout> | null = null;

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
const envVars = reactive<{ key: string; value: string }[]>([]);

const selectedTemplateId = ref<string | null>(null);
const showAdvanced = ref(false);
const showTemplateForm = ref(false);
const templateForm = reactive({ name: '', description: '', category: '' });
const launchSuccess = ref<{ pid: number; command: string; worktreePath?: string } | null>(null);
const contextMenuTpl = ref<{ id: string; x: number; y: number } | null>(null);
const confirmingDeleteId = ref<string | null>(null);

// ── Derived ─────────────────────────────────────────────────────────
const selectedModelInfo = computed(() =>
  store.models.find((m) => m.id === selectedModel.value),
);

const selectedTemplateName = computed(() => {
  if (!selectedTemplateId.value) return 'Custom';
  return store.templates.find((t) => t.id === selectedTemplateId.value)?.name ?? 'Custom';
});

const envVarsRecord = computed(() => {
  const rec: Record<string, string> = {};
  for (const e of envVars) {
    if (e.key.trim()) rec[e.key.trim()] = e.value;
  }
  return rec;
});

const baseBranch = ref('');

const launchConfig = computed<LaunchConfig>(() => ({
  repoPath: repoPath.value,
  branch: branch.value || undefined,
  baseBranch: createWorktree.value && baseBranch.value ? baseBranch.value : undefined,
  model: selectedModel.value || undefined,
  prompt: prompt.value || undefined,
  customInstructions: customInstructions.value || undefined,
  reasoningEffort: reasoningEffort.value,
  headless: headless.value,
  createWorktree: createWorktree.value,
  autoApprove: autoApprove.value,
  envVars: envVarsRecord.value,
  cliCommand: prefsStore.cliCommand || 'copilot',
}));

const effectiveCli = computed(() => prefsStore.cliCommand || 'copilot');

const cliCommand = computed(() => {
  const parts = [effectiveCli.value];
  if (launchConfig.value.model) parts.push(`--model=${launchConfig.value.model}`);
  if (launchConfig.value.autoApprove) parts.push('--allow-all');
  if (launchConfig.value.prompt) {
    parts.push(`\\\n  # Prompt will be copied to clipboard`);
  }
  return parts.join(' ');
});

const cliCommandParts = computed<{ flag: string; value?: string }[]>(() => {
  const parts: { flag: string; value?: string }[] = [{ flag: effectiveCli.value }];
  if (launchConfig.value.model) {
    parts.push({ flag: '--model', value: launchConfig.value.model });
  }
  if (launchConfig.value.autoApprove) parts.push({ flag: '--allow-all' });
  if (launchConfig.value.prompt) {
    parts.push({ flag: '# prompt', value: '→ clipboard' });
  }
  return parts;
});

// Preview path for worktree creation
const worktreePreviewPath = computed(() => {
  if (!createWorktree.value || !repoPath.value || !branch.value) return '';
  const repoName = repoPath.value.replace(/\\/g, '/').split('/').pop() || '';
  const sanitized = branch.value.replace(/[~^:?*[\]\\<>|]/g, '-').replace(/\.\./g, '-').replace(/\/+/g, '-');
  const parent = repoPath.value.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
  return `${parent}/${repoName}-${sanitized}`.replace(/\//g, '\\');
});

const estimatedCost = computed(() => {
  const modelId = selectedModel.value || 'claude-sonnet-4.6';
  const pr = prefsStore.getPremiumRequests(modelId);
  const cost = pr * prefsStore.costPerPremiumRequest;
  if (pr === 0) return 'Free';
  return `~$${cost.toFixed(2)} (${pr}x premium requests)`;
});

const canLaunch= computed(() => {
  if (!repoPath.value.trim() || store.loading) return false;
  if (createWorktree.value && !branch.value.trim()) return false;
  return true;
});

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function extractEmoji(name: string): string {
  const match = name.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
  return match ? match[0] : '📄';
}

function templateDisplayName(name: string): string {
  return name.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u, '');
}

// ── Actions ─────────────────────────────────────────────────────────
function applyTemplate(tplId: string) {
  if (selectedTemplateId.value === tplId) {
    selectedTemplateId.value = null;
    return;
  }
  const tpl = store.templates.find((t: SessionTemplate) => t.id === tplId);
  if (!tpl) return;
  selectedTemplateId.value = tplId;
  repoPath.value = tpl.config.repoPath;
  branch.value = tpl.config.branch ?? '';
  selectedModel.value = tpl.config.model ?? '';
  createWorktree.value = tpl.config.createWorktree;
  baseBranch.value = tpl.config.baseBranch ?? '';
  autoApprove.value = tpl.config.autoApprove;
  headless.value = tpl.config.headless;
  reasoningEffort.value = (tpl.config.reasoningEffort as 'low' | 'medium' | 'high') ?? 'medium';
  prompt.value = tpl.config.prompt ?? '';
  customInstructions.value = tpl.config.customInstructions ?? '';
  envVars.length = 0;
  if (tpl.config.envVars) {
    for (const [k, v] of Object.entries(tpl.config.envVars)) {
      envVars.push({ key: k, value: v });
    }
  }
}

function clearTemplateSelection() {
  selectedTemplateId.value = null;
}

function moveTemplate(idx: number, direction: 'up' | 'down') {
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= store.templates.length) return;
  const arr = [...store.templates];
  [arr[idx], arr[target]] = [arr[target], arr[idx]];
  store.templates = arr;
}

async function deleteTemplateInline(tplId: string) {
  if (confirmingDeleteId.value === tplId) {
    await store.deleteTemplate(tplId);
    if (selectedTemplateId.value === tplId) selectedTemplateId.value = null;
    confirmingDeleteId.value = null;
  } else {
    confirmingDeleteId.value = tplId;
  }
}

function cancelDeleteInline() {
  confirmingDeleteId.value = null;
}

function selectRecentRepo(event: Event) {
  const val = (event.target as HTMLSelectElement).value;
  if (val) {
    repoPath.value = val;
    clearTemplateSelection();
  }
}

async function handleBrowseRepo() {
  const dir = await browseForDirectory({ title: 'Select repository directory' });
  if (dir) {
    repoPath.value = dir;
    clearTemplateSelection();
  }
}

function addEnvVar(){
  envVars.push({ key: '', value: '' });
}

function removeEnvVar(idx: number) {
  envVars.splice(idx, 1);
}

async function handleLaunch(asHeadless = false) {
  if (!canLaunch.value || launching.value) return;
  launching.value = true;
  store.error = null;
  const cfg = { ...launchConfig.value };
  if (asHeadless) cfg.headless = true;
  if (successTimer) clearTimeout(successTimer);
  launchSuccess.value = null;
  try {
    if (cfg.repoPath) prefsStore.addRecentRepoPath(cfg.repoPath);
    const session = await store.launch(cfg);
    if (session) {
      launchSuccess.value = {
        pid: session.pid,
        command: session.command,
        worktreePath: session.worktreePath,
      };
      successTimer = setTimeout(() => (launchSuccess.value = null), 8000);
    } else if (store.error) {
      // Scroll the error banner into view
      nextTick(() => {
        document.querySelector('.error-banner')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  } finally {
    launching.value = false;
  }
}

async function handleSaveTemplate() {
  if (!templateForm.name.trim()) return;
  const existing = store.templates.find(
    (t) => t.name.toLowerCase() === templateForm.name.trim().toLowerCase(),
  );
  if (existing && !confirm(`Template '${existing.name}' already exists. Overwrite?`)) {
    return;
  }
  await store.saveTemplate({
    id: existing?.id ?? crypto.randomUUID(),
    name: templateForm.name,
    description: templateForm.description,
    category: templateForm.category,
    tags: [],
    config: launchConfig.value,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    usageCount: existing?.usageCount ?? 0,
  });
  showTemplateForm.value = false;
  templateForm.name = '';
  templateForm.description = '';
  templateForm.category = '';
}

function openContextMenu(e: MouseEvent, tplId: string) {
  e.preventDefault();
  contextMenuTpl.value = { id: tplId, x: e.clientX, y: e.clientY };
}

async function deleteContextTemplate() {
  if (!contextMenuTpl.value) return;
  await store.deleteTemplate(contextMenuTpl.value.id);
  if (selectedTemplateId.value === contextMenuTpl.value.id) {
    selectedTemplateId.value = null;
  }
  contextMenuTpl.value = null;
}

function closeContextMenu() {
  contextMenuTpl.value = null;
}

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(cliCommand.value);
  } catch { /* clipboard not available in some envs */ }
}

onMounted(async () => {
  store.initialize();
  document.addEventListener('click', closeContextMenu);

  // Load registered repos for the dropdown
  if (worktreeStore.registeredRepos.length === 0) {
    await worktreeStore.loadRegisteredRepos();
  }

  // Pre-fill from query params (e.g., navigated from Worktree Manager)
  if (route.query.repoPath) {
    repoPath.value = String(route.query.repoPath);
  }
  if (route.query.branch) {
    branch.value = String(route.query.branch);
  }
  if (route.query.createWorktree === 'true') {
    createWorktree.value = true;
    showAdvanced.value = true;
  }
});

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu);
  if (successTimer) clearTimeout(successTimer);
});
</script>

<template>
  <div class="launcher-shell" @click="closeContextMenu">
    <!-- Success toast -->
    <Transition name="toast">
      <div v-if="launchSuccess" class="toast-success">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="toast-icon">
          <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z"/>
        </svg>
        <div>
          <strong>Session launched</strong> — PID {{ launchSuccess.pid }}
          <div class="toast-cmd">{{ launchSuccess.command }}</div>
          <div v-if="launchSuccess.worktreePath" class="toast-cmd" style="margin-top: 4px; color: var(--success-fg);">
            📂 Worktree: {{ launchSuccess.worktreePath }}
          </div>
        </div>
      </div>
    </Transition>

    <!-- Context menu for template deletion -->
    <Teleport to="body">
      <div
        v-if="contextMenuTpl"
        class="ctx-menu"
        :style="{ left: contextMenuTpl.x + 'px', top: contextMenuTpl.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item ctx-danger" @click="deleteContextTemplate">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM4.997 6.178a.75.75 0 1 0-1.493.144l.684 7.084A1.75 1.75 0 0 0 5.926 15h4.148a1.75 1.75 0 0 0 1.738-1.594l.684-7.084a.75.75 0 1 0-1.493-.144L10.32 13.26a.25.25 0 0 1-.249.24H5.926a.25.25 0 0 1-.248-.227L4.997 6.178Z"/></svg>
          Delete Template
        </button>
      </div>
    </Teleport>

    <div class="split-layout">
      <!-- ═══════════════════ LEFT PANEL ═══════════════════ -->
      <main class="panel-left">
        <!-- Title -->
        <header class="page-header">
          <h1 class="page-title">Launch Session</h1>
          <p class="page-subtitle">Configure and launch a new Copilot CLI session</p>
        </header>

        <!-- Readiness banner -->
        <div v-if="!store.isReady && !store.loading" class="readiness-banner">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="readiness-icon">
            <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"/>
          </svg>
          <span>
            System not ready —
            <template v-if="store.systemDeps">
              <strong v-if="!store.systemDeps.gitAvailable">git</strong>
              <template v-if="!store.systemDeps.gitAvailable && !store.systemDeps.copilotAvailable"> and </template>
              <strong v-if="!store.systemDeps.copilotAvailable">GitHub Copilot CLI</strong>
              not found on PATH.
            </template>
            <template v-else>ensure <strong>git</strong> and <strong>GitHub Copilot CLI</strong> are installed.</template>
          </span>
        </div>

        <!-- Error -->
        <div v-if="store.error" class="error-banner">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2.343 13.657A8 8 0 1 1 13.66 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"/></svg>
          <span class="error-text">{{ store.error }}</span>
          <button class="error-dismiss" @click="store.error = null" title="Dismiss">✕</button>
        </div>

        <!-- ── Templates ─────────────────────────────────────── -->
        <section v-if="store.loading || store.templates.length" class="section-block">
          <h2 class="section-label">Saved Templates</h2>
          <div v-if="store.loading && !store.templates.length" class="tpl-grid">
            <div v-for="n in 3" :key="n" class="tpl-card tpl-skeleton">
              <span class="tpl-emoji">⏳</span>
              <span class="tpl-name skeleton-text">&nbsp;</span>
              <span class="tpl-desc skeleton-text">&nbsp;</span>
            </div>
          </div>
          <div v-else class="tpl-grid">
            <button
              v-for="(tpl, idx) in store.templates"
              :key="tpl.id"
              class="tpl-card"
              :class="{ selected: selectedTemplateId === tpl.id }"
              @click="applyTemplate(tpl.id)"
              @contextmenu="openContextMenu($event, tpl.id)"
            >
              <div class="tpl-card-actions" @click.stop>
                <button
                  class="tpl-action-btn tpl-move-btn"
                  :disabled="idx === 0"
                  title="Move up"
                  @click="moveTemplate(idx, 'up')"
                >▲</button>
                <button
                  class="tpl-action-btn tpl-move-btn"
                  :disabled="idx === store.templates.length - 1"
                  title="Move down"
                  @click="moveTemplate(idx, 'down')"
                >▼</button>
                <button
                  class="tpl-action-btn tpl-delete-btn"
                  title="Delete template"
                  @click="deleteTemplateInline(tpl.id)"
                >×</button>
              </div>
              <template v-if="confirmingDeleteId === tpl.id">
                <div class="tpl-confirm-delete" @click.stop>
                  <span>Delete?</span>
                  <button class="tpl-confirm-yes" @click="deleteTemplateInline(tpl.id)">Yes</button>
                  <button class="tpl-confirm-cancel" @click="cancelDeleteInline">Cancel</button>
                </div>
              </template>
              <span class="tpl-emoji">{{ extractEmoji(tpl.name) }}</span>
              <span class="tpl-name">{{ templateDisplayName(tpl.name) }}</span>
              <span v-if="tpl.description" class="tpl-desc">{{ tpl.description }}</span>
              <span class="tpl-stats">Used {{ tpl.usageCount }} times</span>
            </button>
          </div>
        </section>

        <!-- ── Configuration ─────────────────────────────────── -->
        <section class="section-block">
          <h2 class="section-label">Configuration</h2>
          <div class="section-panel">
            <div class="form-grid-2col">
              <div class="form-group">
                <label class="form-label">Repository <span class="required">*</span></label>
                <div class="repo-picker">
                  <select
                    v-if="worktreeStore.registeredRepos.length || prefsStore.recentRepoPaths.length"
                    class="form-input form-select repo-recent"
                    @change="selectRecentRepo"
                  >
                    <option value="">Select a repository…</option>
                    <optgroup v-if="worktreeStore.registeredRepos.length" label="Registered Repositories">
                      <option v-for="r in worktreeStore.registeredRepos" :key="r.path" :value="r.path">{{ r.name }} — {{ r.path }}</option>
                    </optgroup>
                    <optgroup v-if="prefsStore.recentRepoPaths.length" label="Recent">
                      <option v-for="p in prefsStore.recentRepoPaths" :key="p" :value="p">{{ p }}</option>
                    </optgroup>
                  </select>
                  <div class="repo-input-row">
                    <input
                      v-model="repoPath"
                      type="text"
                      class="form-input"
                      placeholder="C:\git\MyProject"
                      required
                      @input="clearTemplateSelection"
                    />
                    <button class="btn btn-secondary repo-browse-btn" type="button" @click="handleBrowseRepo">Browse</button>
                  </div>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Branch</label>
                <input
                  v-model="branch"
                  type="text"
                  class="form-input"
                  :placeholder="createWorktree ? 'feature/my-branch (required)' : 'Leave blank to stay on current branch'"
                  @input="clearTemplateSelection"
                />
                <span class="form-hint">{{ createWorktree ? 'New branch to create with the worktree' : 'Optional — checks out or creates this branch before starting' }}</span>
              </div>
              <div class="form-group">
                <label class="form-label">Model</label>
                <select v-model="selectedModel" class="form-input form-select" @change="clearTemplateSelection">
                  <option value="">— Default —</option>
                  <optgroup
                    v-for="(group, tier) in store.modelsByTier"
                    :key="tier"
                    :label="tierLabel(String(tier))"
                  >
                    <option v-for="m in group" :key="m.id" :value="m.id">{{ m.name }}</option>
                  </optgroup>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Reasoning Effort</label>
                <div class="btn-group">
                  <button
                    v-for="level in (['low', 'medium', 'high'] as const)"
                    :key="level"
                    class="btn-group-item"
                    :class="{ active: reasoningEffort === level }"
                    @click="reasoningEffort = level; clearTemplateSelection()"
                  >{{ tierLabel(level) }}</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Initial Prompt ────────────────────────────────── -->
        <section class="section-block">
          <h2 class="section-label">Initial Prompt</h2>
          <div class="section-panel">
            <textarea
              v-model="prompt"
              class="form-input form-textarea"
              rows="4"
              placeholder="Describe the task…"
              @input="clearTemplateSelection"
            />
            <span class="form-hint">Prompt will be copied to your clipboard when the session launches — paste it with Ctrl+V</span>
          </div>
        </section>

        <!-- ── Advanced Options ──────────────────────────────── -->
        <section class="section-block">
          <button class="advanced-trigger" @click="showAdvanced = !showAdvanced">
            <span class="advanced-arrow" :class="{ open: showAdvanced }">▶</span>
            Advanced Options
          </button>
          <Transition name="slide">
            <div v-if="showAdvanced" class="section-panel adv-panel">
              <!-- Toggle rows -->
              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Auto-approve</span>
                  <span class="toggle-desc">Skip confirmation prompts for file changes</span>
                </div>
                <button
                  class="toggle-switch"
                  :class="{ on: autoApprove }"
                  role="switch"
                  :aria-checked="autoApprove"
                  @click="autoApprove = !autoApprove"
                >
                  <span class="toggle-thumb" />
                </button>
              </div>
              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Create Worktree</span>
                  <span class="toggle-desc">Create a new git worktree and launch the session inside it</span>
                </div>
                <button
                  class="toggle-switch"
                  :class="{ on: createWorktree }"
                  role="switch"
                  :aria-checked="createWorktree"
                  @click="createWorktree = !createWorktree; clearTemplateSelection()"
                >
                  <span class="toggle-thumb" />
                </button>
              </div>
              <Transition name="slide">
                <div v-if="createWorktree" class="worktree-options">
                  <div class="form-group" style="margin: 8px 0 0 0">
                    <label class="form-label">Base Branch</label>
                    <input
                      v-model="baseBranch"
                      type="text"
                      class="form-input"
                      placeholder="main (defaults to current HEAD)"
                    />
                    <span class="form-hint">The branch to base the new worktree on. A new branch matching the session branch will be created from this base.</span>
                  </div>
                  <div v-if="!branch" class="worktree-warning">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"/></svg>
                    <span>A branch name is required when creating a worktree. Enter one in the Branch field above.</span>
                  </div>
                  <div v-if="worktreePreviewPath" class="worktree-path-preview">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    <span class="wt-preview-label">Worktree folder:</span>
                    <code class="wt-preview-path">{{ worktreePreviewPath }}</code>
                  </div>
                </div>
              </Transition>
              <div class="toggle-row toggle-row-last toggle-disabled" title="Coming Soon…">
                <div class="toggle-info">
                  <span class="toggle-label">Headless Mode</span>
                  <span class="toggle-desc">Coming Soon…</span>
                </div>
                <button
                  class="toggle-switch"
                  role="switch"
                  :aria-checked="false"
                  disabled
                  title="Coming Soon…"
                >
                  <span class="toggle-thumb" />
                </button>
              </div>

              <!-- Custom instructions -->
              <div class="form-group" style="margin-top: 14px">
                <label class="form-label">Custom Instructions Path</label>
                <input
                  v-model="customInstructions"
                  type="text"
                  class="form-input form-mono"
                  placeholder=".github/copilot-instructions.md"
                />
              </div>

              <!-- Environment variables -->
              <div class="form-group" style="margin-top: 14px">
                <label class="form-label">Environment Variables</label>
                <div v-for="(ev, idx) in envVars" :key="idx" class="env-row">
                  <input v-model="ev.key" type="text" class="form-input form-mono env-key" placeholder="KEY" />
                  <input v-model="ev.value" type="text" class="form-input form-mono env-val" placeholder="value" />
                  <button class="env-remove" @click="removeEnvVar(idx)" title="Remove variable">✕</button>
                </div>
                <button class="btn-add-var" @click="addEnvVar">+ Add Variable</button>
              </div>
            </div>
          </Transition>
        </section>

        <!-- ── Template Save ─────────────────────────────────── -->
        <section class="section-block">
          <label class="tpl-save-toggle">
            <input type="checkbox" v-model="showTemplateForm" class="tpl-save-checkbox" />
            <span>💾 Save as Template</span>
          </label>
          <Transition name="slide">
            <div v-if="showTemplateForm" class="section-panel tpl-save-form">
              <div class="form-grid-2col">
                <div class="form-group">
                  <label class="form-label">Template Name <span class="required">*</span></label>
                  <input v-model="templateForm.name" type="text" class="form-input" placeholder="🚀 My Template" />
                </div>
                <div class="form-group">
                  <label class="form-label">Category</label>
                  <input v-model="templateForm.category" type="text" class="form-input" placeholder="e.g. frontend" />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Description</label>
                <input v-model="templateForm.description" type="text" class="form-input" placeholder="Quick description of this template" />
              </div>
              <button
                class="btn btn-primary"
                style="margin-top: 10px"
                :disabled="!templateForm.name.trim()"
                @click="handleSaveTemplate"
              >Save Template</button>
              <p class="form-hint" style="margin-top: 6px">If a template with the same name exists, you'll be prompted to overwrite it.</p>
            </div>
          </Transition>
        </section>
      </main>

      <!-- ═══════════════════ RIGHT PANEL ═══════════════════ -->
      <aside class="panel-right">
        <div class="preview-inner">
          <!-- Header -->
          <div class="preview-header">Live Preview</div>

          <!-- Body -->
          <div class="preview-body">
            <!-- Metadata grid -->
            <div class="meta-grid">
              <div class="meta-card">
                <span class="meta-label">Est. Cost</span>
                <span class="meta-value accent">{{ estimatedCost }}</span>
              </div>
              <div class="meta-card">
                <span class="meta-label">Model Tier</span>
                <span class="meta-value">{{ selectedModelInfo ? tierLabel(selectedModelInfo.tier) : 'Default' }}</span>
              </div>
              <div class="meta-card">
                <span class="meta-label">Active Sessions</span>
                <span class="meta-value success">{{ store.recentLaunches.length }}</span>
              </div>
              <div class="meta-card">
                <span class="meta-label">Template</span>
                <span class="meta-value">{{ selectedTemplateName }}</span>
              </div>
            </div>

            <!-- Config summary -->
            <div class="config-summary">
              <div class="config-row">
                <span class="config-key">Template</span>
                <span class="config-val">{{ selectedTemplateName }}</span>
              </div>
              <div class="config-row">
                <span class="config-key">Repository</span>
                <span class="config-val">{{ repoPath || '—' }}</span>
              </div>
              <div class="config-row">
                <span class="config-key">Branch</span>
                <span class="config-val">{{ branch || 'default' }}</span>
              </div>
              <div class="config-row">
                <span class="config-key">Model</span>
                <span class="config-val">{{ selectedModelInfo?.name ?? 'Default' }}</span>
              </div>
              <div class="config-row">
                <span class="config-key">Reasoning</span>
                <span class="config-val">{{ tierLabel(reasoningEffort) }}</span>
              </div>
              <div class="config-row">
                <span class="config-key">Auto-approve</span>
                <span class="config-val">{{ autoApprove ? '✅' : '❌' }}</span>
              </div>
              <div class="config-row">
                <span class="config-key">Worktree</span>
                <span class="config-val">{{ createWorktree ? '✅' : '❌' }}</span>
              </div>
              <div class="config-row">
                <span class="config-key">Headless</span>
                <span class="config-val">{{ headless ? '✅' : '❌' }}</span>
              </div>
              <div class="config-row" v-if="prompt">
                <span class="config-key">Prompt</span>
                <span class="config-val">{{ truncate(prompt, 40) }} <span style="opacity:0.6; font-size: 0.7rem">(📋 clipboard)</span></span>
              </div>
            </div>

            <!-- Divider -->
            <div class="preview-divider" />

            <!-- CLI command -->
            <div class="cmd-section">
              <div class="cmd-header">
                <span class="cmd-title">Command Preview</span>
                <button class="cmd-copy" @click="copyCommand">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
                  Copy
                </button>
              </div>
              <pre class="cmd-block"><code><template v-for="(part, i) in cliCommandParts" :key="i">{{ i > 0 ? ' \\\n  ' : '' }}<span class="cmd-flag">{{ part.flag }}</span><template v-if="part.value"> <span class="cmd-val">{{ part.value }}</span></template></template></code></pre>
            </div>
          </div>

          <!-- Footer -->
          <div class="preview-footer">
            <button class="btn btn-secondary footer-btn" :disabled="true" title="Coming Soon…" style="opacity: 0.5; cursor: not-allowed;">
              Launch Headless
            </button>
            <button class="btn btn-primary footer-btn-primary" @click="handleLaunch(false)" :disabled="!canLaunch">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 6px"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/></svg>
              {{ store.loading ? 'Launching…' : 'Launch Session' }}
            </button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* ── Shell & Layout ──────────────────────────────────────────────── */
.launcher-shell {
  height: 100%;
  overflow: hidden;
}

.split-layout {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 0;
  height: 100%;
  min-height: 0;
}

/* ── Left Panel ──────────────────────────────────────────────────── */
.panel-left {
  overflow-y: auto;
  padding: 28px;
  min-width: 0;
}

/* ── Right Panel ─────────────────────────────────────────────────── */
.panel-right {
  background: var(--canvas-subtle);
  border-left: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.preview-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: sticky;
  top: 0;
}

.preview-header {
  padding: 16px 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.preview-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px 20px;
}

.preview-footer {
  flex-shrink: 0;
  padding: 16px 20px;
  border-top: 1px solid var(--border-default);
  background: var(--canvas-default);
  display: flex;
  gap: 10px;
}

/* ── Page Header ─────────────────────────────────────────────────── */
.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.page-subtitle {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 4px 0 0;
}

/* ── Readiness Banner ────────────────────────────────────────────── */
.readiness-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 20px;
  background: var(--warning-subtle, color-mix(in srgb, var(--warning-fg) 8%, transparent));
  border: 1px solid var(--warning-muted);
  border-radius: var(--radius-lg);
  color: var(--warning-fg);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.readiness-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

/* ── Error Banner ────────────────────────────────────────────────── */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 20px;
  background: color-mix(in srgb, var(--danger-fg) 8%, transparent);
  border: 1px solid var(--danger-muted);
  border-radius: var(--radius-lg);
  color: var(--danger-fg);
  font-size: 0.8125rem;
}
.error-text { flex: 1; word-break: break-word; }
.error-dismiss {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--danger-fg);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
  opacity: 0.7;
  &:hover { opacity: 1; }
}

/* ── Section blocks ──────────────────────────────────────────────── */
.section-block {
  margin-bottom: 22px;
}

.section-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  margin: 0 0 10px;
}

.section-panel {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 18px;
}

/* ── Template Cards ──────────────────────────────────────────────── */
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.tpl-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 14px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
  transition: border-color var(--transition-fast, 0.15s) ease,
              box-shadow var(--transition-fast, 0.15s) ease,
              background var(--transition-fast, 0.15s) ease;
}

.tpl-card:hover {
  border-color: var(--border-accent);
  box-shadow: var(--shadow-sm);
}

.tpl-card.selected {
  border-color: var(--accent-emphasis);
  background: var(--accent-subtle, color-mix(in srgb, var(--accent-emphasis) 8%, transparent));
  box-shadow: 0 0 0 1px var(--accent-emphasis),
              0 0 12px color-mix(in srgb, var(--accent-emphasis) 20%, transparent);
}

.tpl-emoji {
  font-size: 20px;
  line-height: 1;
  margin-bottom: 6px;
}

.tpl-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.tpl-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tpl-stats {
  font-size: 0.5625rem;
  color: var(--text-placeholder);
  margin-top: 6px;
}

/* ── Form elements ───────────────────────────────────────────────── */
.form-grid-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

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
  margin-bottom: 5px;
}

.required {
  color: var(--danger-fg);
}

.form-input {
  width: 100%;
  padding: 7px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  transition: border-color 0.15s ease;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-emphasis) 25%, transparent);
}

.form-input::placeholder {
  color: var(--text-placeholder);
}

.form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23848d97' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
  cursor: pointer;
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}

.form-mono {
  font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
  font-size: 0.75rem;
}

/* ── Button Group (reasoning effort) ─────────────────────────────── */
.btn-group {
  display: flex;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  overflow: hidden;
}

.btn-group-item {
  flex: 1;
  padding: 7px 0;
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--canvas-default);
  border: none;
  border-right: 1px solid var(--border-default);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.btn-group-item:last-child {
  border-right: none;
}

.btn-group-item:hover {
  background: var(--canvas-subtle);
}

.btn-group-item.active {
  background: var(--accent-muted, color-mix(in srgb, var(--accent-emphasis) 15%, transparent));
  color: var(--accent-fg);
  font-weight: 600;
}

/* ── Advanced Options ────────────────────────────────────────────── */
.advanced-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  margin-bottom: 10px;
  transition: color 0.15s ease;
}

.advanced-trigger:hover {
  color: var(--text-primary);
}

.advanced-arrow {
  display: inline-block;
  font-size: 0.625rem;
  transition: transform 0.2s ease;
}

.advanced-arrow.open {
  transform: rotate(90deg);
}

.adv-panel {
  margin-top: 0;
}

/* ── Toggle Switch ───────────────────────────────────────────────── */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.toggle-row-last {
  border-bottom: none;
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.toggle-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}

.toggle-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: none;
  padding: 0;
  cursor: pointer;
  background: var(--neutral-muted);
  transition: background 0.2s ease;
  flex-shrink: 0;
}

.toggle-switch.on {
  background: var(--accent-emphasis);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-primary);
  transition: transform 0.2s ease;
  box-shadow: var(--shadow-sm);
}

.toggle-switch.on .toggle-thumb {
  transform: translateX(16px);
}

/* ── Env Vars ────────────────────────────────────────────────────── */
.env-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.env-key {
  flex: 1;
}

.env-val {
  flex: 1.5;
}

.env-remove {
  padding: 4px 8px;
  background: none;
  border: none;
  color: var(--danger-fg);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: 4px;
  transition: background 0.15s ease;
  flex-shrink: 0;
}

.env-remove:hover {
  background: color-mix(in srgb, var(--danger-fg) 12%, transparent);
}

.btn-add-var {
  padding: 6px 12px;
  background: none;
  border: 1px dashed var(--border-default);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.btn-add-var:hover {
  color: var(--accent-fg);
  border-color: var(--accent-fg);
}

/* ── Template Save ───────────────────────────────────────────────── */
.tpl-save-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  margin-bottom: 10px;
}

.tpl-save-checkbox {
  accent-color: var(--accent-emphasis);
}

.tpl-save-form {
  margin-top: 0;
}

/* ── Buttons ─────────────────────────────────────────────────────── */
.btn {
  padding: 8px 16px;
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  border-radius: 6px;
  border: 1px solid var(--border-default);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
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
}

.btn-secondary {
  background: var(--canvas-subtle);
  color: var(--text-secondary);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--canvas-inset);
  color: var(--text-primary);
}

/* ── Footer Buttons ──────────────────────────────────────────────── */
.footer-btn {
  flex: 1;
}

.footer-btn-primary {
  flex: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-emphasis);
  color: var(--text-inverse);
  border-color: var(--accent-emphasis);
  font-weight: 600;
  padding: 10px 16px;
  font-size: 0.8125rem;
  font-family: inherit;
  border-radius: 6px;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.footer-btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.footer-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Metadata Grid ───────────────────────────────────────────────── */
.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 18px;
}

.meta-card {
  padding: 10px 12px;
  background: var(--canvas-default);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-label {
  font-size: 0.625rem;
  color: var(--text-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.meta-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.meta-value.accent {
  color: var(--accent-fg);
}

.meta-value.success {
  color: var(--success-fg);
}

/* ── Config Summary ──────────────────────────────────────────────── */
.config-summary {
  margin-bottom: 16px;
}

.config-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.75rem;
}

.config-row:last-child {
  border-bottom: none;
}

.config-key {
  color: var(--text-tertiary);
}

.config-val {
  color: var(--text-primary);
  font-weight: 500;
  text-align: right;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Divider ─────────────────────────────────────────────────────── */
.preview-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 0 16px;
}

/* ── CLI Command ─────────────────────────────────────────────────── */
.cmd-section {
  margin-bottom: 0;
}

.cmd-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.cmd-title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-tertiary);
  letter-spacing: 0.03em;
}

.cmd-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: none;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.cmd-copy:hover {
  color: var(--accent-fg);
  border-color: var(--accent-fg);
}

.cmd-block {
  display: block;
  padding: 12px 14px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 0.6875rem;
  font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.8;
  margin: 0;
}

.cmd-flag {
  color: var(--accent-fg);
}

.cmd-val {
  color: var(--success-fg);
}

/* ── Template Card Actions ───────────────────────────────────────── */
.tpl-card-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.tpl-card:hover .tpl-card-actions {
  opacity: 1;
}

.tpl-action-btn {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 3px;
  font-size: 0.5625rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  background: var(--canvas-default);
  color: var(--text-tertiary);
  transition: background 0.15s ease, color 0.15s ease;
}

.tpl-action-btn:hover:not(:disabled) {
  background: var(--canvas-inset);
  color: var(--text-primary);
}

.tpl-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.tpl-delete-btn {
  color: var(--danger-fg);
  font-size: 0.75rem;
  font-weight: 700;
}

.tpl-delete-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger-fg) 12%, transparent);
  color: var(--danger-fg);
}

.tpl-confirm-delete {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.6875rem;
  margin-bottom: 4px;
  color: var(--danger-fg);
}

.tpl-confirm-yes,
.tpl-confirm-cancel {
  padding: 1px 6px;
  font-size: 0.625rem;
  font-family: inherit;
  border: 1px solid var(--border-default);
  border-radius: 3px;
  cursor: pointer;
  background: none;
}

.tpl-confirm-yes {
  color: var(--danger-fg);
  border-color: var(--danger-fg);
}

.tpl-confirm-yes:hover {
  background: color-mix(in srgb, var(--danger-fg) 12%, transparent);
}

.tpl-confirm-cancel {
  color: var(--text-secondary);
}

.tpl-confirm-cancel:hover {
  background: var(--canvas-subtle);
}

/* ── Skeleton Loading ────────────────────────────────────────────── */
.tpl-skeleton {
  cursor: default;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-text {
  display: block;
  width: 70%;
  height: 0.75rem;
  background: var(--border-default);
  border-radius: 3px;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* ── Form Hint ───────────────────────────────────────────────────── */
.form-hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-top: 2px;
  display: block;
}

/* ── Disabled Toggle ─────────────────────────────────────────────── */
.toggle-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle-disabled .toggle-switch {
  cursor: not-allowed;
}

/* ── Worktree Options ────────────────────────────────────────────── */
.worktree-options {
  padding: 0 0 0 16px;
  border-left: 2px solid var(--border-default);
  margin-left: 8px;
}

.worktree-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin-top: 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--warning-fg) 10%, transparent);
  color: var(--warning-fg);
  font-size: 12px;
  line-height: 1.4;
}

.worktree-path-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin-top: 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent-fg) 6%, transparent);
  color: var(--fg-muted);
  font-size: 12px;
}
.wt-preview-label { white-space: nowrap; }
.wt-preview-path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-default);
  word-break: break-all;
}

/* ── Repo Picker ─────────────────────────────────────────────────── */
.repo-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.repo-input-row {
  display: flex;
  gap: 6px;
}

.repo-input-row .form-input {
  flex: 1;
}

.repo-browse-btn {
  flex-shrink: 0;
  white-space: nowrap;
}

.repo-recent {
  font-size: 0.75rem;
}

/* ── Context Menu ────────────────────────────────────────────────── */
.ctx-menu {
  position: fixed;
  z-index: 2000;
  min-width: 160px;
  padding: 4px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease;
}

.ctx-item:hover {
  background: var(--canvas-subtle);
}

.ctx-danger {
  color: var(--danger-fg);
}

.ctx-danger:hover {
  background: color-mix(in srgb, var(--danger-fg) 10%, transparent);
}

/* ── Toast ────────────────────────────────────────────────────────── */
.toast-success {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 20px;
  background: var(--canvas-default);
  border: 1px solid var(--success-fg);
  border-radius: var(--radius-lg);
  color: var(--success-fg);
  font-size: 0.8125rem;
  font-weight: 500;
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.3));
  max-width: 480px;
}

.toast-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.toast-cmd {
  font-size: 0.6875rem;
  font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
  color: var(--text-tertiary);
  margin-top: 4px;
  word-break: break-all;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-16px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}

/* ── Slide Transition ────────────────────────────────────────────── */
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
  max-height: 500px;
}

/* ── Responsive ──────────────────────────────────────────────────── */
@media (max-width: 860px) {
  .split-layout {
    grid-template-columns: 1fr;
  }

  .panel-right {
    border-left: none;
    border-top: 1px solid var(--border-default);
    height: auto;
  }

  .preview-inner {
    position: static;
  }
}
</style>
