<script setup lang="ts">
import type { CapturePreflight, CaptureProtocol } from "@tracepilot/types";
import { ActionButton, Badge, FormSwitch, formatBytes, ModalDialog, Select } from "@tracepilot/ui";
import { computed } from "vue";

const props = defineProps<{
  preflight: CapturePreflight | null;
  visible: boolean;
  protocol: CaptureProtocol;
  save: boolean;
}>();
const emit = defineEmits<{
  "update:visible": [value: boolean];
  "update:protocol": [value: CaptureProtocol];
  "update:save": [value: boolean];
  capture: [];
}>();
const options = computed(() =>
  (props.preflight?.protocolOptions ?? []).map((value) => ({
    value,
    label: {
      openAiChatCompletions: "OpenAI Chat Completions",
      openAiResponses: "OpenAI Responses",
      anthropicMessages: "Anthropic Messages",
    }[value],
  })),
);
</script>

<template>
  <ModalDialog
    :visible="visible"
    title="Captured request snapshot preflight"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="preflight" class="capture-preflight">
      <p class="capture-truth">
        This resumes a private copy, adds one synthetic probe, and captures one exact client request body. It does not contact a model provider or modify the source session.
      </p>
      <dl>
        <div><dt>Source status</dt><dd><Badge :variant="preflight.inactive ? 'success' : 'warning'">{{ preflight.inactive ? 'Inactive' : 'Active — blocked' }}</Badge></dd></div>
        <div><dt>Session copy</dt><dd>{{ formatBytes(preflight.sourceSizeBytes) }} · {{ preflight.sourceFileCount }} files</dd></div>
        <div><dt>Capture storage</dt><dd><Badge :variant="preflight.storageWritable ? 'success' : 'warning'">{{ preflight.storageWritable ? 'Writable' : 'Blocked' }}</Badge></dd></div>
        <div><dt>Working directory</dt><dd class="mono">{{ preflight.workingDirectory || 'Unavailable' }}</dd></div>
        <div><dt>CLI</dt><dd>{{ preflight.cli.version }} <span v-if="preflight.sourceCliVersion">(session: {{ preflight.sourceCliVersion }})</span></dd></div>
        <div><dt>Model</dt><dd>{{ preflight.model }}</dd></div>
        <div><dt>Profile</dt><dd>Isolated</dd></div>
      </dl>
      <label class="capture-field">
        <span>Wire protocol</span>
        <Select
          :model-value="protocol"
          :options="options"
          aria-label="Wire protocol"
          @update:model-value="emit('update:protocol', $event)"
        />
        <small>Detected from {{ preflight.protocolDetectionSource }}. This selects a schema, not provider attribution.</small>
      </label>
      <div v-if="preflight.warnings.length" class="capture-warnings">
        <strong>Fidelity and safety notes</strong>
        <ul><li v-for="warning in preflight.warnings" :key="warning">{{ warning }}</li></ul>
      </div>
      <details>
        <summary>Included and omitted resources</summary>
        <strong>Included</strong>
        <ul><li v-for="item in preflight.includedResources" :key="item">{{ item }}</li></ul>
        <strong>Omitted</strong>
        <ul><li v-for="item in preflight.omittedResources" :key="item">{{ item }}</li></ul>
      </details>
      <div class="capture-storage-choice">
        <div>
          <strong>Save snapshot locally</strong>
          <p>Stores plaintext request JSON under TracePilot’s data directory. It may contain source code, prompts, tool results, attachments, and secrets embedded in conversation history. Turn this off to view once.</p>
        </div>
        <FormSwitch :model-value="save" aria-label="Save snapshot locally" @update:model-value="emit('update:save', $event)" />
      </div>
    </div>
    <template #footer>
      <ActionButton @click="emit('update:visible', false)">Cancel</ActionButton>
      <ActionButton variant="primary" :disabled="!preflight?.canCapture" @click="emit('capture')">
        Capture isolated request
      </ActionButton>
    </template>
  </ModalDialog>
</template>

<style scoped>
.capture-preflight { display: grid; gap: 16px; max-width: 680px; }
.capture-truth { margin: 0; color: var(--text-secondary); line-height: 1.5; }
dl { display: grid; gap: 8px; margin: 0; }
dl div { display: grid; grid-template-columns: 140px 1fr; gap: 12px; }
dt { color: var(--text-tertiary); }
dd { margin: 0; overflow-wrap: anywhere; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.capture-field { display: grid; gap: 6px; }
.capture-field small, .capture-storage-choice p { color: var(--text-tertiary); margin: 0; line-height: 1.45; }
.capture-warnings { padding: 12px; border: 1px solid var(--warning-muted); border-radius: var(--radius-md); background: var(--warning-subtle); }
ul { margin: 6px 0 0; padding-left: 20px; }
li + li { margin-top: 4px; }
.capture-storage-choice { display: flex; gap: 20px; align-items: flex-start; padding-top: 12px; border-top: 1px solid var(--border-muted); }
.capture-storage-choice > div { flex: 1; }
</style>
