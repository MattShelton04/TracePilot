<script setup lang="ts">
import type { McpServerConfig, McpTransport } from "@tracepilot/types";
import { computed, reactive, watch } from "vue";

const props = defineProps<{
  config: McpServerConfig;
  serverName?: string;
}>();

const emit = defineEmits<{
  "update:config": [config: McpServerConfig];
}>();

const transportOptions: { value: McpTransport; label: string }[] = [
  { value: "stdio", label: "Stdio" },
  { value: "sse", label: "SSE" },
  { value: "http", label: "HTTP" },
];

const form = reactive<{
  command: string;
  args: string;
  url: string;
  transport: McpTransport;
  description: string;
  tags: string;
  tools: string;
  envPairs: { key: string; value: string }[];
  headerPairs: { key: string; value: string }[];
}>({
  command: "",
  args: "",
  url: "",
  transport: "stdio",
  description: "",
  tags: "",
  tools: "",
  envPairs: [],
  headerPairs: [],
});

const showUrl = computed(
  () =>
    form.transport === "sse" || form.transport === "http" || form.transport === "streamable-http",
);

function syncFromProps() {
  form.command = props.config.command ?? "";
  form.args = (props.config.args ?? []).join(", ");
  form.url = props.config.url ?? "";
  form.transport = props.config.type ?? "stdio";
  form.description = props.config.description ?? "";
  form.tags = (props.config.tags ?? []).join(", ");
  form.tools = (props.config.tools ?? []).join(", ");
  const env = props.config.env ?? {};
  form.envPairs = Object.entries(env).map(([key, value]) => ({ key, value }));
  if (form.envPairs.length === 0) {
    form.envPairs.push({ key: "", value: "" });
  }
  const headers = props.config.headers ?? {};
  form.headerPairs = Object.entries(headers).map(([key, value]) => ({ key, value }));
  if (form.headerPairs.length === 0 && showUrl.value) {
    form.headerPairs.push({ key: "", value: "" });
  }
}

// Only re-sync from props when the server identity changes, not on every deep mutation
watch(() => props.serverName, syncFromProps, { immediate: true });

function addEnvPair() {
  form.envPairs.push({ key: "", value: "" });
}

function removeEnvPair(index: number) {
  form.envPairs.splice(index, 1);
  if (form.envPairs.length === 0) {
    form.envPairs.push({ key: "", value: "" });
  }
  emitUpdate();
}

function addHeaderPair() {
  form.headerPairs.push({ key: "", value: "" });
}

function removeHeaderPair(index: number) {
  form.headerPairs.splice(index, 1);
  emitUpdate();
}

function emitUpdate() {
  const env: Record<string, string> = {};
  for (const pair of form.envPairs) {
    if (pair.key.trim()) {
      env[pair.key.trim()] = pair.value;
    }
  }

  const headers: Record<string, string> = {};
  for (const pair of form.headerPairs) {
    if (pair.key.trim()) {
      headers[pair.key.trim()] = pair.value;
    }
  }

  const config: McpServerConfig = {
    command: form.command || undefined,
    args: form.args
      ? form.args
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    url: form.url || undefined,
    type: form.transport as McpTransport,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    tools: form.tools
      ? form.tools
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    description: form.description || undefined,
    tags: form.tags
      ? form.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    enabled: props.config.enabled,
  };

  emit("update:config", config);
}
</script>

