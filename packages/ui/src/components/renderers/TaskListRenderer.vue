<script setup lang="ts">
/**
 * TaskListRenderer — Claude's task-list calls (`update_plan`, `wrap_up`,
 * `TodoWrite`, `TaskCreate`, `TaskUpdate`). The checklist, recap or change
 * comes from the call's input; the recorded response stays separate.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { computed } from "vue";
import { useToolCallStatus } from "../../composables/sessionEnded";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import StatusIcon from "../StatusIcon.vue";
import { parseTaskListCall, type TaskStep, UPDATE_PLAN, WRAP_UP } from "./taskList";

const props = defineProps<{
  args: Record<string, unknown>;
  /** Absent when shown as the call's parameters. */
  content?: string;
  tc?: TurnToolCall;
}>();
const status = useToolCallStatus(() => props.tc);
const toolName = computed(() => props.tc?.toolName ?? UPDATE_PLAN);
const view = computed(() => parseTaskListCall(toolName.value, props.args));

const TITLES: Record<string, string> = {
  [WRAP_UP]: "Wrap-up",
  TaskCreate: "New task",
  TaskUpdate: "Task update",
};
const title = computed(() => TITLES[toolName.value] ?? "Task list");
// A new task has no position yet; its id arrives with the response.
const numbered = computed(() => toolName.value !== "TaskCreate");

const STATUS_LABELS: Record<string, string> = {
  completed: "Done",
  in_progress: "In progress",
  pending: "Pending",
};
function iconStatus(step: TaskStep) {
  if (step.status === "completed") return "done";
  return step.status === "in_progress" ? "in_progress" : "pending";
}
function statusLabel(step: TaskStep) {
  return step.status ? STATUS_LABELS[step.status] : (step.rawStatus ?? "No status");
}

const isEmpty = computed(
  () => !view.value.steps?.length && !view.value.changes.length && !view.value.wrapUp,
);
const emptyNote = computed(() =>
  view.value.steps ? "The call lists no steps." : "No task details in the call's input.",
);

const copyText = computed(() => {
  const { steps, changes, wrapUp } = view.value;
  const lines = [
    ...(steps ?? []).map((step) => `[${statusLabel(step)}] ${step.text}`),
    ...changes,
    wrapUp?.recap,
    wrapUp?.ask,
    props.content,
  ];
  return lines.filter((line): line is string => !!line).join("\n");
});
</script>

<template>
  <RendererShell :tool-name="title" icon-name="clipboard-list" :status="status" :copy-text="copyText">
    <RendererScrollRegion label="task list">
      <ol v-if="view.steps?.length" class="task-list" aria-label="Steps">
        <li v-for="(step, index) in view.steps" :key="index" class="task-step" :class="`task-step--${step.status ?? 'other'}`">
          <StatusIcon :status="iconStatus(step)" size="sm" class="task-step-icon" />
          <span v-if="numbered" class="task-step-number">{{ index + 1 }}.</span>
          <span class="task-step-body">
            <span class="task-step-text">{{ step.text }}</span>
            <span v-if="step.description" class="task-step-description">{{ step.description }}</span>
          </span>
          <span class="task-step-status">{{ statusLabel(step) }}</span>
        </li>
      </ol>
      <ul v-if="view.changes.length" class="task-changes" aria-label="Changes">
        <li v-for="(change, index) in view.changes" :key="index">{{ change }}</li>
      </ul>
      <div v-if="view.wrapUp" class="task-wrapup">
        <p v-if="view.wrapUp.recap" class="task-wrapup-recap">{{ view.wrapUp.recap }}</p>
        <div v-if="view.wrapUp.ask" class="task-wrapup-ask">
          <span class="task-label">Question</span>
          <p>{{ view.wrapUp.ask }}</p>
          <ul v-if="view.wrapUp.options.length" class="task-wrapup-options" aria-label="Answer options">
            <li v-for="(option, index) in view.wrapUp.options" :key="index">{{ option }}</li>
          </ul>
          <span v-if="view.wrapUp.blocked" class="task-wrapup-blocked">Waits for an answer</span>
        </div>
        <p v-if="!view.wrapUp.recap && !view.wrapUp.ask" class="task-note">No recap in the call's input.</p>
      </div>
      <p v-if="isEmpty" class="task-note">{{ emptyNote }}</p>
    </RendererScrollRegion>
    <section v-if="content !== undefined" class="task-response" aria-label="Response">
      <span class="task-label">Response</span>
      <pre v-if="content" :class="{ 'task-response--error': status === 'error' }">{{ content }}</pre>
      <p v-else class="task-note task-note--flush">
        {{ status === "pending" ? "Waiting for the response…" : "No response recorded." }}
      </p>
    </section>
  </RendererShell>
</template>

<style scoped>
.task-list,
.task-changes,
.task-wrapup-options {
  margin: 0;
  padding: 0;
  list-style: none;
}
.task-list { padding: 8px 12px; }
.task-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--text-primary);
}
.task-step-icon { margin-top: 2px; }
.task-step-number {
  flex-shrink: 0;
  min-width: 20px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.task-step-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}
.task-step-description { font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; }
.task-step--completed .task-step-text { color: var(--text-secondary); }
.task-step--in_progress .task-step-text { font-weight: 600; }
.task-step-status {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.task-step--in_progress .task-step-status { color: var(--accent-fg); }
.task-changes { padding: 12px; font-size: 13px; line-height: 1.6; color: var(--text-primary); }
.task-list + .task-changes { padding-top: 0; }
.task-wrapup { padding: 12px; }
.task-wrapup-recap {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.task-wrapup-ask { margin-top: 12px; }
.task-wrapup-recap:only-child,
.task-wrapup-ask:first-child { margin-top: 0; }
.task-wrapup-ask p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.task-wrapup-options { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.task-wrapup-options li {
  padding: 0 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm, 6px);
  font-size: 12px;
  line-height: 20px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.task-wrapup-blocked { display: block; margin-top: 8px; font-size: 12px; color: var(--warning-fg); }
.task-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.task-note { margin: 0; padding: 12px; font-size: 12px; color: var(--text-secondary); }
.task-note--flush { padding: 0; }
.task-response { padding: 12px; border-top: 1px solid var(--border-subtle); }
.task-response pre {
  margin: 0;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.task-response pre.task-response--error { color: var(--danger-fg); }
</style>
