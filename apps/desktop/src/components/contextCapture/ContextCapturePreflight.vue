<script setup lang="ts">
import type { CapturePreflight, CaptureProtocol } from "@tracepilot/types";
import { ActionButton, FormSwitch, PageHeader, SectionPanel, Select } from "@tracepilot/ui";
import { ArrowLeft, Camera } from "lucide-vue-next";
import { computed } from "vue";
import { CONTEXT_CAPTURE_PROTOCOL_LABELS } from "@/config/contextCapture";

const props = defineProps<{
  preflight: CapturePreflight;
  protocol: CaptureProtocol;
  save: boolean;
}>();
const emit = defineEmits<{
  "update:protocol": [value: CaptureProtocol];
  "update:save": [value: boolean];
  cancel: [];
  capture: [];
}>();

const options = computed(() =>
  props.preflight.protocolOptions.map((value) => ({
    value,
    label: CONTEXT_CAPTURE_PROTOCOL_LABELS[value],
  })),
);

const blockers = computed(() => {
  const items: string[] = [];
  if (!props.preflight.inactive)
    items.push("Close the source Copilot CLI session before capturing.");
  if (!props.preflight.storageWritable) items.push("TracePilot's capture storage is not writable.");
  if (props.preflight.cli.missingCapabilities.length) {
    items.push(
      `The installed CLI does not support: ${props.preflight.cli.missingCapabilities.join(", ")}.`,
    );
  }
  return items;
});
</script>

<template>
  <div class="capture-preflight">
    <PageHeader
      title="New request snapshot"
      subtitle="Configure the request format and storage, then run the capture."
      icon-name="camera"
      density="compact"
    >
      <template #actions>
        <ActionButton @click="emit('cancel')">
          <ArrowLeft :size="14" /> Back to snapshots
        </ActionButton>
      </template>
    </PageHeader>

    <p class="capture-explanation">
      TracePilot copies the inactive session, resumes that copy with a short probe, records the
      outgoing JSON request on localhost, and stops before inference.
    </p>

    <div v-if="blockers.length" class="capture-blockers">
      <strong>Capture cannot start</strong>
      <ul>
        <li v-for="item in blockers" :key="item">{{ item }}</li>
      </ul>
    </div>

    <SectionPanel title="Request">
      <dl class="capture-summary">
        <div><dt>Model</dt><dd>{{ preflight.model }}</dd></div>
        <div><dt>Copilot CLI</dt><dd>{{ preflight.cli.version }}</dd></div>
        <div>
          <dt>Working directory</dt>
          <dd class="mono">{{ preflight.workingDirectory || 'Unavailable' }}</dd>
        </div>
      </dl>

      <p v-if="!preflight.workingDirectoryExists" class="capture-inline-note">
        The original working directory is unavailable. The capture can continue, but current
        repository instructions will not be discovered.
      </p>

      <label class="capture-field">
        <span>API request format</span>
        <Select
          :model-value="protocol"
          :options="options"
          aria-label="API request format"
          @update:model-value="emit('update:protocol', $event)"
        />
        <small>
          TracePilot selected this from the session's endpoint history or model family. Change it
          if the CLI uses a different API format.
        </small>
      </label>
    </SectionPanel>

    <SectionPanel title="Storage">
      <label class="capture-storage-choice">
        <span>
          <strong>Save snapshot locally</strong>
          <small>
            Saves request.json as plaintext in TracePilot's data directory. Turn this off to keep
            the result only until you leave this view.
          </small>
        </span>
        <FormSwitch
          :model-value="save"
          aria-label="Save snapshot locally"
          @update:model-value="emit('update:save', $event)"
        />
      </label>
    </SectionPanel>

    <div class="capture-actions">
      <ActionButton @click="emit('cancel')">Cancel</ActionButton>
      <ActionButton variant="primary" :disabled="!preflight.canCapture" @click="emit('capture')">
        <Camera :size="14" /> Capture request
      </ActionButton>
    </div>
  </div>
</template>

<style scoped>
.capture-preflight {
  display: grid;
  gap: 20px;
  min-height: 620px;
}

.capture-explanation {
  max-width: 840px;
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.capture-blockers {
  padding: 12px 14px;
  border: 1px solid var(--danger-muted);
  border-radius: var(--radius-md);
  background: var(--danger-subtle);
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.capture-blockers strong {
  color: var(--danger-fg);
}

.capture-blockers ul {
  margin: 6px 0 0;
  padding-left: 20px;
}

.capture-summary {
  overflow: hidden;
  margin: 0 0 14px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
}

.capture-summary > div {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 16px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-muted);
}

.capture-summary > div:last-child {
  border-bottom: 0;
}

.capture-summary dt {
  color: var(--text-tertiary);
}

.capture-summary dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}

.mono {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.capture-inline-note {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-left: 3px solid var(--warning-fg);
  background: var(--warning-subtle);
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.45;
}

.capture-field {
  display: grid;
  gap: 8px;
}

.capture-field > span,
.capture-storage-choice strong {
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 600;
}

.capture-field small,
.capture-storage-choice small {
  display: block;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.45;
}

.capture-storage-choice {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.capture-storage-choice strong {
  display: block;
  margin-bottom: 4px;
}

.capture-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 0;
  border-top: 1px solid var(--border-muted);
}

@media (max-width: 640px) {
  .capture-summary > div {
    grid-template-columns: 1fr;
    gap: 3px;
  }
}
</style>