<template>
  <div class="mcp-config-editor">
    <!-- Transport -->
    <div class="form-group">
      <label class="form-label">Transport</label>
      <div class="transport-selector">
        <button
          v-for="opt in transportOptions"
          :key="opt.value"
          class="transport-btn"
          :class="{ active: form.transport === opt.value }"
          type="button"
          @click="form.transport = opt.value; emitUpdate()"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Command -->
    <div class="form-group">
      <label class="form-label" for="mcp-command">Command</label>
      <input
        id="mcp-command"
        v-model="form.command"
        type="text"
        class="form-input"
        placeholder="e.g., npx, python, node"
        @input="emitUpdate"
      />
    </div>

    <!-- Args -->
    <div class="form-group">
      <label class="form-label" for="mcp-args">Arguments <span class="form-hint">(comma-separated)</span></label>
      <input
        id="mcp-args"
        v-model="form.args"
        type="text"
        class="form-input"
        placeholder="e.g., -y, @modelcontextprotocol/server-filesystem, /path"
        @input="emitUpdate"
      />
    </div>

    <!-- URL (SSE/Streamable) -->
    <div v-if="showUrl" class="form-group">
      <label class="form-label" for="mcp-url">URL</label>
      <input
        id="mcp-url"
        v-model="form.url"
        type="text"
        class="form-input"
        placeholder="https://example.com/mcp"
        @input="emitUpdate"
      />
    </div>

    <!-- HTTP Headers (for remote transports) -->
    <div v-if="showUrl" class="form-group">
      <div class="form-label-row">
        <label class="form-label">HTTP Headers</label>
        <button class="btn-text" type="button" @click="addHeaderPair">+ Add</button>
      </div>
      <div v-if="form.headerPairs.length > 0" class="env-table">
        <div v-for="(pair, idx) in form.headerPairs" :key="idx" class="env-row">
          <input
            v-model="pair.key"
            type="text"
            class="form-input env-key"
            placeholder="Header-Name"
            @input="emitUpdate"
          />
          <input
            v-model="pair.value"
            type="text"
            class="form-input env-value"
            placeholder="value"
            @input="emitUpdate"
          />
          <button
            class="env-remove"
            type="button"
            title="Remove"
            @click="removeHeaderPair(idx)"
          >
            ×
          </button>
        </div>
      </div>
    </div>

    <!-- Tool Filters -->
    <div class="form-group">
      <label class="form-label" for="mcp-tools">Tool Filters <span class="form-hint">(comma-separated, e.g. * for all)</span></label>
      <input
        id="mcp-tools"
        v-model="form.tools"
        type="text"
        class="form-input"
        placeholder="e.g., * or tool-name-1, tool-name-2"
        @input="emitUpdate"
      />
    </div>

    <!-- Environment Variables -->
    <div class="form-group">
      <div class="form-label-row">
        <label class="form-label">Environment Variables</label>
        <button class="btn-text" type="button" @click="addEnvPair">+ Add</button>
      </div>
      <div class="env-table">
        <div v-for="(pair, idx) in form.envPairs" :key="idx" class="env-row">
          <input
            v-model="pair.key"
            type="text"
            class="form-input env-key"
            placeholder="KEY"
            @input="emitUpdate"
          />
          <input
            v-model="pair.value"
            type="text"
            class="form-input env-value"
            placeholder="value"
            @input="emitUpdate"
          />
          <button
            class="env-remove"
            type="button"
            title="Remove"
            @click="removeEnvPair(idx)"
          >
            ×
          </button>
        </div>
      </div>
    </div>

    <!-- Description -->
    <div class="form-group">
      <label class="form-label" for="mcp-description">Description</label>
      <textarea
        id="mcp-description"
        v-model="form.description"
        class="form-input form-textarea"
        placeholder="Optional description of this MCP server"
        rows="2"
        @input="emitUpdate"
      />
    </div>

    <!-- Tags -->
    <div class="form-group">
      <label class="form-label" for="mcp-tags">Tags <span class="form-hint">(comma-separated)</span></label>
      <input
        id="mcp-tags"
        v-model="form.tags"
        type="text"
        class="form-input"
        placeholder="e.g., filesystem, code, productivity"
        @input="emitUpdate"
      />
    </div>
  </div>
</template>

<style scoped>
.mcp-config-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.form-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-hint {
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-tertiary);
}

.form-input {
  padding: 8px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.form-input:focus {
  border-color: var(--accent-emphasis);
}

.form-input::placeholder {
  color: var(--text-placeholder);
}

.form-textarea {
  resize: vertical;
  min-height: 48px;
  font-family: var(--font-family);
}

.transport-selector {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.transport-btn {
  flex: 1;
  padding: 6px 12px;
  background: var(--canvas-default);
  border: none;
  border-right: 1px solid var(--border-default);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.transport-btn:last-child {
  border-right: none;
}

.transport-btn:hover {
  background: var(--border-subtle);
}

.transport-btn.active {
  background: var(--accent-subtle);
  color: var(--accent-fg);
  font-weight: 500;
}

.env-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.env-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.env-key {
  flex: 0 0 140px;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.env-value {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.env-remove {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: 1rem;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast);
}

.env-remove:hover {
  color: var(--danger-fg);
  border-color: var(--danger-muted);
}

.btn-text {
  background: none;
  border: none;
  color: var(--accent-fg);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
}

.btn-text:hover {
  text-decoration: underline;
}
</style>
