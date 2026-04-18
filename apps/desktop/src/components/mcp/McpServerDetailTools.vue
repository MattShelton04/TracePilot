<script setup lang="ts">
import { useMcpServerDetailContext } from "@/composables/useMcpServerDetail";

const { server, toolSearch, expandedTools, filteredTools, toggleToolExpand } =
  useMcpServerDetailContext();
</script>

<template>
  <div v-if="server">
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
</template>
