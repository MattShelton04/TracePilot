<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import { formatDate } from "@tracepilot/ui";
import { ref } from "vue";

const props = defineProps<{
  preset: TaskPreset;
}>();

const emit = defineEmits<{
  close: [];
  run: [preset: TaskPreset];
  duplicate: [preset: TaskPreset];
  edit: [preset: TaskPreset];
  delete: [preset: TaskPreset];
}>();

const sections = ref({
  prompt: true,
  context: false,
  output: false,
  execution: false,
});

function toggleSection(section: keyof typeof sections.value) {
  sections.value[section] = !sections.value[section];
}

function taskTypeColorClass(taskType: string): string {
  const classes: Record<string, string> = {
    analysis: "type-color-accent",
    review: "type-color-success",
    generation: "type-color-warning",
    health: "type-color-danger",
    summary: "type-color-info",
  };
  const key = taskType.toLowerCase();
  for (const [k, v] of Object.entries(classes)) {
    if (key.includes(k)) return v;
  }
  return "type-color-accent";
}

function infoLine(preset: TaskPreset): string {
  const sources = preset.context?.sources?.length ?? 0;
  const vars = preset.prompt?.variables?.length ?? 0;
  const parts: string[] = [];
  if (sources > 0) parts.push(`${sources} source${sources !== 1 ? "s" : ""}`);
  if (vars > 0) parts.push(`${vars} var${vars !== 1 ? "s" : ""}`);
  return parts.join(" · ") || "No sources or vars";
}
</script>

