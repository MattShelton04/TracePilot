<script setup lang="ts">
import type { McpServerConfig } from "@tracepilot/types";
import { useToast } from "@tracepilot/ui";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import McpConfigEditor from "@/components/mcp/McpConfigEditor.vue";
import McpStatusDot from "@/components/mcp/McpStatusDot.vue";
import { useMcpStore } from "@/stores/mcp";

const route = useRoute();
const router = useRouter();
const store = useMcpStore();
const { success: toastSuccess, error: toastError } = useToast();

const serverName = computed(() => route.params.name as string);
const saving = ref(false);
const deleting = ref(false);
const healthChecking = ref(false);
const toolSearch = ref("");
const revealedKeys = ref(new Set<string>());
const expandedTools = ref(new Set<string>());

const editing = ref(false);
const editName = ref("");
const editConfig = ref<McpServerConfig>({} as McpServerConfig);

const server = computed(() => store.getServerDetail(serverName.value));

const healthStatus = computed(() => server.value?.health?.status ?? ("unknown" as const));

const statusText = computed(() => {
  const s = server.value?.health?.status;
  if (s === "healthy") return "Connected";
  if (s === "unreachable") return "Error";
  if (s === "degraded") return "Degraded";
  return "Unknown";
});

const statusColor = computed(() => {
  const s = server.value?.health?.status;
  if (s === "healthy") return "success";
  if (s === "unreachable" || s === "degraded") return "danger";
  return "neutral";
});

const statusDotClass = computed(() => {
  const s = server.value?.health?.status;
  if (s === "healthy") return "dot-connected";
  if (s === "unreachable" || s === "degraded") return "dot-error";
  return "";
});

const latencyDisplay = computed(() => {
  const ms = server.value?.health?.latencyMs;
  if (ms == null) return null;
  return ms;
});

const lastCheckedDisplay = computed(() => {
  const at = server.value?.health?.checkedAt;
  if (!at) return "Never";
  try {
    return new Date(at).toLocaleString();
  } catch {
    return at;
  }
});

const transportLabel = computed(() => server.value?.config.type ?? "stdio");

const iconLetter = computed(() => server.value?.name.charAt(0).toUpperCase() ?? "?");

const envEntries = computed(() => {
  const env = server.value?.config.env;
  if (!env) return [];
  return Object.entries(env);
});

const configToolFilters = computed(() => server.value?.config.tools ?? []);

const configHeaders = computed(() => {
  const h = server.value?.config.headers;
  if (!h) return [];
  return Object.entries(h);
});

const filteredTools = computed(() => {
  if (!server.value) return [];
  const tools = server.value.tools;
  if (!toolSearch.value) return tools;
  const q = toolSearch.value.toLowerCase();
  return tools.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      (t.description ?? "").toLowerCase().includes(q),
  );
});

const tokensFormatted = computed(() => {
  const t = server.value?.totalTokens ?? 0;
  return t >= 1000 ? `~${(t / 1000).toFixed(1)}k` : `~${t}`;
});

onMounted(async () => {
  if (store.serverList.length === 0) {
    await store.loadServers();
  }
});

