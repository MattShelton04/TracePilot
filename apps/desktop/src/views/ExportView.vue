<script setup lang="ts">
// STUB: Export currently generates mock preview content.
// STUB: Replace with real export via exportSession() when backend Phase 5 export crate is ready.
// STUB: File download uses Blob URL — switch to Tauri save_file dialog in production.

import type { ExportConfig } from '@tracepilot/types';
import { BtnGroup, FormSwitch, formatBytes, useToast } from '@tracepilot/ui';
import { computed, onMounted, ref, watch } from 'vue';
import StubBanner from '@/components/StubBanner.vue';
import { useSessionsStore } from '@/stores/sessions';

const sessionsStore = useSessionsStore();

onMounted(() => {
  sessionsStore.fetchSessions();
});

// ── Config state ─────────────────────────────────────────────
const selectedSessionId = ref('');
const format = ref<ExportConfig['format']>('json');

const formatOptions = [
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'csv', label: 'CSV' },
];

// Include sections
const includeConversation = ref(true);
const includeEvents = ref(true);
const includeMetrics = ref(true);
const includeToolCalls = ref(true);
const includeTodos = ref(true);
const includeCheckpoints = ref(false);
const includeRawData = ref(false);

// Options
const includeTimestamps = ref(true);
const includeTokenCounts = ref(true);
const anonymizePaths = ref(false);

const exporting = ref(false);
const { success } = useToast();

// ── Selected session info ────────────────────────────────────
const selectedSession = computed(() =>
  sessionsStore.sessions.find((s) => s.id === selectedSessionId.value),
);

// ── Mock preview generation ──────────────────────────────────
const enabledSections = computed(() => {
  const sections: string[] = [];
  if (includeConversation.value) sections.push('conversation');
  if (includeEvents.value) sections.push('events');
  if (includeMetrics.value) sections.push('metrics');
  if (includeToolCalls.value) sections.push('toolCalls');
  if (includeTodos.value) sections.push('todos');
  if (includeCheckpoints.value) sections.push('checkpoints');
  if (includeRawData.value) sections.push('rawData');
  return sections;
});

function generateJsonPreview(): string {
  const session = selectedSession.value;
  const obj: Record<string, unknown> = {
    exportMeta: {
      format: 'json',
      exportedAt: new Date().toISOString(),
      sessionId: session?.id ?? 'no-session-selected',
      options: {
        timestamps: includeTimestamps.value,
        tokenCounts: includeTokenCounts.value,
        anonymizePaths: anonymizePaths.value,
      },
    },
  };
  if (includeConversation.value) {
    obj.conversation = [
      {
        turn: 1,
        role: 'user',
        content: 'Implement authentication module',
        ...(includeTimestamps.value && { timestamp: '2025-01-15T10:30:00Z' }),
        ...(includeTokenCounts.value && { tokens: 12 }),
      },
      {
        turn: 1,
        role: 'assistant',
        content: "I'll create the auth module with JWT-based authentication...",
        ...(includeTimestamps.value && { timestamp: '2025-01-15T10:30:05Z' }),
        ...(includeTokenCounts.value && { tokens: 847 }),
      },
    ];
  }
  if (includeEvents.value) {
    obj.events = [
      {
        type: 'session.init',
        ...(includeTimestamps.value && { timestamp: '2025-01-15T10:29:55Z' }),
      },
      {
        type: 'tool.execute',
        tool: 'edit',
        ...(includeTimestamps.value && { timestamp: '2025-01-15T10:30:10Z' }),
      },
    ];
  }
  if (includeMetrics.value) {
    obj.metrics = {
      totalTokens: 12450,
      totalDurationMs: 45200,
      models: { 'claude-sonnet-4': { requests: 5, inputTokens: 8200, outputTokens: 4250 } },
    };
  }
  if (includeToolCalls.value) {
    const path = anonymizePaths.value ? '[REDACTED]/auth.ts' : 'src/auth/auth.ts';
    obj.toolCalls = [
      { name: 'edit', target: path, success: true, durationMs: 120 },
      { name: 'powershell', command: 'npm test', success: true, durationMs: 3400 },
    ];
  }
  if (includeTodos.value) {
    obj.todos = [
      { id: 'auth-module', title: 'Create auth module', status: 'done' },
      { id: 'write-tests', title: 'Write unit tests', status: 'in_progress' },
    ];
  }
  if (includeCheckpoints.value) {
    obj.checkpoints = [
      { number: 1, title: 'Initial setup complete' },
      { number: 2, title: 'Auth endpoints implemented' },
    ];
  }
  if (includeRawData.value) {
    obj.rawData = { eventCount: 42, note: 'Full event stream omitted in preview' };
  }
  return JSON.stringify(obj, null, 2);
}

