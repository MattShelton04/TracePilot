<script setup lang="ts">
import type { BackgroundTask, BackgroundTaskStatus } from "@tracepilot/client";
import { Badge, formatDuration, formatTime, formatTokens, SectionPanel } from "@tracepilot/ui";
import { Bot, SquareTerminal, Workflow } from "lucide-vue-next";

defineProps<{ tasks: BackgroundTask[] }>();

type BadgeVariant = "success" | "danger" | "warning" | "accent" | "neutral";

const STATUS: Record<BackgroundTaskStatus, { label: string; variant: BadgeVariant }> = {
  running: { label: "Running", variant: "accent" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  stopped: { label: "Stopped", variant: "warning" },
  unknown: { label: "Unknown", variant: "neutral" },
};

const KIND = {
  agent: { label: "Subagent", icon: Bot },
  shell: { label: "Shell", icon: SquareTerminal },
  other: { label: "Task", icon: Workflow },
} as const;

function details(task: BackgroundTask): string[] {
  const parts: string[] = [];
  if (task.durationMs != null) parts.push(formatDuration(task.durationMs));
  if (task.totalTokens != null) parts.push(`${formatTokens(task.totalTokens)} tokens`);
  if (task.toolCalls != null) {
    parts.push(`${task.toolCalls} tool ${task.toolCalls === 1 ? "call" : "calls"}`);
  }
  return parts;
}
</script>

<template>
  <SectionPanel :title="`Background Tasks (${tasks.length})`">
    <ul class="bg-task-list" aria-label="Background tasks">
      <li v-for="task in tasks" :key="task.id" class="bg-task-row" data-testid="background-task">
        <component
          :is="KIND[task.kind].icon"
          :size="16"
          :stroke-width="1.5"
          class="bg-task-icon"
          :aria-label="KIND[task.kind].label"
        />
        <div class="bg-task-main">
          <span class="bg-task-title">{{ task.description ?? task.id }}</span>
          <span v-if="task.summary" class="bg-task-summary">{{ task.summary }}</span>
        </div>
        <span class="bg-task-meta">{{ details(task).join(" · ") }}</span>
        <Badge :variant="STATUS[task.status].variant" size="sm">{{ STATUS[task.status].label }}</Badge>
        <span class="bg-task-time" :title="task.finishedAt ? 'Finished' : 'Started'">
          {{ formatTime(task.finishedAt ?? task.startedAt) }}
        </span>
      </li>
    </ul>
  </SectionPanel>
</template>

<style scoped>
.bg-task-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.bg-task-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto auto 72px;
  align-items: center;
  gap: 8px 12px;
  min-height: 32px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.bg-task-row:last-child {
  border-bottom: none;
}

.bg-task-icon {
  color: var(--text-tertiary);
}

.bg-task-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.bg-task-title,
.bg-task-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bg-task-title {
  font-size: 0.875rem;
  color: var(--text-primary);
}

.bg-task-summary {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.bg-task-meta,
.bg-task-time {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.bg-task-time {
  text-align: right;
}
</style>