function toggleReveal(key: string) {
  const next = new Set(revealedKeys.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  revealedKeys.value = next;
}

function toggleToolExpand(toolName: string) {
  const next = new Set(expandedTools.value);
  if (next.has(toolName)) {
    next.delete(toolName);
  } else {
    next.add(toolName);
  }
  expandedTools.value = next;
}

async function handleCheckHealth() {
  healthChecking.value = true;
  await store.checkServerHealth(serverName.value);
  healthChecking.value = false;
}

async function handleDelete() {
  deleting.value = true;
  const ok = await store.removeServer(serverName.value);
  deleting.value = false;
  if (ok) {
    toastSuccess(`Server "${serverName.value}" removed`);
    router.push({ name: "mcp-manager" });
  } else {
    toastError(store.error ?? "Failed to remove server");
  }
}

function handleExportJson() {
  if (!server.value) return;
  const config = { [server.value.name]: server.value.config };
  const json = JSON.stringify({ mcpServers: config }, null, 2);
  navigator.clipboard
    .writeText(json)
    .then(() => toastSuccess("JSON copied to clipboard"))
    .catch(() => toastError("Failed to copy to clipboard"));
}

function startEditing() {
  if (!server.value) return;
  editName.value = serverName.value;
  editConfig.value = JSON.parse(JSON.stringify(server.value.config));
  editing.value = true;
}

function cancelEditing() {
  editing.value = false;
}

function onEditConfigUpdate(config: McpServerConfig) {
  editConfig.value = config;
}

async function handleSave() {
  const trimmedName = editName.value.trim();
  if (!trimmedName) {
    toastError("Server name cannot be empty");
    return;
  }

  saving.value = true;
  try {
    const nameChanged = trimmedName !== serverName.value;
    if (nameChanged) {
      // Add new entry first, then remove old — prevents data loss if add fails
      const addOk = await store.addServer(trimmedName, editConfig.value);
      if (!addOk) {
        toastError(store.error ?? "Failed to add renamed server");
        return;
      }
      const removeOk = await store.removeServer(serverName.value);
      if (!removeOk) {
        // Rollback: remove the new entry we just added
        await store.removeServer(trimmedName);
        toastError(store.error ?? "Failed to remove old server entry");
        return;
      }
    } else {
      const ok = await store.updateServer(serverName.value, editConfig.value);
      if (!ok) {
        toastError(store.error ?? "Failed to update server");
        return;
      }
    }
    await store.loadServers();
    editing.value = false;
    toastSuccess(`Server "${trimmedName}" updated`);
    if (nameChanged) {
      router.replace({ name: "mcp-server-detail", params: { name: trimmedName } });
    }
  } catch (err: unknown) {
    toastError(err instanceof Error ? err.message : "Save failed");
  } finally {
    saving.value = false;
  }
}

function goBack() {
  router.push({ name: "mcp-manager" });
}
</script>

<template>
  <div class="mcp-detail-view">
    <!-- Top Bar -->
    <div class="detail-topbar">
      <button class="back-link" @click="goBack">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>
        Back to MCP Servers
      </button>
      <div class="topbar-spacer" />
      <div class="topbar-actions">
        <span class="text-caption">{{ lastCheckedDisplay }}</span>
      </div>
    </div>

    <!-- Not found -->
    <div v-if="!server && !store.loading" class="not-found">
      <p>The server "{{ serverName }}" was not found.</p>
      <button class="btn-secondary" @click="goBack">Back to MCP Servers</button>
    </div>

    <!-- Split Layout -->
    <div v-if="server" class="split-wrapper">
      <!-- Left Panel -->
      <div class="panel-left">
        <!-- Server Header -->
        <div class="detail-server-header">
          <div class="detail-server-icon">{{ iconLetter }}</div>
          <div class="server-meta">
            <div class="detail-server-name">{{ serverName }}</div>
            <div class="detail-badges">
              <span class="status-badge-detail" :style="{ color: `var(--${statusColor}-fg)` }">
                <span class="status-dot-sm" :class="statusDotClass" />
                {{ statusText }}
              </span>
            </div>
          </div>
        </div>

        <!-- Connection Config -->
        <div class="config-section">
          <div class="config-section-title">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 8h3m6 0h3M8 2v3m0 6v3"/><circle cx="8" cy="8" r="2.5"/></svg>
            Connection
            <button v-if="!editing" class="btn-edit-inline" title="Edit configuration" @click="startEditing">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>
            </button>
          </div>

          <!-- Editing mode -->
          <template v-if="editing">
            <div class="edit-name-group">
              <label class="edit-name-label" for="edit-server-name">Server Name</label>
              <input
                id="edit-server-name"
                v-model="editName"
                type="text"
                class="edit-name-input"
                placeholder="Server name"
              />
            </div>
            <McpConfigEditor
              :config="editConfig"
              :server-name="serverName"
              @update:config="onEditConfigUpdate"
            />
            <div class="edit-actions">
              <button class="btn btn-primary" :disabled="saving" @click="handleSave">
                <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l4 4 8-8"/></svg>
                {{ saving ? "Saving…" : "Save" }}
              </button>
              <button class="btn" :disabled="saving" @click="cancelEditing">
                Cancel
              </button>
            </div>
          </template>

          <!-- Read-only mode -->
          <template v-else>
            <div class="config-card">
              <div class="config-row">
                <div class="config-label">Transport</div>
                <div class="config-value">
                  <span class="transport-badge">{{ transportLabel }}</span>
                </div>
              </div>
              <template v-if="server.config.type !== 'sse' && server.config.type !== 'http' && server.config.type !== 'streamable-http'">
                <div v-if="server.config.command" class="config-row">
                  <div class="config-label">Command</div>
                  <div class="config-value">
                    <code class="config-code">{{ server.config.command }}</code>
                  </div>
                </div>
                <div v-if="server.config.args?.length" class="config-row">
                  <div class="config-label">Args</div>
                  <div class="config-value">
                    <div class="tag-list">
                      <span v-for="arg in server.config.args" :key="arg" class="tag">{{ arg }}</span>
                    </div>
                  </div>
                </div>
              </template>
              <template v-else>
                <div v-if="server.config.url" class="config-row">
                  <div class="config-label">URL</div>
                  <div class="config-value">
                    <code class="config-code">{{ server.config.url }}</code>
                  </div>
                </div>
              </template>
              <div v-if="server.config.description" class="config-row">
                <div class="config-label">Description</div>
                <div class="config-value config-desc">{{ server.config.description }}</div>
              </div>
            </div>
          </template>
        </div>

        <!-- Tool Filters (read-only, hidden while editing) -->
        <div v-if="configToolFilters.length > 0 && !editing" class="config-section">
          <div class="config-section-title">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 3h12l-5 6v4l-2 1V9L2 3z"/></svg>
            Tool Filters
          </div>
          <div class="config-card">
            <div class="config-row">
              <div class="config-label">Patterns</div>
              <div class="config-value">
                <div class="tag-list">
                  <span v-for="pat in configToolFilters" :key="pat" class="tag tag-mono">{{ pat }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- HTTP Headers (read-only, hidden while editing) -->
        <div v-if="configHeaders.length > 0 && !editing" class="config-section">
          <div class="config-section-title">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h8"/></svg>
            HTTP Headers
          </div>
          <div class="config-card">
            <table class="env-table">
              <tr v-for="[key, value] in configHeaders" :key="key">
                <td><span class="env-key">{{ key }}</span></td>
                <td>
                  <div class="env-value-wrap">
                    <span class="env-value" :class="{ revealed: revealedKeys.has('h:' + key) }">
                      {{ revealedKeys.has('h:' + key) ? value : "••••••••" }}
                    </span>
                    <button class="toggle-vis" title="Show/hide" @click="toggleReveal('h:' + key)">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            </table>
          </div>
        </div>

        <!-- Environment Variables (read-only, hidden while editing) -->
        <div v-if="envEntries.length > 0 && !editing" class="config-section">
          <div class="config-section-title">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 6h1m4 0h1M5 10h6"/></svg>
            Environment Variables
          </div>
          <div class="config-card">
            <table class="env-table">
              <tr v-for="[key, value] in envEntries" :key="key">
                <td><span class="env-key">{{ key }}</span></td>
                <td>
                  <div class="env-value-wrap">
                    <span class="env-value" :class="{ revealed: revealedKeys.has(key) }">
                      {{ revealedKeys.has(key) ? value : "••••••••" }}
                    </span>
                    <button class="toggle-vis" title="Show/hide" @click="toggleReveal(key)">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            </table>
          </div>
        </div>

        <!-- Actions -->
        <div class="config-section">
          <div class="config-section-title">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 8h2l2-4 3 8 2-4h3"/></svg>
            Actions
          </div>
          <div class="actions-row">
            <button class="btn" :disabled="healthChecking" @click="handleCheckHealth">
              <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" :class="{ spinning: healthChecking }"><path d="M2 8h2l2-4 3 8 2-4h3"/></svg>
              {{ healthChecking ? "Testing…" : "Test Connection" }}
            </button>
            <button class="btn" @click="handleExportJson">
              <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 10v3h8v-3M8 2v8M5 5l3-3 3 3"/></svg>
              Export JSON
            </button>
          </div>
        </div>

        <!-- Danger Zone -->
        <div class="danger-zone">
          <div class="danger-zone-text">
            <div class="danger-zone-title">Remove Server</div>
            <div class="danger-zone-desc">
              This will remove the server configuration and disconnect all active sessions.
            </div>
          </div>
          <button class="btn btn-danger-action" :disabled="deleting" @click="handleDelete">
            <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5"/><path d="M3 4l1 9a2 2 0 002 2h4a2 2 0 002-2l1-9"/></svg>
            {{ deleting ? "Removing…" : "Remove" }}
          </button>
        </div>
      </div>

      <!-- Right Panel -->
      <div class="panel-right">
        <!-- Tools -->
        <div>
          <div class="tools-header">
            <div>
              <span class="tools-title">Tools</span>
              <span class="tools-count">{{ server.tools.length }} tools available</span>
            </div>
          </div>
          <div v-if="server.tools.length > 5" class="tools-search">
            <input
              v-model="toolSearch"
              type="text"
              class="tools-search-input"
              placeholder="Filter tools…"
            />
          </div>
          <div class="tools-list">
            <div
              v-for="tool in filteredTools"
              :key="tool.name"
              class="tool-item"
              :class="{ expanded: expandedTools.has(tool.name) }"
              @click="toggleToolExpand(tool.name)"
            >
              <div class="tool-header-row">
                <div class="tool-info">
                  <div class="tool-name">{{ tool.name }}</div>
                  <div v-if="tool.description" class="tool-desc" :class="{ 'tool-desc-expanded': expandedTools.has(tool.name) }">{{ tool.description }}</div>
                </div>
                <span class="tool-tokens">~{{ tool.estimatedTokens }} tok</span>
                <svg class="tool-expand-icon" :class="{ rotated: expandedTools.has(tool.name) }" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 4 10 8 6 12"/></svg>
              </div>
              <div v-if="expandedTools.has(tool.name) && tool.inputSchema" class="tool-schema">
                <div class="tool-schema-label">Input Schema</div>
                <pre class="tool-schema-code">{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre>
              </div>
            </div>
            <div v-if="filteredTools.length === 0 && server.tools.length > 0" class="tool-empty">
              No matching tools
            </div>
            <div v-if="server.tools.length === 0" class="tool-empty">
              No tools discovered
            </div>
          </div>
          <div v-if="server.tools.length > 0" class="tools-summary">
            <span><strong>{{ server.tools.length }}</strong> of {{ server.tools.length }} enabled</span>
            <span class="token-cost">~{{ server.totalTokens.toLocaleString() }} estimated tokens</span>
          </div>
        </div>

        <!-- Health Grid -->
        <div>
          <div class="config-section-title" style="margin-top: 4px">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 8h2l2-4 3 8 2-4h3"/></svg>
            Health
          </div>
          <div class="health-grid">
            <div class="health-stat">
              <div class="health-stat-label">Status</div>
              <div class="health-stat-value" :style="{ color: `var(--${statusColor}-fg)` }">
                {{ statusText }}
              </div>
            </div>
            <div class="health-stat">
              <div class="health-stat-label">Response</div>
              <div class="health-stat-value mono">
                <template v-if="latencyDisplay != null">
                  <span class="success-text">{{ latencyDisplay }}</span><span class="unit">ms</span>
                </template>
                <template v-else>—</template>
              </div>
            </div>
            <div class="health-stat">
              <div class="health-stat-label">Tools</div>
              <div class="health-stat-value">
                {{ server.tools.length }}<span class="unit"> total</span>
              </div>
            </div>
            <div class="health-stat">
              <div class="health-stat-label">Context Cost</div>
              <div class="health-stat-value mono" style="color: var(--accent-fg)">
                {{ tokensFormatted }}<span class="unit"> tok</span>
              </div>
            </div>
          </div>

          <div v-if="server.health?.errorMessage" class="health-error">
            <span class="health-error-label">Error</span>
            <code class="health-error-message">{{ server.health.errorMessage }}</code>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-detail-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ─── Top Bar ─── */
.detail-topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 28px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
  background: var(--canvas-subtle);
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  border: none;
  background: none;
}

.back-link:hover {
  color: var(--text-primary);
  background: var(--neutral-subtle);
}

.topbar-spacer { flex: 1; }

.text-caption {
  font-size: 0.75rem;
  color: var(--text-placeholder);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ─── Not Found ─── */
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.btn-secondary {
  padding: 8px 16px;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.btn-secondary:hover {
  color: var(--text-primary);
  background: var(--border-subtle);
}

/* ─── Split Layout ─── */
.split-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.panel-left {
  flex: 1;
  min-width: 380px;
  max-width: 560px;
  overflow-y: auto;
  padding: 24px 28px;
  border-right: 1px solid var(--border-default);
}

.panel-right {
  flex: 1.3;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ─── Server Header ─── */
.detail-server-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 24px;
}

.detail-server-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  flex-shrink: 0;
  color: var(--accent-fg);
  position: relative;
  overflow: hidden;
}

.detail-server-icon::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, transparent 60%);
  pointer-events: none;
}

.server-meta {
  flex: 1;
  min-width: 0;
}

.detail-server-name {
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.3;
  color: var(--text-primary);
}

.detail-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.status-badge-detail {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.6875rem;
  font-weight: 500;
}

.status-dot-sm {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}

.status-dot-sm.dot-connected {
  background: var(--success-fg);
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
}

.status-dot-sm.dot-connected::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid rgba(52, 211, 153, 0.25);
  animation: pulse-ring 2.5s ease-out infinite;
}

