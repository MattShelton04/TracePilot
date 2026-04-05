<script setup lang="ts">
import type { McpServerConfig, McpTransport } from "@tracepilot/types";
import { computed, reactive, ref } from "vue";

const emit = defineEmits<{
  close: [];
  submit: [name: string, config: McpServerConfig];
}>();

const submitting = ref(false);
const validationError = ref("");
const showAdvanced = ref(false);

const form = reactive({
  name: "",
  command: "",
  args: "",
  url: "",
  transport: "stdio" as McpTransport,
  description: "",
  tags: "",
  scope: "global" as "global" | "project",
  workingDir: "",
  envPairs: [{ key: "", value: "" }] as { key: string; value: string }[],
});

const transportOptions: { value: McpTransport; label: string; tooltip: string }[] = [
  { value: "stdio", label: "Stdio", tooltip: "Local subprocess — communicates via stdin/stdout" },
  { value: "sse", label: "SSE", tooltip: "Server-Sent Events — legacy remote transport" },
  {
    value: "http",
    label: "HTTP",
    tooltip: "Streamable HTTP — modern remote transport (MCP 2025 spec)",
  },
];

const jsonPreview = computed(() => {
  const name = form.name || "my-server";
  const entry: Record<string, unknown> = {};

  if (form.transport === "stdio") {
    entry.command = form.command || "npx";
    const args = form.args
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (args.length > 0) entry.args = args;
  } else {
    entry.type = form.transport;
    entry.url = form.url || "http://localhost:3000/mcp";
  }

  const env: Record<string, string> = {};
  for (const pair of form.envPairs) {
    if (pair.key.trim()) env[pair.key.trim()] = pair.value;
  }
  if (Object.keys(env).length > 0) entry.env = env;

  return JSON.stringify({ mcpServers: { [name]: entry } }, null, 2);
});

function addEnvPair() {
  form.envPairs.push({ key: "", value: "" });
}

function removeEnvPair(index: number) {
  form.envPairs.splice(index, 1);
  if (form.envPairs.length === 0) {
    form.envPairs.push({ key: "", value: "" });
  }
}

function validate(): boolean {
  validationError.value = "";

  if (!form.name.trim()) {
    validationError.value = "Server name is required.";
    return false;
  }

  if (form.transport === "stdio" && !form.command.trim()) {
    validationError.value = "Command is required for stdio transport.";
    return false;
  }

  if (
    (form.transport === "sse" ||
      form.transport === "http" ||
      form.transport === "streamable-http") &&
    !form.url.trim()
  ) {
    validationError.value = "URL is required for SSE/HTTP transport.";
    return false;
  }

  return true;
}

