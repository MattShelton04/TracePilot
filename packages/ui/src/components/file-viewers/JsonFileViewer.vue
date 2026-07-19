<script setup lang="ts">
import { computed, ref } from "vue";
import CodeBlock from "../renderers/CodeBlock.vue";
import JsonTreeNode from "./JsonTreeNode.vue";

const props = defineProps<{
  content: string;
  filePath?: string;
}>();

const mode = ref<"tree" | "raw">("tree");
const parsed = computed(() => {
  try {
    return { value: JSON.parse(props.content) as unknown, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});
</script>

<template>
  <div class="structured-viewer">
    <div class="structured-viewer__toolbar">
      <div class="structured-viewer__modes" role="radiogroup" aria-label="JSON view mode">
        <button
          type="button"
          :class="{ active: mode === 'tree' }"
          role="radio"
          :aria-checked="mode === 'tree'"
          @click="mode = 'tree'"
        >
          Tree
        </button>
        <button
          type="button"
          :class="{ active: mode === 'raw' }"
          role="radio"
          :aria-checked="mode === 'raw'"
          @click="mode = 'raw'"
        >
          Raw
        </button>
      </div>
      <span v-if="parsed.error" class="structured-viewer__error">Invalid JSON: {{ parsed.error }}</span>
    </div>

    <div v-if="mode === 'tree' && !parsed.error" class="structured-viewer__tree">
      <JsonTreeNode :value="parsed.value" :initially-expanded="true" />
    </div>
    <CodeBlock
      v-else
      :code="content"
      :file-path="filePath"
      language="json"
      :line-numbers="true"
      :show-language-badge="false"
      :max-lines="5000"
      :fill-height="true"
    />
  </div>
</template>

<style scoped>
.structured-viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.structured-viewer__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-muted);
}

.structured-viewer__modes {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.structured-viewer__modes button {
  padding: 3px 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.6875rem;
}

.structured-viewer__modes button.active {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis);
}

.structured-viewer__error {
  overflow: hidden;
  color: var(--danger-fg);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.structured-viewer__tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}
</style>
