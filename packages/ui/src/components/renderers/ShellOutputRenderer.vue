<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { Terminal } from "lucide-vue-next";
import { computed } from "vue";
import { formatShellInput, parseShellOutput, shellLineTone } from "../../utils/shellOutput";
import { toolCallStatus } from "../../utils/toolCallStatus";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
  isTruncated?: boolean;
  streaming?: boolean;
}>();
const emit = defineEmits<{ "load-full": [] }>();
const terminal = computed(() => parseShellOutput(props.content));
const command = computed(() => (typeof props.args.command === "string" ? props.args.command : ""));
const description = computed(() =>
  typeof props.args.description === "string" ? props.args.description : "",
);
const shellId = computed(() => props.args.shellId ?? props.args.shell_id ?? terminal.value.shellId);
const input = computed(() => (typeof props.args.chars === "string" ? props.args.chars : null));
const mode = computed(() => (typeof props.args.mode === "string" ? props.args.mode : ""));
const status = computed(() => toolCallStatus(props.tc));
const title = computed(() =>
  props.tc.toolName === "read_powershell"
    ? "Read shell"
    : props.tc.toolName === "write_powershell"
      ? "Write to shell"
      : "PowerShell",
);
const processLabel = computed(() => {
  if (terminal.value.exitCode != null) return `Exit ${terminal.value.exitCode}`;
  if (terminal.value.running) return "Process running";
  if (status.value === "pending" && props.streaming && props.content) return "Streaming output";
  return "";
});
const outputLines = computed(() =>
  terminal.value.output ? terminal.value.output.split("\n") : [],
);
const visibleInput = computed(() => formatShellInput(input.value ?? ""));
</script>

<template>
  <RendererShell :tool-name="title" :status="status" :primary-hint="description || undefined" :copy-text="terminal.normalized">
    <template #icon><Terminal :size="16" /></template>
    <div class="shell-output">
      <div v-if="command" class="shell-command-bar">
        <span class="shell-prompt" aria-hidden="true">&gt;</span>
        <code class="shell-command">{{ command }}</code>
      </div>
      <div v-if="shellId != null || mode || processLabel" class="shell-meta">
        <span v-if="shellId != null">Shell <code>{{ shellId }}</code></span>
        <span v-if="mode">{{ mode }}</span>
        <span v-if="processLabel" class="shell-process-state" :class="{ 'shell-process-state--error': terminal.exitCode != null && terminal.exitCode !== 0 }">{{ processLabel }}</span>
      </div>
      <div v-if="input != null" class="shell-input">
        <span class="shell-section-label">Input sent</span>
        <pre>{{ visibleInput || '(empty input)' }}</pre>
      </div>
      <RendererScrollRegion label="output">
        <div class="shell-output-body">
          <div v-for="(line, idx) in outputLines" :key="idx" :class="['shell-line', shellLineTone(line)]">{{ line || ' ' }}</div>
          <div v-if="!outputLines.length" class="shell-empty">{{ status === 'pending' ? 'Waiting for output…' : 'No output returned.' }}</div>
        </div>
      </RendererScrollRegion>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.shell-output { min-width: 0; background: var(--canvas-default); color: var(--text-secondary); }
.shell-command-bar { display: flex; align-items: flex-start; gap: 8px; padding: 12px; background: var(--canvas-inset); border-bottom: 1px solid var(--border-subtle); }
.shell-prompt { color: var(--accent-fg); font-weight: 700; flex-shrink: 0; }
.shell-command { min-width: 0; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-primary); }
.shell-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); font-size: 12px; }
.shell-meta code { font-family: var(--font-mono); overflow-wrap: anywhere; }
.shell-process-state { margin-left: auto; color: var(--text-secondary); }
.shell-process-state--error { color: var(--danger-fg); }
.shell-input { padding: 12px; border-bottom: 1px solid var(--border-subtle); }
.shell-section-label { display: block; margin-bottom: 4px; font-size: 12px; color: var(--text-tertiary); }
.shell-input pre { margin: 0; font-family: var(--font-mono); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.shell-output-body { padding: 12px; font: 13px/1.6 var(--font-mono); }
.shell-line { min-height: 1.6em; white-space: pre-wrap; overflow-wrap: anywhere; }
.shell-empty { color: var(--text-tertiary); font-family: var(--font-sans); }
.term-error { color: var(--danger-fg); }
.term-warning { color: var(--warning-fg); }
.term-success { color: var(--success-fg); }
</style>