async function handleSubmit() {
  if (!validate()) return;

  submitting.value = true;

  const env: Record<string, string> = {};
  for (const pair of form.envPairs) {
    if (pair.key.trim()) {
      env[pair.key.trim()] = pair.value;
    }
  }

  const config: McpServerConfig = {
    command: form.command || undefined,
    args: form.args
      ? form.args
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    url: form.url || undefined,
    type: form.transport,
    description: form.description || undefined,
    tags: form.tags
      ? form.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    enabled: true,
  };

  emit("submit", form.name.trim(), config);
  submitting.value = false;
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="add-modal" role="dialog" aria-labelledby="add-server-title">
        <div class="modal-header-wrap">
          <div class="modal-title-row">
            <div class="modal-title">
              <div class="modal-title-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
              </div>
              <span id="add-server-title">Add MCP Server</span>
            </div>
            <button class="modal-close" aria-label="Close" @click="emit('close')">✕</button>
          </div>
        </div>

        <div class="modal-body-area">
          <div class="custom-layout">
            <div class="custom-form-col">
              <form @submit.prevent="handleSubmit">
                <div class="form-group">
                  <label class="form-label">Server Name</label>
                  <input
                    v-model="form.name"
                    type="text"
                    class="form-input-modal"
                    placeholder="my-custom-server"
                    required
                  />
                </div>

                <div class="form-group">
                  <label class="form-label">Transport Type</label>
                  <div class="transport-pills">
                    <button
                      v-for="opt in transportOptions"
                      :key="opt.value"
                      class="transport-pill"
                      :class="{ active: form.transport === opt.value }"
                      type="button"
                      :title="opt.tooltip"
                      @click="form.transport = opt.value"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </div>

                <template v-if="form.transport === 'stdio'">
                  <div class="form-group">
                    <label class="form-label">Command</label>
                    <input
                      v-model="form.command"
                      type="text"
                      class="form-input-modal"
                      placeholder="npx, python, node…"
                    />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Arguments</label>
                    <textarea
                      v-model="form.args"
                      class="form-textarea-modal"
                      placeholder="One argument per line"
                      rows="2"
                    />
                  </div>
                </template>
                <template v-else>
                  <div class="form-group">
                    <label class="form-label">URL</label>
                    <input
                      v-model="form.url"
                      type="text"
                      class="form-input-modal"
                      placeholder="http://localhost:3000/mcp"
                    />
                  </div>
                </template>

                <div class="form-divider" />

                <div class="form-group">
                  <label class="form-label">Environment Variables <span class="form-label-optional">(optional)</span></label>
                  <div class="env-rows">
                    <div v-for="(pair, idx) in form.envPairs" :key="idx" class="env-row-modal">
                      <input
                        v-model="pair.key"
                        type="text"
                        class="form-input-modal env-key-input"
                        placeholder="KEY"
                      />
                      <input
                        v-model="pair.value"
                        type="text"
                        class="form-input-modal"
                        placeholder="Value"
                      />
                      <button class="env-remove-btn" type="button" title="Remove" @click="removeEnvPair(idx)">✕</button>
                    </div>
                  </div>
                  <button class="env-add-btn" type="button" title="Add variable" @click="addEnvPair">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </div>

                <div class="form-group">
                  <label class="form-label" for="add-description">Description <span class="form-label-optional">(optional)</span></label>
                  <textarea
                    id="add-description"
                    v-model="form.description"
                    class="form-textarea-modal"
                    placeholder="Optional description"
                    rows="2"
                  />
                </div>

                <div class="form-group">
                  <label class="form-label" for="add-tags">Tags <span class="form-label-optional">(comma-separated)</span></label>
                  <input
                    id="add-tags"
                    v-model="form.tags"
                    type="text"
                    class="form-input-modal"
                    placeholder="e.g., filesystem, code"
                  />
                </div>

                <button
                  class="advanced-toggle"
                  :class="{ open: showAdvanced }"
                  type="button"
                  @click="showAdvanced = !showAdvanced"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4l4 4-4 4"/></svg>
                  Advanced Options
                </button>

                <div v-if="showAdvanced" class="advanced-content">
                  <div class="form-group">
                    <label class="form-label">Working Directory <span class="form-label-optional">(optional)</span></label>
                    <input
                      v-model="form.workingDir"
                      type="text"
                      class="form-input-modal"
                      placeholder="/path/to/project"
                    />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Scope</label>
                    <div class="scope-toggle">
                      <button
                        class="scope-option-btn"
                        :class="{ active: form.scope === 'global' }"
                        type="button"
                        @click="form.scope = 'global'"
                      >
                        🌐 Global
                      </button>
                      <button
                        class="scope-option-btn"
                        :class="{ active: form.scope === 'project' }"
                        type="button"
                        @click="form.scope = 'project'"
                      >
                        📁 Project
                      </button>
                    </div>
                  </div>
                </div>

                <p v-if="validationError" class="validation-error">{{ validationError }}</p>
              </form>
            </div>

            <div class="custom-preview-col">
              <div class="custom-preview-header">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                JSON Preview
              </div>
              <div class="custom-preview-body">
                <pre class="json-preview">{{ jsonPreview }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer-bar">
          <button class="btn-cancel" type="button" @click="emit('close')">Cancel</button>
          <button class="btn-add" type="button" :disabled="submitting" @click="handleSubmit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            {{ submitting ? "Adding…" : "Add Server" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  animation: backdropIn 0.25s ease;
}

@keyframes backdropIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.add-modal {
  width: 840px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 80px);
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg), 0 0 0 1px var(--border-glow), 0 0 80px rgba(99, 102, 241, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalIn {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.modal-header-wrap {
  padding: 20px 24px 16px;
}

.modal-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-title-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--accent-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-fg);
  font-size: 13px;
}

.modal-close {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
  transition: all var(--transition-fast);
}

