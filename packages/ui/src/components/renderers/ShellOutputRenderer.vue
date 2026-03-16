<script setup lang="ts">
/**
 * ShellOutputRenderer — terminal-style rendering for powershell tool results.
 * Shows command, exit status indicator, and output with terminal styling.
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

const statusIcon = computed(() => {
  if (props.tc.success === true) return "✓";
  if (props.tc.success === false) return "✗";
  return "●";
});

const statusClass = computed(() => {
  if (props.tc.success === true) return "shell-status--success";
  if (props.tc.success === false) return "shell-status--error";
  return "shell-status--pending";
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
      <!-- Command header -->
      <div v-if="command" class="shell-command-bar">
        <span class="shell-prompt">$</span>
        <code class="shell-command">{{ command }}</code>
        <span v-if="mode !== 'sync'" class="shell-mode-badge">{{ mode }}</span>
        <span class="shell-status" :class="statusClass">{{ statusIcon }}</span>
      </div>
      <div v-if="description" class="shell-description">{{ description }}</div>
      <!-- Output -->
      <pre class="shell-output-body">{{ content }}</pre>
    </div>
  </RendererShell>
</template>

<style scoped>
.shell-output {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  background: #0d1117;
  color: #c9d1d9;
}
.shell-command-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
}
.shell-prompt {
  color: #58a6ff;
  font-weight: 700;
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
  font-size: 0.625rem;
  padding: 1px 6px;
  border-radius: 9999px;
  background: rgba(136, 198, 255, 0.15);
  color: #58a6ff;
  flex-shrink: 0;
}
.shell-status {
  font-size: 0.8125rem;
  font-weight: 700;
  flex-shrink: 0;
}
.shell-status--success { color: #3fb950; }
.shell-status--error { color: #f85149; }
.shell-status--pending { color: #d29922; }
.shell-description {
  padding: 4px 12px;
  font-size: 0.6875rem;
  color: #8b949e;
  border-bottom: 1px solid #30363d;
}
.shell-output-body {
  font-size: 0.75rem;
  line-height: 1.5;
  padding: 10px 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 500px;
  overflow: auto;
  color: #c9d1d9;
}
</style>