<template>
  <Teleport to="body">
    <div class="preset-backdrop" @click="emit('close')" />
    <Transition name="slideover" appear>
      <div class="preset-slideover">
        <div class="detail-panel__header">
          <div class="detail-header__top">
            <div class="detail-header__left">
              <span
                class="badge badge--type"
                :class="taskTypeColorClass(preset.taskType)"
              >
                {{ preset.taskType }}
              </span>
              <span class="badge badge--version">v{{ preset.version ?? 1 }}</span>
              <span v-if="preset.builtin" class="badge badge--builtin">builtin</span>
            </div>
            <button class="detail-close" @click="emit('close')" title="Close">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                width="14"
                height="14"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
          <h2 class="detail-header__name">{{ preset.name }}</h2>
          <p v-if="preset.description" class="detail-header__desc">
            {{ preset.description }}
          </p>
          <div v-if="preset.tags.length > 0" class="detail-header__tags">
            <span v-for="tag in preset.tags" :key="tag" class="tag-pill">
              {{ tag }}
            </span>
          </div>
          <div class="detail-header__info">
            <span class="meta-item">{{ infoLine(preset) }}</span>
            <span class="meta-item">Updated {{ formatDate(preset.updatedAt) }}</span>
          </div>
        </div>

        <div class="detail-panel__body">
          <!-- Prompt Section -->
          <div class="preset-section">
            <button
              class="detail-section__trigger"
              :class="{ 'detail-section__trigger--expanded': sections.prompt }"
              @click="toggleSection('prompt')"
            >
              <span class="detail-section__title">💬 Prompt</span>
              <svg
                class="detail-section__chevron"
                viewBox="0 0 16 16"
                fill="currentColor"
                width="12"
                height="12"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>
            <div v-if="sections.prompt" class="detail-section__body">
              <div v-if="preset.prompt.system" class="detail-prompt-block">
                <div class="detail-prompt-label">System</div>
                <pre class="detail-prompt-code">{{ preset.prompt.system }}</pre>
              </div>
              <div v-if="preset.prompt.user" class="detail-prompt-block">
                <div class="detail-prompt-label">User</div>
                <pre class="detail-prompt-code">{{ preset.prompt.user }}</pre>
              </div>
              <div
                v-if="!preset.prompt.system && !preset.prompt.user"
                class="detail-empty-hint"
              >
                No prompt template configured
              </div>
              <table
                v-if="preset.prompt.variables.length > 0"
                class="detail-var-table"
              >
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Type</th>
                    <th>Required</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="v in preset.prompt.variables"
                    :key="v.name"
                  >
                    <td class="detail-var-name">{{ v.name }}</td>
                    <td>
                      <span class="detail-var-type">{{ v.type }}</span>
                    </td>
                    <td>
                      <span
                        v-if="v.required"
                        class="detail-required-dot"
                        title="Required"
                      />
                      <span v-else class="detail-optional-text">optional</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Context Sources Section -->
          <div class="preset-section">
            <button
              class="detail-section__trigger"
              :class="{ 'detail-section__trigger--expanded': sections.context }"
              @click="toggleSection('context')"
            >
              <span class="detail-section__title">📄 Context Sources</span>
              <svg
                class="detail-section__chevron"
                viewBox="0 0 16 16"
                fill="currentColor"
                width="12"
                height="12"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>
            <div v-if="sections.context" class="detail-section__body">
              <div
                v-for="(src, idx) in preset.context.sources"
                :key="idx"
                class="detail-source-card"
              >
                <span class="detail-source-type">{{ src.type }}</span>
                <span v-if="src.label" class="detail-source-label">{{ src.label }}</span>
                <span v-if="src.required" class="detail-required-dot" title="Required" />
              </div>
              <div
                v-if="preset.context.sources.length === 0"
                class="detail-empty-hint"
              >
                No context sources configured
              </div>
              <div class="detail-budget">
                Max {{ preset.context.maxChars.toLocaleString() }} chars ·
                {{ preset.context.format }} format
              </div>
            </div>
          </div>

          <!-- Output Config Section -->
          <div class="preset-section">
            <button
              class="detail-section__trigger"
              :class="{ 'detail-section__trigger--expanded': sections.output }"
              @click="toggleSection('output')"
            >
              <span class="detail-section__title">📤 Output Config</span>
              <svg
                class="detail-section__chevron"
                viewBox="0 0 16 16"
                fill="currentColor"
                width="12"
                height="12"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>
            <div v-if="sections.output" class="detail-section__body">
              <div class="detail-kv-grid">
                <div class="detail-kv">
                  <span class="detail-kv__label">Format</span>
                  <span class="detail-kv__value">{{ preset.output.format }}</span>
                </div>
                <div class="detail-kv">
                  <span class="detail-kv__label">Validation</span>
                  <span class="detail-kv__value">{{ preset.output.validation }}</span>
                </div>
              </div>
              <div
                v-if="Object.keys(preset.output.schema).length > 0"
                class="detail-prompt-block"
              >
                <div class="detail-prompt-label">Schema</div>
                <pre class="detail-prompt-code">{{
                  JSON.stringify(preset.output.schema, null, 2)
                }}</pre>
              </div>
            </div>
          </div>

          <!-- Execution Config Section -->
          <div class="preset-section">
            <button
              class="detail-section__trigger"
              :class="{ 'detail-section__trigger--expanded': sections.execution }"
              @click="toggleSection('execution')"
            >
              <span class="detail-section__title">⚡ Execution Config</span>
              <svg
                class="detail-section__chevron"
                viewBox="0 0 16 16"
                fill="currentColor"
                width="12"
                height="12"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>
            <div v-if="sections.execution" class="detail-section__body">
              <div class="detail-kv-grid">
                <div class="detail-kv">
                  <span class="detail-kv__label">Timeout</span>
                  <span class="detail-kv__value">
                    {{ preset.execution.timeoutSeconds }}s
                  </span>
                </div>
                <div class="detail-kv">
                  <span class="detail-kv__label">Max Retries</span>
                  <span class="detail-kv__value">
                    {{ preset.execution.maxRetries }}
                  </span>
                </div>
                <div class="detail-kv">
                  <span class="detail-kv__label">Priority</span>
                  <span class="detail-kv__value">
                    {{ preset.execution.priority }}
                  </span>
                </div>
                <div class="detail-kv">
                  <span class="detail-kv__label">Model</span>
                  <span class="detail-kv__value">
                    {{ preset.execution.modelOverride || "Default" }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="detail-panel__footer">
          <button class="btn btn--accent btn--sm" @click="emit('run', preset)">
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
              <path d="M4 2l10 6-10 6z" />
            </svg>
            Run Task
          </button>
          <button class="btn btn--secondary btn--sm" @click="emit('duplicate', preset)">
            Duplicate
          </button>
          <button
            class="btn btn--secondary btn--sm"
            @click="emit('edit', preset)"
          >
            Edit
          </button>
          <button
            class="btn btn--ghost btn--sm"
            :disabled="preset.builtin"
            @click="emit('delete', preset)"
          >
            Delete
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* Unscoped for Teleport to body */
.preset-backdrop {
  position: fixed;
  inset: 0;
  background: var(--backdrop-color);
  z-index: 999;
}

.preset-slideover {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: 100vh;
  background: var(--canvas-default);
  border-left: 1px solid var(--border-default);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.slideover-enter-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slideover-leave-active {
  transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.slideover-enter-from,
.slideover-leave-to {
  transform: translateX(100%);
}

.detail-panel__header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.detail-header__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-header__left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.detail-close:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.detail-header__name {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  margin: 0;
}

.detail-header__desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.45;
  margin: 0;
}

.detail-header__tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.detail-header__info {
  display: flex;
  gap: 12px;
}

/* ── Detail Sections ─────────────────────────────────────── */
.detail-panel__body {
  flex: 1;
  overflow-y: auto;
}

.preset-section {
  border-bottom: 1px solid var(--border-muted);
}

.preset-section:last-child {
  border-bottom: none;
}

.detail-section__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
  transition: background var(--transition-fast);
  user-select: none;
}

.detail-section__trigger:hover {
  background: var(--canvas-subtle);
}

.detail-section__title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.detail-section__chevron {
  transition: transform var(--transition-fast);
  color: var(--text-tertiary);
}

.detail-section__trigger--expanded .detail-section__chevron {
  transform: rotate(90deg);
}

.detail-section__body {
  padding: 0 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Detail Content ──────────────────────────────────────── */
.detail-prompt-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-prompt-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.detail-prompt-code {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 12px;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 0.6875rem;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
  margin: 0;
}

.detail-empty-hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-style: italic;
  padding: 8px 0;
}

.detail-var-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.detail-var-table th {
  text-align: left;
  padding: 6px 8px;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border-default);
}

