<script setup lang="ts">
import type { McpTool } from "@tracepilot/types";
import { computed, ref } from "vue";

import { formatCompactNumber } from "@/utils/numberFormatting";

const props = defineProps<{
  tools: McpTool[];
}>();

const search = ref("");

const filteredTools = computed(() => {
  if (!search.value) return props.tools;
  const q = search.value.toLowerCase();
  return props.tools.filter(
    (t) => t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
  );
});
</script>

<template>
  <div class="mcp-tool-list">
    <div v-if="tools.length > 5" class="tool-search">
      <input
        v-model="search"
        type="text"
        class="tool-search-input"
        placeholder="Filter tools…"
      />
    </div>

    <div v-if="filteredTools.length === 0" class="tool-empty">
      <span v-if="tools.length === 0" class="text-tertiary">No tools discovered</span>
      <span v-else class="text-tertiary">No matching tools</span>
    </div>

    <div v-for="tool in filteredTools" :key="tool.name" class="tool-item">
      <div class="tool-header">
        <code class="tool-name">{{ tool.name }}</code>
        <span class="tool-tokens" :title="`${tool.estimatedTokens.toLocaleString()} estimated tokens`">
          {{ formatCompactNumber(tool.estimatedTokens) }} tok
        </span>
      </div>
      <p v-if="tool.description" class="tool-description">{{ tool.description }}</p>
    </div>
  </div>
</template>

<style scoped>
.mcp-tool-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-search {
  margin-bottom: 8px;
}

.tool-search-input {
  width: 100%;
  padding: 6px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.tool-search-input:focus {
  border-color: var(--accent-emphasis);
}

.tool-search-input::placeholder {
  color: var(--text-placeholder);
}

.tool-empty {
  padding: 16px;
  text-align: center;
  font-size: 0.8125rem;
}

.text-tertiary {
  color: var(--text-tertiary);
}

.tool-item {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  transition: background-color var(--transition-fast);
}

.tool-item:hover {
  background: var(--border-subtle);
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tool-name {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--accent-fg);
}

.tool-tokens {
  font-size: 0.6875rem;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.tool-description {
  margin: 2px 0 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