.modal-close:hover {
  background: var(--danger-subtle);
  border-color: var(--danger-muted);
  color: var(--danger-fg);
}

.modal-body-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-default);
}

.custom-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.custom-form-col {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
}

.custom-form-col::-webkit-scrollbar { width: 5px; }
.custom-form-col::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: var(--radius-full); }

.custom-preview-col {
  width: 320px;
  min-width: 320px;
  background: var(--canvas-default);
  border-left: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
}

.custom-preview-header {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-default);
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.custom-preview-body {
  flex: 1;
  padding: 14px 16px;
  overflow-y: auto;
}

.json-preview {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre;
  word-break: break-all;
  margin: 0;
}

.form-group {
  margin-bottom: 14px;
}

.form-label {
  display: block;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 5px;
  letter-spacing: 0.01em;
}

.form-label-optional {
  font-weight: 400;
  color: var(--text-placeholder);
  margin-left: 4px;
}

.form-input-modal,
.form-textarea-modal {
  width: 100%;
  padding: 8px 11px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
  transition: all var(--transition-fast);
  box-sizing: border-box;
}

.form-input-modal::placeholder,
.form-textarea-modal::placeholder {
  color: var(--text-placeholder);
}

.form-input-modal:focus,
.form-textarea-modal:focus {
  border-color: var(--accent-emphasis);
  box-shadow: var(--shadow-glow-accent);
}

.form-textarea-modal {
  resize: vertical;
  min-height: 60px;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
}

.form-divider {
  height: 1px;
  background: var(--border-default);
  margin: 16px 0;
}

.transport-pills {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.transport-pill {
  flex: 1;
  padding: 7px 0;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  color: var(--text-tertiary);
  background: var(--canvas-default);
  border: none;
  border-right: 1px solid var(--border-default);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.transport-pill:last-child {
  border-right: none;
}

.transport-pill.active {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-weight: 600;
}

.env-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.env-row-modal {
  display: flex;
  gap: 6px;
  align-items: center;
}

.env-row-modal .form-input-modal {
  flex: 1;
  padding: 6px 9px;
  font-size: 0.75rem;
}

.env-key-input {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.env-add-btn,
.env-remove-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.env-add-btn {
  margin-top: 6px;
}

.env-add-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-emphasis);
  color: var(--accent-fg);
}

.env-remove-btn:hover {
  background: var(--danger-subtle);
  border-color: var(--danger-muted);
  color: var(--danger-fg);
}

.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  cursor: pointer;
  border: none;
  background: none;
  transition: color var(--transition-fast);
}

.advanced-toggle:hover {
  color: var(--text-secondary);
}

.advanced-toggle svg {
  width: 12px;
  height: 12px;
  transition: transform var(--transition-fast);
}

.advanced-toggle.open svg {
  transform: rotate(90deg);
}

.advanced-content {
  padding-top: 4px;
}

.scope-toggle {
  display: inline-flex;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.scope-option-btn {
  padding: 6px 16px;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  background: var(--canvas-default);
  color: var(--text-tertiary);
  border: none;
  border-right: 1px solid var(--border-default);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.scope-option-btn:last-child {
  border-right: none;
}

.scope-option-btn:hover {
  color: var(--text-primary);
}

.scope-option-btn.active {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-weight: 600;
}

.validation-error {
  margin: 8px 0 0;
  font-size: 0.8125rem;
  color: var(--danger-fg);
}

.modal-footer-bar {
  padding: 14px 24px;
  border-top: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  background: var(--canvas-overlay);
}

.btn-cancel {
  padding: 7px 16px;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-cancel:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.btn-add {
  padding: 7px 20px;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  font-weight: 600;
  font-family: inherit;
  background: var(--gradient-accent);
  border: none;
  color: white;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(99, 102, 241, 0.3);
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  gap: 5px;
}

.btn-add:hover {
  box-shadow: 0 2px 12px rgba(99, 102, 241, 0.5);
  transform: translateY(-1px);
}

.btn-add:active {
  transform: translateY(0);
}

.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

@media (max-width: 700px) {
  .custom-layout { flex-direction: column; }
  .custom-preview-col { width: auto; min-width: 0; border-left: none; border-top: 1px solid var(--border-default); }
}
</style>