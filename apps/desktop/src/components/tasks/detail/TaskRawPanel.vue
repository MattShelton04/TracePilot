<script setup lang="ts">
import type { Task } from "@tracepilot/types";
import { SectionPanel } from "@tracepilot/ui";

interface Props {
  task: Task;
  copiedSection: string | null;
}

const emit = defineEmits<(e: "copy", text: string, section: string) => void>();

defineProps<Props>();

function copy(text: string, section: string) {
  emit("copy", text, section);
}
</script>

<template>
  <div class="panel-content">
    <SectionPanel title="Task Object">
      <template #actions>
        <button
          class="copy-btn"
          @click="copy(JSON.stringify(task, null, 2), 'raw-task')"
        >
          {{ copiedSection === "raw-task" ? "Copied ✓" : "Copy" }}
        </button>
      </template>
      <div class="json-block-wrapper">
        <pre class="json-block">{{ JSON.stringify(task, null, 2) }}</pre>
      </div>
    </SectionPanel>

    <SectionPanel v-if="task.resultParsed" title="Result Parsed">
      <template #actions>
        <button
          class="copy-btn"
          @click="
            copy(JSON.stringify(task.resultParsed, null, 2), 'raw-result')
          "
        >
          {{ copiedSection === "raw-result" ? "Copied ✓" : "Copy" }}
        </button>
      </template>
      <div class="json-block-wrapper">
        <pre class="json-block">{{
          JSON.stringify(task.resultParsed, null, 2)
        }}</pre>
      </div>
    </SectionPanel>

    <SectionPanel title="Input Parameters">
      <template #actions>
        <button
          class="copy-btn"
          @click="copy(JSON.stringify(task.inputParams, null, 2), 'raw-input')"
        >
          {{ copiedSection === "raw-input" ? "Copied ✓" : "Copy" }}
        </button>
      </template>
      <div class="json-block-wrapper">
        <pre class="json-block">{{
          JSON.stringify(task.inputParams, null, 2)
        }}</pre>
      </div>
    </SectionPanel>
  </div>
</template>