@keyframes pulse-ring {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.8); }
}

.status-dot-sm.dot-error {
  background: var(--danger-fg);
  box-shadow: 0 0 6px rgba(251, 113, 133, 0.4);
  animation: error-blink 1.5s ease-in-out infinite;
}

@keyframes error-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.status-dot-sm.dot-paused {
  background: var(--warning-fg);
  box-shadow: 0 0 4px rgba(251, 191, 36, 0.3);
}

/* ─── Config Sections ─── */
.config-section {
  margin-bottom: 20px;
}

.config-section-title {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.config-section-title svg {
  opacity: 0.5;
}

.config-card {
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.config-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--transition-fast);
}

.config-row:last-child {
  border-bottom: none;
}

.config-row:hover {
  background: rgba(255, 255, 255, 0.015);
}

.config-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  min-width: 90px;
  flex-shrink: 0;
  padding-top: 1px;
}

.config-value {
  flex: 1;
  min-width: 0;
}

.config-code {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.config-desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.transport-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  font-weight: 600;
  font-family: var(--font-mono);
  background: var(--neutral-muted);
  color: var(--neutral-fg);
  letter-spacing: 0.02em;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: var(--text-primary);
  transition: all var(--transition-fast);
}

.tag:hover {
  border-color: var(--border-accent);
}

