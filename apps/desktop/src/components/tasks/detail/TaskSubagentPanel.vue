<script setup lang="ts">
import { SectionPanel } from "@tracepilot/ui";
import type { Task } from "@tracepilot/types";
import TaskStatusBadge from "@/components/tasks/TaskStatusBadge.vue";

interface Props {
  task: Task;
}

defineProps<Props>();
</script>

<template>
  <div class="panel-content">
    <template v-if="task.orchestratorSessionId">
      <SectionPanel title="Orchestrator Attribution">
        <div class="kv-table">
          <div class="kv-row">
            <span class="kv-key">Session ID</span>
            <span class="kv-val mono truncate">
              {{ task.orchestratorSessionId }}
            </span>
          </div>
          <div class="kv-row">
            <span class="kv-key">Task Status</span>
            <span class="kv-val">
              <TaskStatusBadge :status="task.status" />
            </span>
          </div>
          <div v-if="task.jobId" class="kv-row">
            <span class="kv-key">Job ID</span>
            <span class="kv-val mono">{{ task.jobId }}</span>
          </div>
          <div v-if="task.schemaValid != null" class="kv-row">
            <span class="kv-key">Schema Valid</span>
            <span class="kv-val">
              <span
                :class="task.schemaValid ? 'valid-check' : 'invalid-cross'"
              >
                {{ task.schemaValid ? "✓ Yes" : "✗ No" }}
              </span>
            </span>
          </div>
        </div>
      </SectionPanel>
    </template>

    <div v-else class="empty-state">
      <div class="empty-icon">🤖</div>
      <div class="empty-heading">No subagent data</div>
      <div class="empty-desc">
        This task does not have orchestrator or subagent attribution
        information.
      </div>
    </div>
  </div>
</template>