function generateMarkdownPreview(): string {
  const session = selectedSession.value;
  const lines: string[] = [];
  lines.push(`# Session Export: ${session?.summary ?? 'No session selected'}`);
  lines.push('');
  lines.push(`**Exported:** ${new Date().toISOString()}`);
  lines.push(`**Session ID:** ${session?.id ?? '—'}`);
  lines.push('');

  if (includeConversation.value) {
    lines.push('## Conversation');
    lines.push('');
    lines.push('### Turn 1');
    if (includeTimestamps.value) lines.push('*2025-01-15T10:30:00Z*');
    lines.push('');
    lines.push('**User:** Implement authentication module');
    lines.push('');
    lines.push("**Assistant:** I'll create the auth module with JWT-based authentication...");
    if (includeTokenCounts.value) lines.push('> Tokens: 859');
    lines.push('');
  }
  if (includeEvents.value) {
    lines.push('## Events');
    lines.push('');
    lines.push('| Type | Timestamp |');
    lines.push('|------|-----------|');
    lines.push(`| session.init | ${includeTimestamps.value ? '2025-01-15T10:29:55Z' : '—'} |`);
    lines.push(`| tool.execute | ${includeTimestamps.value ? '2025-01-15T10:30:10Z' : '—'} |`);
    lines.push('');
  }
  if (includeMetrics.value) {
    lines.push('## Metrics');
    lines.push('');
    lines.push('- **Total Tokens:** 12,450');
    lines.push('- **Duration:** 45.2s');
    lines.push('');
  }
  if (includeToolCalls.value) {
    const path = anonymizePaths.value ? '[REDACTED]/auth.ts' : 'src/auth/auth.ts';
    lines.push('## Tool Calls');
    lines.push('');
    lines.push(`1. \`edit\` → ${path} ✓ (120ms)`);
    lines.push('2. `powershell` → npm test ✓ (3.4s)');
    lines.push('');
  }
  if (includeTodos.value) {
    lines.push('## Todos');
    lines.push('');
    lines.push('- [x] Create auth module');
    lines.push('- [ ] Write unit tests');
    lines.push('');
  }
  if (includeCheckpoints.value) {
    lines.push('## Checkpoints');
    lines.push('');
    lines.push('1. Initial setup complete');
    lines.push('2. Auth endpoints implemented');
    lines.push('');
  }
  if (includeRawData.value) {
    lines.push('## Raw Data');
    lines.push('');
    lines.push('*42 raw events (omitted in preview)*');
    lines.push('');
  }
  return lines.join('\n');
}

function generateCsvPreview(): string {
  const lines: string[] = [];
  const headers: string[] = ['section', 'key', 'value'];
  if (includeTimestamps.value) headers.push('timestamp');
  if (includeTokenCounts.value) headers.push('tokens');
  lines.push(headers.join(','));

  if (includeConversation.value) {
    const ts = includeTimestamps.value ? ',2025-01-15T10:30:00Z' : '';
    const tok = includeTokenCounts.value ? ',12' : '';
    lines.push(`conversation,user_message,"Implement authentication module"${ts}${tok}`);
    const ts2 = includeTimestamps.value ? ',2025-01-15T10:30:05Z' : '';
    const tok2 = includeTokenCounts.value ? ',847' : '';
    lines.push(`conversation,assistant_message,"I'll create the auth module..."${ts2}${tok2}`);
  }
  if (includeEvents.value) {
    const ts = includeTimestamps.value ? ',2025-01-15T10:29:55Z' : '';
    const tok = includeTokenCounts.value ? ',' : '';
    lines.push(`events,session.init,""${ts}${tok}`);
    const ts2 = includeTimestamps.value ? ',2025-01-15T10:30:10Z' : '';
    lines.push(`events,tool.execute,"edit"${ts2}${tok}`);
  }
  if (includeMetrics.value) {
    const ts = includeTimestamps.value ? ',' : '';
    const tok = includeTokenCounts.value ? ',12450' : '';
    lines.push(`metrics,total_tokens,"12450"${ts}${tok}`);
  }
  if (includeToolCalls.value) {
    const path = anonymizePaths.value ? '[REDACTED]/auth.ts' : 'src/auth/auth.ts';
    const ts = includeTimestamps.value ? ',2025-01-15T10:30:10Z' : '';
    const tok = includeTokenCounts.value ? ',' : '';
    lines.push(`tool_calls,edit,"${path}"${ts}${tok}`);
    lines.push(`tool_calls,powershell,"npm test"${ts}${tok}`);
  }
  if (includeTodos.value) {
    const ts = includeTimestamps.value ? ',' : '';
    const tok = includeTokenCounts.value ? ',' : '';
    lines.push(`todos,auth-module,"done"${ts}${tok}`);
    lines.push(`todos,write-tests,"in_progress"${ts}${tok}`);
  }
  return lines.join('\n');
}

const previewContent = computed(() => {
  switch (format.value) {
    case 'json':
      return generateJsonPreview();
    case 'markdown':
      return generateMarkdownPreview();
    case 'csv':
      return generateCsvPreview();
    default:
      return '';
  }
});

const previewLanguage = computed(() => {
  switch (format.value) {
    case 'json':
      return 'json';
    case 'markdown':
      return 'markdown';
    case 'csv':
      return 'csv';
    default:
      return 'text';
  }
});

