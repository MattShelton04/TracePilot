<script setup lang="ts">
import type { McpServerConfig } from "@tracepilot/types";
import { useToast } from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import McpAddServerModal from "@/components/mcp/McpAddServerModal.vue";
import McpServerCard from "@/components/mcp/McpServerCard.vue";
import McpTokenSummary from "@/components/mcp/McpTokenSummary.vue";
import { browseForFile } from "@/composables/useBrowseDirectory";
import { useMcpStore } from "@/stores/mcp";

const store = useMcpStore();
const { success: toastSuccess, error: toastError } = useToast();

const showAddModal = ref(false);
const healthChecking = ref(false);

onMounted(async () => {
  await store.loadServers();
  store.checkHealth().catch(() => {});
});

const searchInput = computed({
  get: () => store.searchQuery,
  set: (v: string) => {
    store.searchQuery = v;
  },
});

/* Stats */
const statsInstalled = computed(() => store.summary.totalServers);
const statsActive = computed(() => store.summary.healthyServers);
const statsError = computed(
  () =>
    store.serverList.filter(
      (s) =>
        s.health?.status === "unreachable" || s.health?.status === "degraded",
    ).length,
);

async function handleAddServer(name: string, config: McpServerConfig) {
  const ok = await store.addServer(name, config);
  if (ok) {
    showAddModal.value = false;
    toastSuccess(`Server "${name}" added`);
  } else {
    toastError(store.error ?? "Failed to add server");
  }
}

async function handleToggle(name: string) {
  await store.toggleServer(name);
}

async function handleRemove(name: string) {
  const ok = await store.removeServer(name);
  if (ok) {
    toastSuccess(`Server "${name}" removed`);
  } else {
    toastError(store.error ?? "Failed to remove server");
  }
}

async function handleRefreshHealth() {
  healthChecking.value = true;
  await store.checkHealth();
  healthChecking.value = false;
}

function toggleTag(tag: string) {
  const idx = store.filterTags.indexOf(tag);
  if (idx >= 0) {
    store.filterTags.splice(idx, 1);
  } else {
    store.filterTags.push(tag);
  }
}

