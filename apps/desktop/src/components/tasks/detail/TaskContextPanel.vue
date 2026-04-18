<script setup lang="ts">
import { SectionPanel } from "@tracepilot/ui";
import type { Task } from "@tracepilot/types";
import PriorityBadge from "@/components/tasks/PriorityBadge.vue";
import TaskTypeBadge from "@/components/tasks/TaskTypeBadge.vue";
import { formatValue, isSimpleValue } from "@/composables/useTaskDetail";

interface Props {
  task: Task;
  inputEntries: Array<[string, unknown]>;
}

defineProps<Props>();
</script>

<template>
  <div class="panel-content">
    <SectionPanel title="Input Parameters">
      <div v-if="inputEntries.length > 0" class="kv-table">
        <div v-for="[key, val] in inputEntries" :key="key" class="kv-row">
          <span class="kv-key">{{ key }}</span>
          <span v-if="isSimpleValue(val)" class="kv-val">
            {{ formatValue(val) }}
          </span>
          <pre v-else class="kv-val-block">{{ formatValue(val) }}</pre>
        </div>
      </div>
      <div v-else class="empty-placeholder">No input parameters.</div>
    </SectionPanel>

    <SectionPanel title="Preset">
      <div class="kv-table">
        <div class="kv-row">
          <span class="kv-key">Preset ID</span>
          <span class="kv-val mono">{{ task.presetId }}</span>
        </div>
        <div class="kv-row">
          <span class="kv-key">Task Type</span>
          <span class="kv-val">
            <TaskTypeBadge :task-type="task.taskType" />
          </span>
        </div>
        <div class="kv-row">
          <span class="kv-key">Priority</span>
          <span class="kv-val">
            <PriorityBadge :priority="task.priority" />
          </span>
        </div>
        <div class="kv-row">
          <span class="kv-key">Max Retries</span>
          <span class="kv-val mono">{{ task.maxRetries }}</span>
        </div>
      </div>
    </SectionPanel>

    <SectionPanel title="Context Source">
      <div
        v-if="task.contextHash || task.orchestratorSessionId || task.jobId"
        class="kv-table"
      >
        <div v-if="task.contextHash" class="kv-row">
          <span class="kv-key">Context Hash</span>
          <span class="kv-val mono truncate">
            {{ task.contextHash }}
          </span>
        </div>
        <div v-if="task.orchestratorSessionId" class="kv-row">
          <span class="kv-key">Session</span>
          <span class="kv-val mono truncate">
            {{ task.orchestratorSessionId }}
          </span>
        </div>
        <div v-if="task.jobId" class="kv-row">
          <span class="kv-key">Job ID</span>
          <span class="kv-val mono">{{ task.jobId }}</span>
        </div>
      </div>
      <div v-else class="empty-placeholder">
        No context source information available.
      </div>
    </SectionPanel>
  </div>
</template>
