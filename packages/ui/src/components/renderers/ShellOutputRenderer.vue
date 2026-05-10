<script setup lang="ts">
/**
 * ShellOutputRenderer — terminal-style rendering for powershell tool results.
 * Shows command with exit status badge, and output with semantic coloring.
 */

import type { TurnToolCall } from "@tracepilot/types";
import { Terminal } from "lucide-vue-next";
import { computed } from "vue";
import RendererShell, { type RendererShellStatus } from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const command = computed(() =>
  typeof props.args?.command === "string" ? props.args.command : null,
);

const description = computed(() =>
  typeof props.args?.description === "string" ? props.args.description : null,
);

const mode = computed(() => (typeof props.args?.mode === "string" ? props.args.mode : "sync"));

const status = computed<RendererShellStatus>(() =>
  props.tc?.success === true ? "success" : props.tc?.success === false ? "error" : "pending",
);

const exitLabel = computed(() => {
  if (props.tc.success === true) return "exit 0";
  if (props.tc.success === false) return "error";
  return "running";
});

const exitClass = computed(() => {
  if (props.tc.success === true) return "shell-exit--success";
  if (props.tc.success === false) return "shell-exit--error";
  return "shell-exit--pending";
});

const primaryHint = computed(() => {
  if (description.value) return description.value;
  if (command.value) {
    return command.value.length > 60 ? `${command.value.slice(0, 60)}…` : command.value;
  }
  return undefined;
});

interface OutputLine {
  text: string;
  cls: string;
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?:^|[\\s:=,;|/\\\\()])${word}(?:[\\s:=,;|/\\\\()]|$)`, "i").test(text);
}

function isErrorLine(line: string): boolean {
  const lower = line.toLowerCase();
  if (/\berror[\s:[\]]/i.test(line)) return true;
  if (hasWord(lower, "fail") || hasWord(lower, "failed") || hasWord(lower, "failure")) return true;
  if (hasWord(lower, "fatal")) return true;
  if (hasWord(lower, "exception")) return true;
  if (lower.startsWith("e ")) return true;
  if (/\b0\s+errors?\b/i.test(line)) return false;
  return false;
}

function isWarningLine(line: string): boolean {
  if (/\bwarning[\s:[\]]/i.test(line)) return true;
  if (hasWord(line.toLowerCase(), "deprecat")) return true;
  return false;
}

function isSuccessLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    hasWord(lower, "success") ||
    hasWord(lower, "passed") ||
    /\bdone\b/i.test(line) ||
    /\bcomplete(?:d)?\b/i.test(line)
  );
}

const outputLines = computed<OutputLine[]>(() => {
  if (!props.content) return [];
  return props.content.split("\n").map((line) => {
    if (isErrorLine(line)) return { text: line, cls: "term-error" };
    if (isWarningLine(line)) return { text: line, cls: "term-warning" };
    if (isSuccessLine(line)) return { text: line, cls: "term-success" };
    if (line.trim() === "" || line.startsWith("#") || line.startsWith("//")) {
      return { text: line, cls: "term-dim" };
    }
    return { text: line, cls: "" };
  });
});
</script>

<template>
  <RendererShell
    tool-name="Shell"
    :status="status"
    :primary-hint="primaryHint"
    :copy-text="content"
  >
    <template #icon><Terminal :size="16" /></template>
    <div class="shell-output">
      <div v-if="command" class="shell-command-bar">
        <span class="shell-prompt">&gt;</span>
        <code class="shell-command">{{ command }}</code>
        <span v-if="mode !== 'sync'" class="shell-mode-badge">{{ mode }}</span>
        <span class="shell-exit-badge" :class="exitClass">{{ exitLabel }}</span>
      </div>

      <div class="shell-output-body">
        <div v-for="(line, idx) in outputLines" :key="idx" :class="['shell-line', line.cls]">{{ line.text }}</div>
        <div v-if="outputLines.length === 0" class="shell-line term-dim">(no output)</div>
      </div>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.shell-output {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  background: var(--canvas-default);
  color: var(--text-secondary);
  overflow: hidden;
}

.shell-command-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--canvas-inset);
  border-bottom: 1px solid var(--border-muted);
}
.shell-prompt {
  color: var(--success-fg);
  font-weight: 700;
  font-size: 0.875rem;
  flex-shrink: 0;
}
.shell-command {
  flex: 1;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
}
.shell-mode-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 9999px;
  background: var(--accent-muted);
  color: var(--accent-fg);
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.shell-exit-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 9999px;
  flex-shrink: 0;
}
.shell-exit--success {
  background: var(--success-subtle);
  color: var(--success-fg);
}
.shell-exit--error {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}
.shell-exit--pending {
  background: var(--warning-subtle);
  color: var(--warning-fg);
}

.shell-output-body {
  font-size: 0.75rem;
  line-height: 1.5;
  padding: 10px 12px;
  max-height: 500px;
  overflow: auto;
  background: var(--canvas-default);
}
.shell-line {
  white-space: pre-wrap;
  word-break: break-word;
}
.shell-line.term-error { color: var(--danger-fg); }
.shell-line.term-warning { color: var(--warning-fg); }
.shell-line.term-success { color: var(--success-fg); }
.shell-line.term-dim { color: var(--text-tertiary); }

</style>