/* ─── Env Table ─── */
.env-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.env-table td {
  padding: 8px 12px;
  font-size: 0.8125rem;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.env-table tr:last-child td {
  border-bottom: none;
}

.env-key {
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--warning-fg);
  font-size: 0.75rem;
  white-space: nowrap;
}

.env-value-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.env-value {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
}

.env-value.revealed {
  letter-spacing: 0;
  color: var(--text-primary);
}

.toggle-vis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-placeholder);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.toggle-vis:hover {
  background: var(--neutral-subtle);
  color: var(--text-secondary);
}

/* ─── Actions Row ─── */
.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn:hover {
  color: var(--text-primary);
  border-color: var(--border-accent);
  background: var(--neutral-subtle);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ─── Danger Zone ─── */
.danger-zone {
  border: 1px solid rgba(251, 113, 133, 0.2);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  background: var(--danger-subtle);
  display: flex;
  align-items: center;
  gap: 14px;
}

.danger-zone-text {
  flex: 1;
  min-width: 0;
}

.danger-zone-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--danger-fg);
  margin-bottom: 2px;
}

.danger-zone-desc {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  line-height: 1.45;
}

.btn-danger-action {
  background: transparent;
  border: 1px solid rgba(251, 113, 133, 0.3);
  color: var(--danger-fg);
  white-space: nowrap;
}

