<script setup lang="ts">
/**
 * ToolArgsRenderer — dispatcher component for tool call arguments.
 *
 * Arguments are displayed in a collapsible dropdown (collapsed by default)
 * to save space. Complete parameters remain available even when the rich
 * result already conveys the primary input (such as edit and create).
 */

import type { TurnToolCall } from "@tracepilot/types";
import { getToolArgs } from "@tracepilot/types";
import { ChevronRight } from "lucide-vue-next";
import { type Component, computed, ref, useId, watch } from "vue";
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
 * registry marks this tool as auto-expanding (e.g. ask_user). Collapse after
 * a rich result completes unless the user has chosen the disclosure state.
 */
const startsOpen = () =>
  props.tc.isComplete === false ||
  (!props.tc.isComplete && shouldAutoExpandArgs(props.tc.toolName));
const isOpen = ref(startsOpen());
const userToggled = ref(false);
const contentId = useId();
watch(
  () => props.tc.toolCallId ?? props.tc.toolName,
  () => {
    isOpen.value = startsOpen();
    userToggled.value = false;
  },
);
watch(
  () => props.tc.isComplete,
  (complete) => {
    if (complete && !userToggled.value && props.richEnabled && hasResultRenderer(props.tc.toolName))
      isOpen.value = false;
  },
);
function toggleParameters() {
  userToggled.value = true;
  isOpen.value = !isOpen.value;
}

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
  if (typeof props.tc.arguments === "string") return props.tc.arguments;
  return JSON.stringify(props.tc.arguments, null, 2);
});

const argsRecord = computed(() => getToolArgs(props.tc));

const argsKeyCount = computed(() => {
  const count = Object.keys(argsRecord.value).length;
  if (count > 0) return count;
  return hasArgs.value ? 1 : 0;
});

/** True when the rich result renderer already shows the args info AND a result exists. */
const preferRawParameters = computed(
  () =>
    props.richEnabled &&
    shouldHideArgsWithRichResult(props.tc.toolName) &&
    hasResultRenderer(props.tc.toolName) &&
    (props.tc.resultContent != null || props.tc.isComplete),
);
</script>

<template>
  <template v-if="hasArgs">
    <div class="args-collapsible">
      <button
        type="button"
        class="args-toggle"
        :aria-expanded="isOpen"
        :aria-controls="contentId"
        @click="toggleParameters"
      >
        <ChevronRight :size="14" class="args-toggle-icon" :class="{ 'args-toggle-icon--open': isOpen }" aria-hidden="true" />
        <span class="args-toggle-label">Parameters</span>
        <span class="args-toggle-count">{{ argsKeyCount }}</span>
      </button>

      <div v-if="isOpen" :id="contentId" class="args-content">
        <!-- Rich args renderer -->
        <component
          v-if="activeComponent && !preferRawParameters"
          :is="activeComponent"
          :args="argsRecord"
          :tc="tc"
        />
        <!-- Fallback: JSON display -->
        <pre v-else class="tool-args-json" tabindex="0" aria-label="Complete tool parameters">{{ formattedJson }}</pre>
        <details v-if="activeComponent && !preferRawParameters" class="args-raw">
          <summary>All parameters</summary>
          <pre class="tool-args-json" tabindex="0">{{ formattedJson }}</pre>
        </details>
      </div>
    </div>
  </template>
</template>

<style scoped>
.args-collapsible {
  min-width: 0;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
}
.args-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: var(--canvas-inset);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 12px;
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
  font-size: 11px;
  padding: 0 5px;
  border-radius: 9999px;
  background: var(--neutral-muted);
  color: var(--text-tertiary);
}
.args-content {
  border-top: 1px solid var(--border-muted);
}
.tool-args-json {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  padding: 8px 12px;
  max-height: 320px;
  overflow-y: auto;
  margin: 0;
  color: var(--text-secondary);
  background: var(--canvas-default);
}
.args-raw { border-top: 1px solid var(--border-subtle); }
.args-raw summary { padding: 8px 12px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.args-toggle:focus-visible, .args-raw summary:focus-visible, .tool-args-json:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: -2px; }
</style>
