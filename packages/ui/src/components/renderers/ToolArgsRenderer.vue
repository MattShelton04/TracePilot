<script setup lang="ts">
/**
 * ToolArgsRenderer — dispatcher component for tool call arguments.
 *
 * Arguments are displayed in a collapsible dropdown (collapsed by default)
 * to save space. For tools where the rich result renderer already conveys
 * the argument info (edit, create), args are hidden entirely.
 *
 * When arguments have been truncated for IPC efficiency (`hasTruncatedArgs`),
 * full arguments are lazy-loaded from the backend on first expand.
 */
import { computed, ref, watch, type Component } from "vue";
import type { TurnToolCall } from "@tracepilot/types";
import { getRendererEntry, shouldHideArgsWithRichResult, hasResultRenderer } from "./registry";

const props = defineProps<{
  tc: TurnToolCall;
  /** Whether rich rendering is enabled for this tool. */
  richEnabled: boolean;
  /** Full (un-truncated) arguments loaded from backend, if available. */
  fullArgs?: unknown;
  /** Whether full arguments are currently being loaded. */
  loadingFullArgs?: boolean;
  /** Whether the full arguments load has failed. */
  failedFullArgs?: boolean;
}>();

const emit = defineEmits<{
  'load-full-args': [toolCallId: string];
  'retry-full-args': [toolCallId: string];
}>();

const isOpen = ref(false);

const entry = computed(() => getRendererEntry(props.tc.toolName));

const activeComponent = computed<Component | null>(() => {
  if (!props.richEnabled) return null;
  return entry.value?.argsComponent ?? null;
});

/** Use full args from backend if loaded, otherwise fall back to (possibly truncated) inline args. */
const effectiveArgs = computed(() => props.fullArgs ?? props.tc.arguments);

const hasArgs = computed(() => {
  const a = effectiveArgs.value;
  return a && typeof a === "object" && !Array.isArray(a) && Object.keys(a as object).length > 0;
});

const formattedJson = computed(() => {
  if (!hasArgs.value) return "";
  return JSON.stringify(effectiveArgs.value, null, 2);
});

/** True when the rich result renderer already shows the args info AND a result exists. */
const shouldHideCompletely = computed(() =>
  props.richEnabled
  && shouldHideArgsWithRichResult(props.tc.toolName)
  && hasResultRenderer(props.tc.toolName)
  && (!!props.tc.resultContent || props.tc.isComplete === true)
);

// Auto-load full args on first expand when inline args are truncated
watch(isOpen, (opened) => {
  if (opened && props.tc.hasTruncatedArgs && !props.fullArgs && !props.loadingFullArgs && props.tc.toolCallId) {
    emit('load-full-args', props.tc.toolCallId);
  }
});
</script>

<template>
  <!-- Completely hidden when rich result renderer covers args -->
  <template v-if="!shouldHideCompletely && hasArgs">
    <div class="args-collapsible">
      <button
        type="button"
        class="args-toggle"
        :aria-expanded="isOpen"
        @click="isOpen = !isOpen"
      >
        <span class="args-toggle-icon" :class="{ 'args-toggle-icon--open': isOpen }">▶</span>
        <span class="args-toggle-label">Parameters</span>
        <span v-if="tc.hasTruncatedArgs && !fullArgs" class="args-truncated-badge">truncated</span>
        <span class="args-toggle-count">{{ Object.keys((effectiveArgs as object) ?? {}).length }}</span>
      </button>

      <div v-show="isOpen" class="args-content">
        <!-- Loading indicator when fetching full args -->
        <div v-if="loadingFullArgs" class="args-loading">Loading full arguments…</div>
        <!-- Failed state with retry -->
        <div v-else-if="failedFullArgs && !fullArgs" class="args-failed">
          Failed to load full arguments.
          <button type="button" class="args-retry-btn" @click="tc.toolCallId && emit('retry-full-args', tc.toolCallId)">Retry</button>
        </div>
        <!-- Rich args renderer -->
        <component
          v-else-if="activeComponent"
          :is="activeComponent"
          :args="effectiveArgs as Record<string, unknown>"
          :tc="tc"
        />
        <!-- Fallback: JSON display -->
        <pre v-else class="tool-args-json">{{ formattedJson }}</pre>
      </div>
    </div>
  </template>
</template>

<style scoped>
.args-collapsible {
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
}
.args-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 10px;
  border: none;
  background: var(--canvas-inset);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.6875rem;
  font-weight: 600;
  text-align: left;
  transition: background 0.15s;
}
.args-toggle:hover {
  background: var(--neutral-muted);
  color: var(--text-secondary);
}
.args-toggle-icon {
  font-size: 0.5rem;
  transition: transform 0.15s;
  flex-shrink: 0;
}
.args-toggle-icon--open {
  transform: rotate(90deg);
}
.args-toggle-label {
  flex: 1;
}
.args-toggle-count {
  font-size: 0.5625rem;
  padding: 0 5px;
  border-radius: 9999px;
  background: var(--neutral-muted);
  color: var(--text-tertiary);
}
.args-content {
  border-top: 1px solid var(--border-muted);
}
.tool-args-json {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  padding: 8px 12px;
  max-height: 200px;
  overflow-y: auto;
  margin: 0;
  color: var(--text-secondary);
  background: var(--canvas-default);
}
.args-truncated-badge {
  font-size: 0.5rem;
  padding: 1px 5px;
  border-radius: 9999px;
  background: var(--warning-muted, #fdf0d5);
  color: var(--warning-fg, #9a6700);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.args-loading {
  padding: 8px 12px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-style: italic;
}
.args-failed {
  padding: 8px 12px;
  font-size: 0.75rem;
  color: var(--danger-fg, #d1242f);
}
.args-retry-btn {
  margin-left: 8px;
  padding: 2px 8px;
  font-size: 0.6875rem;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 4px);
  background: var(--canvas-default);
  color: var(--text-secondary);
  cursor: pointer;
}
.args-retry-btn:hover {
  background: var(--neutral-muted);
}
</style>
