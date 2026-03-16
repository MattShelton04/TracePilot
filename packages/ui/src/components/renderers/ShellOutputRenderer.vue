<script setup lang="ts">
/**
 * ShellOutputRenderer — terminal-style rendering for powershell tool results.
 * Shows macOS-style terminal chrome, command with exit status badge,
 * and output with semantic coloring (errors, warnings, success, dim).
 */
import { computed } from "vue";
import type { TurnToolCall } from "@tracepilot/types";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  'load-full': [];
}>();

const command = computed(() =>
  typeof props.args?.command === "string" ? props.args.command : null
);

const description = computed(() =>
  typeof props.args?.description === "string" ? props.args.description : null
);

const mode = computed(() =>
  typeof props.args?.mode === "string" ? props.args.mode : "sync"
);

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

const outputLines = computed<OutputLine[]>(() => {
  if (!props.content) return [];
  return props.content.split("\n").map((line) => {
    const lower = line.toLowerCase();
    if (
      lower.includes("error") ||
      lower.includes("fail") ||
      lower.includes("fatal") ||
      lower.includes("exception") ||
      lower.startsWith("e ")
    ) {
      return { text: line, cls: "term-error" };
    }
    if (
      lower.includes("warning") ||
      lower.includes("warn") ||
      lower.includes("deprecat")
    ) {
      return { text: line, cls: "term-warning" };
    }
    if (
      lower.includes("success") ||
      lower.includes("passed") ||
      lower.includes("✓") ||
      lower.includes("done") ||
      lower.includes("complete")
    ) {
      return { text: line, cls: "term-success" };
    }
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
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  background: #0d1117;
  color: #c9d1d9;
  border-radius: 0 0 6px 6px;
  overflow: hidden;
}

/* ── Terminal title bar with macOS-style dots ── */
.shell-titlebar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
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
  color: #8b949e;
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
  background: #0d1117;
  border-bottom: 1px solid #21262d;
}
.shell-prompt {
  color: #3fb950;
  font-weight: 700;
  font-size: 0.875rem;
  flex-shrink: 0;
}
.shell-command {
  flex: 1;
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e6edf3;
}
.shell-mode-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 9999px;
  background: rgba(136, 198, 255, 0.15);
  color: #58a6ff;
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
  background: rgba(63, 185, 80, 0.15);
  color: #3fb950;
}
.shell-exit--error {
  background: rgba(248, 81, 73, 0.15);
  color: #f85149;
}
.shell-exit--pending {
  background: rgba(210, 153, 34, 0.15);
  color: #d29922;
}

/* ── Output body ── */
.shell-output-body {
  font-size: 0.75rem;
  line-height: 1.5;
  padding: 10px 12px;
  max-height: 500px;
  overflow: auto;
}
.shell-line {
  white-space: pre-wrap;
  word-break: break-word;
}
.shell-line.term-error {
  color: #f85149;
}
.shell-line.term-warning {
  color: #d29922;
}
.shell-line.term-success {
  color: #3fb950;
}
.shell-line.term-dim {
  color: #484f58;
}
</style>