.btn-danger-action:hover {
  background: var(--danger-muted);
  border-color: rgba(251, 113, 133, 0.5);
}

/* ─── Tools Panel ─── */
.tools-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tools-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.tools-count {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-left: 6px;
  font-weight: 400;
}

.tools-search {
  margin-bottom: 8px;
}

.tools-search-input {
  width: 100%;
  padding: 6px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast);
  box-sizing: border-box;
}

.tools-search-input:focus {
  border-color: var(--accent-emphasis);
}

.tools-search-input::placeholder {
  color: var(--text-placeholder);
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
}

.tools-list::-webkit-scrollbar { width: 5px; }
.tools-list::-webkit-scrollbar-track { background: transparent; }
.tools-list::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 4px; }

.tool-item {
  padding: 9px 14px;
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--transition-fast);
  cursor: pointer;
}

.tool-item:last-child {
  border-bottom: none;
}

.tool-item:hover {
  background: rgba(255, 255, 255, 0.015);
}

.tool-header-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tool-expand-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform var(--transition-fast);
}

.tool-expand-icon.rotated {
  transform: rotate(90deg);
}

.tool-info {
  flex: 1;
  min-width: 0;
}

.tool-name {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
}

.tool-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-desc-expanded {
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
}

.tool-schema {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-subtle);
}

