<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useClipboard } from "../../composables/useClipboard";
import CodeBlock from "../renderers/CodeBlock.vue";
import JsonTreeNode from "./JsonTreeNode.vue";

const props = withDefaults(
  defineProps<{
    content: string;
    filePath?: string;
    mode?: "tree" | "raw";
    searchQuery?: string;
    activeSearchLine?: number;
    activeSearchColumn?: number;
    /** JSON trees expand all nested objects and arrays by default. */
    expandAll?: boolean;
    /** Show a direct copy action in the Tree/Raw toolbar. */
    showCopy?: boolean;
  }>(),
  { expandAll: true, showCopy: false },
);
const emit = defineEmits<{
  "update:mode": [mode: "tree" | "raw"];
}>();
const { copy, copied } = useClipboard();

const mode = computed({
  get: () => props.mode ?? "tree",
  set: (value: "tree" | "raw") => emit("update:mode", value),
});
const effectiveMode = computed(() => (props.searchQuery?.trim() ? "raw" : mode.value));
const MAX_AUTO_PARSE_BYTES = 512 * 1024;
const parseOptIn = ref(false);
watch(
  () => props.content,
  () => {
    parseOptIn.value = false;
  },
);
const parseAllowed = computed(
  () => props.content.length <= MAX_AUTO_PARSE_BYTES || parseOptIn.value,
);
const parsed = computed(() => {
  if (effectiveMode.value !== "tree" || !parseAllowed.value) {
    return { value: null, error: null };
  }
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
          :class="{ active: effectiveMode === 'tree' }"
          role="radio"
          :aria-checked="effectiveMode === 'tree'"
          @click="mode = 'tree'"
        >
          Tree
        </button>
        <button
          type="button"
          :class="{ active: effectiveMode === 'raw' }"
          role="radio"
          :aria-checked="effectiveMode === 'raw'"
          @click="mode = 'raw'"
        >
          Raw
        </button>
      </div>
      <span v-if="parsed.error" class="structured-viewer__error">Invalid JSON: {{ parsed.error }}</span>
      <span v-else-if="effectiveMode === 'tree' && !parseAllowed" class="structured-viewer__error">
        Large JSON tree is paused above 512 KiB.
      </span>
      <button
        v-if="effectiveMode === 'tree' && content.length > MAX_AUTO_PARSE_BYTES && !parseOptIn"
        type="button"
        class="structured-viewer__opt-in"
        @click="parseOptIn = true"
      >
        Parse anyway
      </button>
      <button
        v-if="showCopy"
        type="button"
        class="structured-viewer__copy"
        :class="{ copied }"
        :title="copied ? 'Copied!' : 'Copy JSON'"
        :aria-label="copied ? 'Copied!' : 'Copy JSON'"
        @click="copy(content)"
      >
        <svg v-if="!copied" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="5" width="9" height="10" rx="1" />
          <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v9a1 1 0 001 1h2" />
        </svg>
        <svg v-else aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 8 6.5 12 13 4" />
        </svg>
      </button>
    </div>

    <div v-if="effectiveMode === 'tree' && parseAllowed && !parsed.error" class="structured-viewer__tree">
      <JsonTreeNode
        :value="parsed.value"
        :initially-expanded="true"
        :expand-all="expandAll"
      />
    </div>
    <CodeBlock
      v-else
      :code="content"
      :file-path="filePath"
      language="json"
      :line-numbers="true"
      :show-language-badge="false"
      :max-lines="10000"
      :fill-height="true"
      :search-query="searchQuery"
      :active-search-line="activeSearchLine"
      :active-search-column="activeSearchColumn"
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

.structured-viewer__opt-in {
  margin-left: auto;
  padding: 3px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--accent-fg);
  cursor: pointer;
  font-size: 0.6875rem;
}

.structured-viewer__copy {
  display: grid;
  width: 24px;
  height: 24px;
  margin-left: auto;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.structured-viewer__copy:hover {
  background: var(--neutral-muted);
  color: var(--text-primary);
}

.structured-viewer__copy.copied {
  color: var(--success-fg);
}

.structured-viewer__copy svg {
  width: 13px;
  height: 13px;
}

.structured-viewer__tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}
</style>
