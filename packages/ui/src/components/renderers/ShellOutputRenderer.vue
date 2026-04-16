<script setup lang="ts">
/**
 * ShellOutputRenderer — terminal-style rendering for powershell tool results.
 * Shows macOS-style terminal chrome, command with exit status badge,
 * and output with semantic coloring (errors, warnings, success, dim).
 */

import type { TurnToolCall } from "@tracepilot/types";
import { computed } from "vue";
import RendererShell from "./RendererShell.vue";

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

const statusLabel = computed(() => {
  if (props.tc.success === true) return "exit 0";
  if (props.tc.success === false) return "error";
  return "running";
});

const statusClass = computed(() => {
  if (props.tc.success === true) return "shell-exit--success";
  if (props.tc.success === false) return "shell-exit--error";
  return "shell-exit--pending";
});

/** Classify output lines for semantic coloring. */
interface OutputLine {
  text: string;
  cls: string;
}

/** Test if a word appears as a standalone token (word boundary aware). */
function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?:^|[\\s:=,;|/\\\\()])${word}(?:[\\s:=,;|/\\\\()]|$)`, "i").test(text);
}

/** Test if a line looks like a genuine error line (not just a filename containing "error"). */
function isErrorLine(line: string): boolean {
  const lower = line.toLowerCase();
  // Genuine error patterns: "error TS2322:", "ERROR:", "fatal error", "error:", "- error"
  if (/\berror[\s:[\]]/i.test(line)) return true;
  if (hasWord(lower, "fail") || hasWord(lower, "failed") || hasWord(lower, "failure")) return true;
  if (hasWord(lower, "fatal")) return true;
  if (hasWord(lower, "exception")) return true;
  if (lower.startsWith("e ")) return true;
  // Avoid: "0 errors", "error_handler.ts", "found 0 errors"
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
    lower.includes("✓") ||
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
    label="Terminal"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div class="shell-output">
      <!-- Terminal title bar with dots -->
      <div class="shell-titlebar">
        <div class="shell-dots">
          <span class="shell-dot shell-dot--close"></span>
          <span class="shell-dot shell-dot--minimize"></span>
          <span class="shell-dot shell-dot--maximize"></span>
        </div>
        <span v-if="description" class="shell-title">{{ description }}</span>
        <span v-else class="shell-title">Terminal</span>
      </div>

      <!-- Command bar -->
      <div v-if="command" class="shell-command-bar">
        <span class="shell-prompt">❯</span>
        <code class="shell-command">{{ command }}</code>
        <span v-if="mode !== 'sync'" class="shell-mode-badge">{{ mode }}</span>
        <span class="shell-exit-badge" :class="statusClass">{{ statusLabel }}</span>
      </div>

      <!-- Output body with semantic line coloring -->
      <div class="shell-output-body">
        <div v-for="(line, idx) in outputLines" :key="idx" :class="['shell-line', line.cls]">{{ line.text }}</div>
        <div v-if="outputLines.length === 0" class="shell-line term-dim">(no output)</div>
      </div>
    </div>
  </RendererShell>
</template>

<style scoped>
.shell-output {
  --term-bg: var(--canvas-subtle, #0d1117);
  --term-chrome: var(--canvas-inset, #161b22);
  --term-border: var(--border-muted, #30363d);
  --term-text: var(--text-secondary, #c9d1d9);
  --term-strong: var(--text-primary, #e6edf3);
  --term-dim: var(--text-tertiary, #8b949e);
  --term-accent: var(--accent-fg, #58a6ff);
  --term-accent-bg: var(--accent-subtle, rgba(99, 102, 241, 0.1));
  --term-success: var(--success-fg, #3fb950);
  --term-success-bg: var(--success-subtle, rgba(16, 185, 129, 0.1));
  --term-warning: var(--warning-fg, #d29922);
  --term-warning-bg: var(--warning-subtle, rgba(245, 158, 11, 0.1));
  --term-danger: var(--danger-fg, #f85149);
  --term-danger-bg: var(--danger-subtle, rgba(244, 63, 94, 0.1));
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  background: linear-gradient(180deg, var(--term-chrome), var(--term-bg));
  color: var(--term-text);
  border-radius: 0 0 6px 6px;
  overflow: hidden;
}

/* ── Terminal title bar with macOS-style dots ── */
.shell-titlebar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--term-chrome);
  border-bottom: 1px solid var(--term-border);
}
.shell-dots {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.shell-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.shell-dot--close { background: #ff5f57; }
.shell-dot--minimize { background: #febc2e; }
.shell-dot--maximize { background: #28c840; }
.shell-title {
  font-size: 0.6875rem;
  color: var(--term-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Command bar ── */
.shell-command-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--term-bg);
  border-bottom: 1px solid var(--term-border);
}
.shell-prompt {
  color: var(--term-success);
  font-weight: 700;
  font-size: 0.875rem;
  flex-shrink: 0;
}
.shell-command {
  flex: 1;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--term-strong);
}
.shell-mode-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 9999px;
  background: var(--term-accent-bg);
  color: var(--term-accent);
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
  background: var(--term-success-bg);
  color: var(--term-success);
}
.shell-exit--error {
  background: var(--term-danger-bg);
  color: var(--term-danger);
}
.shell-exit--pending {
  background: var(--term-warning-bg);
  color: var(--term-warning);
}

/* ── Output body ── */
.shell-output-body {
  font-size: 0.75rem;
  line-height: 1.5;
  padding: 10px 12px;
  max-height: 500px;
  overflow: auto;
  background: var(--term-bg);
}
.shell-line {
  white-space: pre-wrap;
  word-break: break-word;
}
.shell-line.term-error {
  color: var(--term-danger);
}
.shell-line.term-warning {
  color: var(--term-warning);
}
.shell-line.term-success {
  color: var(--term-success);
}
.shell-line.term-dim {
  color: var(--term-dim);
}
</style>
