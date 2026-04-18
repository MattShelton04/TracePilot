<script setup lang="ts">
import McpConfigEditor from "@/components/mcp/McpConfigEditor.vue";
import { useMcpServerDetailContext } from "@/composables/useMcpServerDetail";

const {
  server,
  serverName,
  editing,
  editName,
  editConfig,
  saving,
  transportLabel,
  startEditing,
  cancelEditing,
  onEditConfigUpdate,
  handleSave,
} = useMcpServerDetailContext();
</script>

<template>
  <div v-if="server" class="config-section">
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
</template>