const estimatedSize = computed(() => {
  const bytes = new Blob([previewContent.value]).size;
  return formatBytes(bytes);
});

// ── Export action ────────────────────────────────────────────
async function handleExport() {
  // STUB: File download uses Blob URL — switch to Tauri save_file dialog in production.
  exporting.value = true;

  // Simulate brief export delay
  await new Promise((r) => setTimeout(r, 600));

  const ext = format.value === 'json' ? 'json' : format.value === 'markdown' ? 'md' : 'csv';
  const mime =
    format.value === 'json'
      ? 'application/json'
      : format.value === 'csv'
        ? 'text/csv'
        : 'text/markdown';
  const blob = new Blob([previewContent.value], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-export.${ext}`;
  a.click();
  URL.revokeObjectURL(url);

  exporting.value = false;
  success('Session exported successfully');
}
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <StubBanner />
      <!-- Header -->
      <header class="export-header">
        <h1>Export Session</h1>
        <p class="text-secondary">Configure and preview your session export</p>
      </header>

      <div class="export-layout">
        <!-- Left Column: Config -->
        <div class="export-config">
          <!-- Session Selector -->
          <section class="config-section">
            <h3 class="config-section-title">Session</h3>
            <select
              v-model="selectedSessionId"
              class="form-select"
            >
              <option value="" disabled>Select a session…</option>
              <option
                v-for="s in sessionsStore.sessions"
                :key="s.id"
                :value="s.id"
              >
                {{ s.summary || s.id }} — {{ s.repository ?? 'unknown' }}
              </option>
            </select>
          </section>

          <!-- Format Selector -->
          <section class="config-section">
            <h3 class="config-section-title">Format</h3>
            <BtnGroup v-model="format" :options="formatOptions" />
          </section>

          <!-- Include Sections -->
          <section class="config-section">
            <h3 class="config-section-title">Include Sections</h3>
            <div class="switch-list">
              <FormSwitch v-model="includeConversation" label="Conversation" />
              <FormSwitch v-model="includeEvents" label="Events" />
              <FormSwitch v-model="includeMetrics" label="Metrics" />
              <FormSwitch v-model="includeToolCalls" label="Tool Calls" />
              <FormSwitch v-model="includeTodos" label="Todos" />
              <FormSwitch v-model="includeCheckpoints" label="Checkpoints" />
              <FormSwitch v-model="includeRawData" label="Raw Data" />
            </div>
          </section>

          <!-- Options -->
          <section class="config-section">
            <h3 class="config-section-title">Options</h3>
            <div class="switch-list">
              <FormSwitch v-model="includeTimestamps" label="Include timestamps" />
              <FormSwitch v-model="includeTokenCounts" label="Include token counts" />
              <FormSwitch v-model="anonymizePaths" label="Anonymize paths" />
            </div>
          </section>

          <!-- Export Button -->
          <button
            class="btn btn-primary btn-export"
            :disabled="!selectedSessionId || exporting"
            @click="handleExport"
          >
            <template v-if="exporting">
              <span class="spinner" /> Exporting…
            </template>
            <template v-else>
              Export Session
            </template>
          </button>
        </div>

        <!-- Right Column: Preview -->
        <div class="export-preview-panel">
          <div class="preview-header">
            <h3 class="config-section-title">Preview</h3>
            <span class="preview-badge">{{ previewLanguage.toUpperCase() }}</span>
          </div>
          <div class="preview-scroll">
            <pre class="preview-code"><code>{{ previewContent }}</code></pre>
          </div>
          <div class="preview-footer">
            <span class="text-tertiary">
              {{ enabledSections.length }} section{{ enabledSections.length !== 1 ? 's' : '' }} ·
              Estimated size: <strong>{{ estimatedSize }}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.export-header {
  margin-bottom: 24px;
}
.export-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}
.export-layout {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 24px;
  min-height: 0;
}

/* ── Config column ─────────────────────────────────────────── */
.export-config {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.config-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.config-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin: 0;
}
.form-select {
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
  transition: border-color var(--transition-fast);
}
.form-select:focus {
  border-color: var(--accent-emphasis);
}
.switch-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.btn-export {
  margin-top: 8px;
  padding: 12px 24px;
  font-size: 1rem;
  font-weight: 600;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* ── Preview column ────────────────────────────────────────── */
.export-preview-panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-inset);
  min-height: 0;
  max-height: calc(100vh - 180px);
}
.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
}
.preview-badge {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--accent-subtle);
  color: var(--accent-fg);
}
.preview-scroll {
  flex: 1;
  overflow: auto;
  padding: 16px;
  min-height: 0;
}
.preview-code {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.preview-footer {
  padding: 10px 16px;
  border-top: 1px solid var(--border-default);
  font-size: 0.8rem;
}
.text-secondary {
  color: var(--text-secondary);
}
.text-tertiary {
  color: var(--text-tertiary);
}

/* ── Spinner ───────────────────────────────────────────────── */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-muted);
  border-top-color: var(--accent-fg);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
</style>