.detail-var-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-muted);
  color: var(--text-secondary);
}

.detail-var-name {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 0.6875rem;
  color: var(--accent-fg);
  font-weight: 500;
}

.detail-var-type {
  font-size: 0.5625rem;
  padding: 1px 5px;
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

.detail-required-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger-fg);
}

.detail-optional-text {
  font-size: 0.625rem;
  color: var(--text-tertiary);
}

.detail-source-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}

.detail-source-type {
  font-size: 0.75rem;
  font-weight: 500;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  color: var(--text-primary);
}

.detail-source-label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.detail-budget {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  padding: 6px 0 0;
}

.detail-kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.detail-kv {
  padding: 10px 12px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}

.detail-kv__label {
  display: block;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 4px;
}

.detail-kv__value {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* ── Detail Footer ───────────────────────────────────────── */
.detail-panel__footer {
  padding: 14px 20px;
  border-top: 1px solid var(--border-default);
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.detail-panel__footer .btn {
  flex: 1;
  justify-content: center;
}

/* Badge/tag/btn styles for detail panel */
.preset-slideover .badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  flex-shrink: 0;
}

.preset-slideover .badge--type {
  background: color-mix(in srgb, var(--type-color, var(--accent-fg)) 12%, transparent);
  color: var(--type-color, var(--accent-fg));
  border: 1px solid color-mix(in srgb, var(--type-color, var(--accent-fg)) 20%, transparent);
}

.preset-slideover .type-color-accent { --type-color: var(--accent-fg); color: var(--accent-fg); }
.preset-slideover .type-color-success { --type-color: var(--success-fg); color: var(--success-fg); }
.preset-slideover .type-color-warning { --type-color: var(--warning-fg); color: var(--warning-fg); }
.preset-slideover .type-color-danger { --type-color: var(--danger-fg); color: var(--danger-fg); }
.preset-slideover .type-color-info { --type-color: var(--accent-fg); color: var(--accent-fg); }

.preset-slideover .badge--version {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-variant-numeric: tabular-nums;
}

.preset-slideover .badge--builtin {
  background: var(--done-subtle);
  color: var(--done-fg);
  border: 1px solid var(--done-muted);
}

.preset-slideover .tag-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: var(--accent-muted);
  border: 1px solid var(--accent-subtle);
}

.preset-slideover .meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.preset-slideover .btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.preset-slideover .btn--sm {
  padding: 4px 10px;
  font-size: 0.75rem;
}

.preset-slideover .btn--accent {
  background: var(--accent-muted);
  border: 1px solid var(--accent-muted);
  color: var(--accent-fg);
  font-weight: 600;
}

.preset-slideover .btn--accent:hover:not(:disabled) {
  background: var(--accent-muted);
  border-color: var(--accent-fg);
}

.preset-slideover .btn--secondary {
  background: var(--canvas-default, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.preset-slideover .btn--secondary:hover {
  color: var(--text-primary);
  border-color: var(--accent-fg);
}

.preset-slideover .btn--ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-tertiary);
}

.preset-slideover .btn--ghost:hover:not(:disabled) {
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border-color: var(--border-default);
}

.preset-slideover .btn--ghost:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
