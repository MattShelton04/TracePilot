<script setup lang="ts">
/**
 * ToolArgsRenderer — dispatcher component for tool call arguments.
 *
 * Arguments are displayed in a collapsible dropdown (collapsed by default)
 * to save space. For tools where the rich result renderer already conveys
 * the argument info (edit, create), args are hidden entirely.
 */

import type { TurnToolCall } from "@tracepilot/types";
import { getToolArgs } from "@tracepilot/types";
import { type Component, computed, ref } from "vue";
import {
  getRendererEntry,
  hasResultRenderer,
  shouldAutoExpandArgs,
  shouldHideArgsWithRichResult,
} from "./registry";

const props = defineProps<{
  tc: TurnToolCall;
  /** Whether rich rendering is enabled for this tool. */
  richEnabled: boolean;
}>();

/**
 * Open by default while the tool is still streaming (so the user can see
 * what command is being run alongside the live stdout) or when the
 * registry marks this tool as auto-expanding (e.g. ask_user). Stays
 * open after completion unless the user collapses it.
 */
const isOpen = ref(props.tc.isComplete === false || shouldAutoExpandArgs(props.tc.toolName));

const entry = computed(() => getRendererEntry(props.tc.toolName));

const activeComponent = computed<Component | null>(() => {
  if (!props.richEnabled) return null;
  return entry.value?.argsComponent ?? null;
});

const hasArgs = computed(() => {
  const a = getToolArgs(props.tc);
  if (Object.keys(a).length > 0) return true;

  const raw = props.tc.arguments;
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.length > 0;
  if (typeof raw === "object") return false;
  if (typeof raw === "string") return raw.length > 0;
  return true;
});

const formattedJson = computed(() => {
  if (!hasArgs.value) return "";
  return JSON.stringify(props.tc.arguments, null, 2);
});

const argsRecord = computed(() => getToolArgs(props.tc));

const argsKeyCount = computed(() => {
  const count = Object.keys(argsRecord.value).length;
  if (count > 0) return count;
  return hasArgs.value ? 1 : 0;
});

/** True when the rich result renderer already shows the args info AND a result exists. */
const shouldHideCompletely = computed(
  () =>
    props.richEnabled &&
    shouldHideArgsWithRichResult(props.tc.toolName) &&
    hasResultRenderer(props.tc.toolName) &&
    !!props.tc.resultContent,
);
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
        <span class="args-toggle-count">{{ argsKeyCount }}</span>
      </button>

      <div v-show="isOpen" class="args-content">
        <!-- Rich args renderer -->
        <component
          v-if="activeComponent"
          :is="activeComponent"
          :args="argsRecord"
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
</style>