async function handleImport() {
  const path = await browseForFile({
    title: "Select MCP configuration file",
    filters: [
      { name: "JSON Files", extensions: ["json"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (!path) return;
  const result = await store.importFromFile(path);
  if (result) {
    toastSuccess(`Imported ${Object.keys(result.servers).length} server(s) from ${result.sourceLabel}`);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        toastError(w);
      }
    }
  } else {
    toastError(store.error ?? "Import failed");
  }
}
</script>

<template>
  <div class="page-content">
  <div class="page-content-inner">
  <div class="mcp-manager-view">
    <!-- Page Title Row -->
    <div class="page-title-row">
      <h1>
        <span class="title-icon">🔌</span>
        MCP Servers
      </h1>
      <div class="title-actions">
        <button class="btn-import" @click="handleImport">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 10v3h8v-3M8 2v8M5 5l3-3 3 3"/></svg>
          Import
        </button>
        <button class="btn-add-server" @click="showAddModal = true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
          Add Server
        </button>
      </div>
    </div>

    <!-- Stats Strip -->
    <div v-if="store.summary.totalServers > 0" class="stats-strip">
      <span class="stat-chip"><span class="stat-dot installed" />{{ statsInstalled }} Installed</span>
      <span class="stat-sep">·</span>
      <span class="stat-chip"><span class="stat-dot active" />{{ statsActive }} Active</span>
      <span class="stat-sep">·</span>
      <span class="stat-chip"><span class="stat-dot error" />{{ statsError }} Error</span>
    </div>

    <!-- Token Usage Summary -->
    <McpTokenSummary
      v-if="store.summary.totalServers > 0"
      :tokens="store.summary.totalTokens"
      :tools="store.summary.totalTools"
      :servers="store.summary.enabledServers"
    />

    <!-- Filter Bar -->
    <div class="filter-bar">
      <div class="search-container">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z"/>
        </svg>
        <input
          v-model="searchInput"
          type="text"
          class="search-input"
          placeholder="Search servers…"
        />
      </div>
      <button
        class="btn-icon-sm"
        title="Refresh health"
        :disabled="healthChecking"
        @click="handleRefreshHealth"
      >
        <svg
          width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round"
          :class="{ spinning: healthChecking }"
        >
          <path d="M14 8a6 6 0 1 1-6-6c1.7 0 3.3.7 4.5 1.8L14 5.5" />
          <path d="M14 1.5v4h-4" />
        </svg>
      </button>
    </div>

    <!-- Tag filters -->
    <div v-if="store.allTags.length > 0" class="tag-filters">
      <button
        v-for="tag in store.allTags"
        :key="tag"
        class="tag-filter-btn"
        :class="{ active: store.filterTags.includes(tag) }"
        @click="toggleTag(tag)"
      >
        {{ tag }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="store.error" class="error-banner">
      <span>{{ store.error }}</span>
      <button class="error-dismiss" @click="store.error = null">×</button>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="loading-state">
      <div class="loading-spinner" />
      <span>Loading servers…</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="store.summary.totalServers === 0" class="empty-state">
      <div class="empty-hero">
        <div class="empty-icon">
          <svg width="56" height="56" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="12" height="5" rx="1" />
            <rect x="2" y="9" width="12" height="5" rx="1" />
            <circle cx="4.5" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
            <line x1="7" y1="4.5" x2="12" y2="4.5" stroke-width="0.6" />
            <line x1="7" y1="11.5" x2="12" y2="11.5" stroke-width="0.6" />
          </svg>
        </div>
        <h2 class="empty-title">No MCP servers configured</h2>
        <p class="empty-description">
          MCP servers extend your AI assistant with external tools — databases, APIs, file systems, and more.
          Add a server manually or import an existing configuration.
        </p>
        <div class="empty-actions">
          <button class="btn-add-server" @click="showAddModal = true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            Add Server
          </button>
          <button class="btn-import" @click="handleImport">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 10v3h8v-3M8 2v8M5 5l3-3 3 3"/></svg>
            Import Config
          </button>
        </div>
        <div class="empty-features">
          <div class="feature-item">
            <span class="feature-dot" />
            <span>Manage stdio, SSE, and HTTP servers</span>
          </div>
          <div class="feature-item">
            <span class="feature-dot" />
            <span>Monitor health and tool availability</span>
          </div>
          <div class="feature-item">
            <span class="feature-dot" />
            <span>Import from VS Code, Claude Desktop, or JSON</span>
          </div>
        </div>
      </div>
    </div>

    <!-- No results -->
    <div v-else-if="store.filteredServers.length === 0" class="empty-state">
      <p class="empty-description">No servers match your search or filters.</p>
    </div>

    <!-- Server grid -->
    <div v-else>
      <div class="section-heading">Installed Servers</div>
      <div class="server-grid">
        <McpServerCard
          v-for="server in store.filteredServers"
          :key="server.name"
          :server="server"
          @toggle="handleToggle"
          @remove="handleRemove"
        />
      </div>
    </div>

    <!-- Add modal -->
    <McpAddServerModal
      v-if="showAddModal"
      @close="showAddModal = false"
      @submit="handleAddServer"
    />
  </div>
  </div>
  </div>
</template>

<style scoped>
.mcp-manager-view {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ─── Page Title Row ─── */
.page-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;
}

.page-title-row h1 {
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
}

.title-icon {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--accent-muted);
  border: 1px solid var(--border-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: var(--accent-fg);
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-add-server {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--gradient-accent);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 6px rgba(99, 102, 241, 0.35);
  transition: all var(--transition-fast);
  letter-spacing: -0.01em;
}

.btn-add-server:hover {
  box-shadow: 0 3px 14px rgba(99, 102, 241, 0.45);
  transform: translateY(-1px);
}

.btn-add-server:active {
  transform: translateY(0);
}

.btn-add-server svg {
  width: 14px;
  height: 14px;
}

.btn-import {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-import:hover {
  color: var(--text-primary);
  border-color: var(--border-accent);
  background: var(--neutral-subtle);
}

/* ─── Stats Strip ─── */
.stats-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 0 2px;
  flex-wrap: wrap;
}

.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.01em;
}

.stat-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stat-dot.installed { background: var(--accent-fg); }
.stat-dot.active    { background: var(--success-fg); }
.stat-dot.paused    { background: var(--warning-fg); }
.stat-dot.error     { background: var(--danger-fg); }

.stat-sep {
  color: var(--text-placeholder);
  font-size: 0.625rem;
  user-select: none;
}

/* ─── Filter Bar ─── */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0 20px;
  flex-wrap: wrap;
}

.search-container {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 260px;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-placeholder);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 7px 10px 7px 32px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.search-input:focus {
  border-color: var(--accent-emphasis);
}

.search-input::placeholder {
  color: var(--text-placeholder);
}

.btn-icon-sm {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast);
}

.btn-icon-sm:hover {
  color: var(--text-primary);
  border-color: var(--accent-emphasis);
}

.btn-icon-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ─── Section Heading ─── */
.section-heading {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-heading::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border-default);
}

/* ─── Tag Filters ─── */
.tag-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 8px;
}

.tag-filter-btn {
  padding: 3px 10px;
  font-size: 0.75rem;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    border-color var(--transition-fast);
}

.tag-filter-btn:hover {
  color: var(--text-secondary);
  background: var(--neutral-muted);
}

.tag-filter-btn.active {
  background: var(--accent-subtle);
  color: var(--accent-fg);
  border-color: var(--accent-emphasis);
}

/* ─── Error ─── */
.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--danger-subtle);
  border: 1px solid var(--danger-muted);
  border-radius: var(--radius-md);
  color: var(--danger-fg);
  font-size: 0.8125rem;
}

.error-dismiss {
  background: none;
  border: none;
  color: var(--danger-fg);
  cursor: pointer;
  font-size: 1.125rem;
  padding: 0 4px;
}

/* ─── Loading ─── */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 0;
  color: var(--text-tertiary);
  font-size: 0.875rem;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-emphasis);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* ─── Empty State ─── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 24px;
}

.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
  text-align: center;
}

.empty-icon {
  color: var(--text-tertiary);
  opacity: 0.4;
  margin-bottom: 4px;
}

.empty-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.02em;
}

.empty-description {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
  max-width: 480px;
}

.empty-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.empty-features {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border-muted);
  width: 100%;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.feature-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-fg);
  flex-shrink: 0;
  opacity: 0.6;
}

/* ─── Server Grid ─── */
.server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 12px;
  margin-bottom: 36px;
}
</style>