.tool-schema-label {
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.tool-schema-code {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 1.5;
  color: var(--text-secondary);
  background: var(--canvas-default);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  overflow-x: auto;
  max-height: 200px;
  margin: 0;
}

.tool-tokens {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
  letter-spacing: 0.01em;
}

.tool-empty {
  padding: 16px;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.tools-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 10px;
}

.tools-summary strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.token-cost {
  font-family: var(--font-mono);
  color: var(--accent-fg);
  font-weight: 500;
}

/* ─── Health Grid ─── */
.health-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.health-stat {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  background-image: var(--gradient-card);
}

.health-stat-label {
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}

.health-stat-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.health-stat-value.mono {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.health-stat-value .unit {
  font-size: 0.6875rem;
  font-weight: 400;
  color: var(--text-tertiary);
  margin-left: 2px;
}

.success-text {
  color: var(--success-fg);
}

.health-error {
  padding: 12px;
  background: var(--danger-subtle);
  border: 1px solid var(--danger-muted);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 12px;
}

.health-error-label {
  font-size: 0.6875rem;
  color: var(--danger-fg);
  text-transform: uppercase;
  font-weight: 600;
}

.health-error-message {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--danger-fg);
}

/* ─── Edit Mode ─── */
.btn-edit-inline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-placeholder);
  cursor: pointer;
  margin-left: auto;
  transition: all var(--transition-fast);
}

.btn-edit-inline:hover {
  color: var(--accent-fg);
  border-color: var(--border-default);
  background: var(--neutral-subtle);
}

.edit-name-group {
  margin-bottom: 16px;
}

.edit-name-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 4px;
}

.edit-name-input {
  width: 100%;
  padding: 8px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 600;
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--transition-fast);
}

.edit-name-input:focus {
  border-color: var(--accent-emphasis);
}

.edit-name-input::placeholder {
  color: var(--text-placeholder);
  font-weight: 400;
}

.edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.btn-primary {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
  color: #fff;
}

.btn-primary:hover {
  background: var(--accent-fg);
  border-color: var(--accent-fg);
  color: #fff;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ─── Responsive ─── */
@media (max-width: 900px) {
  .split-wrapper { flex-direction: column; }
  .panel-left { max-width: none; border-right: none; border-bottom: 1px solid var(--border-default); }
  .health-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
