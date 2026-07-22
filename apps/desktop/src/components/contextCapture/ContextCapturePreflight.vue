<script setup lang="ts">
import type { CapturePreflight, CaptureProtocol } from "@tracepilot/types";
import {
  ActionButton,
  Badge,
  FormSwitch,
  formatBytes,
  PageHeader,
  SectionPanel,
  Select,
} from "@tracepilot/ui";
import { ArrowLeft, Camera, CheckCircle2, ShieldCheck } from "lucide-vue-next";
import { computed } from "vue";

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
    label: {
      openAiChatCompletions: "OpenAI Chat Completions",
      openAiResponses: "OpenAI Responses",
      anthropicMessages: "Anthropic Messages",
    }[value],
  })),
);
</script>

<template>
  <div class="capture-preflight">
    <PageHeader
      title="New request snapshot"
      subtitle="Review the isolated capture plan before starting the Copilot CLI."
      icon-name="camera"
      density="compact"
    >
      <template #actions>
        <ActionButton @click="emit('cancel')">
          <ArrowLeft :size="14" /> Back to snapshots
        </ActionButton>
      </template>
    </PageHeader>

    <div class="capture-truth">
      <ShieldCheck :size="20" />
      <p>
        <strong>One request, captured locally.</strong>
        TracePilot resumes a private copy, adds one synthetic probe, and never forwards the body
        to a model provider or modifies the source session.
      </p>
    </div>

    <div class="capture-preflight__grid">
      <div class="capture-preflight__main">
        <SectionPanel title="Capture plan">
          <dl class="capture-summary">
            <div>
              <dt>Source session</dt>
              <dd>
                <Badge :variant="preflight.inactive ? 'success' : 'warning'">
                  {{ preflight.inactive ? 'Inactive and ready' : 'Active — capture blocked' }}
                </Badge>
              </dd>
            </div>
            <div><dt>Session copy</dt><dd>{{ formatBytes(preflight.sourceSizeBytes) }} · {{ preflight.sourceFileCount }} files</dd></div>
            <div>
              <dt>Capture storage</dt>
              <dd>
                <Badge :variant="preflight.storageWritable ? 'success' : 'warning'">
                  {{ preflight.storageWritable ? 'Writable' : 'Blocked' }}
                </Badge>
              </dd>
            </div>
            <div><dt>Working directory</dt><dd class="mono">{{ preflight.workingDirectory || 'Unavailable' }}</dd></div>
            <div>
              <dt>Copilot CLI</dt>
              <dd>
                {{ preflight.cli.version }}
                <span v-if="preflight.sourceCliVersion" class="secondary">
                  Session originally used {{ preflight.sourceCliVersion }}
                </span>
              </dd>
            </div>
            <div><dt>Model</dt><dd>{{ preflight.model }}</dd></div>
            <div><dt>Fidelity profile</dt><dd>Isolated</dd></div>
          </dl>
        </SectionPanel>

        <SectionPanel title="Wire format">
          <label class="capture-field">
            <span>Protocol</span>
            <Select
              :model-value="protocol"
              :options="options"
              aria-label="Wire protocol"
              @update:model-value="emit('update:protocol', $event)"
            />
            <small>
              Suggested from {{ preflight.protocolDetectionSource }}. This chooses the expected
              request schema; it does not assign provider identity.
            </small>
          </label>
        </SectionPanel>

        <SectionPanel title="Storage choice">
          <label class="capture-storage-choice">
            <span>
              <strong>Save snapshot locally</strong>
              <small>
                Stores plaintext request JSON under TracePilot’s data directory. Turn this off to
                inspect the result once without retaining it.
              </small>
            </span>
            <FormSwitch
              :model-value="save"
              aria-label="Save snapshot locally"
              @update:model-value="emit('update:save', $event)"
            />
          </label>
          <p v-if="save" class="capture-sensitive-note">
            Saved bodies may contain source code, prompts, tool results, attachments, and secrets
            already present in conversation history.
          </p>
        </SectionPanel>
      </div>

      <aside class="capture-preflight__aside">
        <SectionPanel title="Safety and fidelity">
          <ul class="capture-notes">
            <li v-for="warning in preflight.warnings" :key="warning">{{ warning }}</li>
            <li v-if="preflight.warnings.length === 0" class="capture-note-ok">
              <CheckCircle2 :size="14" /> No blocking preflight warnings.
            </li>
          </ul>
        </SectionPanel>

        <SectionPanel title="Included">
          <ul class="capture-resources">
            <li v-for="item in preflight.includedResources" :key="item">{{ item }}</li>
          </ul>
        </SectionPanel>

        <SectionPanel title="Intentionally omitted">
          <ul class="capture-resources">
            <li v-for="item in preflight.omittedResources" :key="item">{{ item }}</li>
          </ul>
        </SectionPanel>
      </aside>
    </div>

    <div class="capture-actions">
      <span v-if="!preflight.canCapture">Resolve the blocked checks above before capturing.</span>
      <span v-else>Ready to create one isolated request.</span>
      <ActionButton @click="emit('cancel')">Cancel</ActionButton>
      <ActionButton
        variant="primary"
        :disabled="!preflight.canCapture"
        @click="emit('capture')"
      >
        <Camera :size="14" /> Capture isolated request
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

.capture-truth {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--accent-muted);
  border-radius: var(--radius-lg);
  background: var(--surface-secondary);
  color: var(--accent-fg);
}

.capture-truth svg {
  flex: none;
  margin-top: 2px;
}

.capture-truth p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.5;
}

.capture-truth strong {
  margin-right: 4px;
  color: var(--text-primary);
}

.capture-preflight__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  gap: 24px;
}

.capture-preflight__main,
.capture-preflight__aside {
  min-width: 0;
}

.capture-summary {
  overflow: hidden;
  margin: 0;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-summary > div {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 16px;
  padding: 11px 14px;
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
}

.secondary {
  display: block;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.mono {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.capture-field {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-field > span {
  font-weight: 600;
}

.capture-field small,
.capture-storage-choice small {
  display: block;
  color: var(--text-tertiary);
  line-height: 1.45;
}

.capture-storage-choice {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 14px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-storage-choice strong {
  display: block;
  margin-bottom: 4px;
}

.capture-sensitive-note {
  margin: 8px 0 0;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--warning-subtle);
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.45;
}

.capture-notes,
.capture-resources {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 14px 14px 14px 32px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  line-height: 1.45;
}

.capture-note-ok {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--success-fg);
  list-style: none;
}

.capture-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 0;
  border-top: 1px solid var(--border-muted);
}

.capture-actions > span {
  margin-right: auto;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

@media (max-width: 900px) {
  .capture-preflight__grid {
    grid-template-columns: 1fr;
  }
}
</style>
