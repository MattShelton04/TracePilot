<script setup lang="ts">
import type { ContextCaptureSnapshot } from "@tracepilot/types";
import {
  ActionButton,
  formatBytes,
  formatDateMedium,
  formatNumberFull,
  PageHeader,
  SectionPanel,
  SegmentedControl,
  StatCard,
} from "@tracepilot/ui";
import { ArrowLeft, Trash2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import ContextCaptureJsonViewer from "./ContextCaptureJsonViewer.vue";
import ContextCaptureMessages from "./ContextCaptureMessages.vue";
import ContextCaptureRaw from "./ContextCaptureRaw.vue";
import ContextCaptureSystem from "./ContextCaptureSystem.vue";
import ContextCaptureTools from "./ContextCaptureTools.vue";

const props = defineProps<{ snapshot: ContextCaptureSnapshot }>();
const emit = defineEmits<{ close: []; delete: [captureId: string] }>();
type View = "overview" | "system" | "items" | "tools" | "raw";
const view = ref<View>("overview");

watch(
  () => props.snapshot.manifest.captureId,
  () => {
    view.value = "overview";
  },
);

const tabs = computed(() => [
  { value: "overview", label: "Overview" },
  { value: "system", label: "System", count: props.snapshot.manifest.parsed.systemBlocks.length },
  { value: "items", label: "Request items", count: props.snapshot.manifest.parsed.messages.length },
  { value: "tools", label: "Tools", count: props.snapshot.manifest.parsed.toolDefinitions.length },
  { value: "raw", label: "Raw JSON" },
]);

const protocolLabel: Record<string, string> = {
  openAiChatCompletions: "OpenAI Chat Completions",
  openAiResponses: "OpenAI Responses",
  anthropicMessages: "Anthropic Messages",
};

const composition = computed(() => {
  const metrics = props.snapshot.manifest.parsed.sectionMetrics;
  const rows = [
    {
      label: "System instructions",
      bytes: metrics.systemBytes,
      characters: metrics.systemCharacters,
    },
    { label: "Request items", bytes: metrics.messageBytes, characters: metrics.messageCharacters },
    { label: "Tool definitions", bytes: metrics.toolBytes, characters: metrics.toolCharacters },
    {
      label: "Request controls",
      bytes: metrics.controlsBytes,
      characters: metrics.controlsCharacters,
    },
  ];
  const measuredBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const measuredCharacters = rows.reduce((sum, row) => sum + row.characters, 0);
  const otherBytes = Math.max(0, props.snapshot.manifest.rawBodyBytes - measuredBytes);
  const otherCharacters = Math.max(
    0,
    props.snapshot.manifest.rawBodyCharacters - measuredCharacters,
  );
  if (otherBytes || otherCharacters) {
    rows.push({
      label: "JSON structure and other fields",
      bytes: otherBytes,
      characters: otherCharacters,
    });
  }
  return rows.map((row) => ({
    ...row,
    estimatedTokens: Math.ceil(row.bytes / 4),
    percent:
      props.snapshot.manifest.rawBodyBytes > 0
        ? Math.max(0, Math.min(100, (row.bytes / props.snapshot.manifest.rawBodyBytes) * 100))
        : 0,
  }));
});
</script>

<template>
  <div class="capture-viewer">
    <button type="button" class="capture-back" @click="emit('close')">
      <ArrowLeft :size="14" /> Back to snapshots
    </button>

    <PageHeader
      :title="`Captured ${formatDateMedium(snapshot.manifest.capturedAt)}`"
      :subtitle="`${snapshot.manifest.parsed.model ?? 'Unknown model'} · ${protocolLabel[snapshot.manifest.protocol]} · Copilot CLI ${snapshot.manifest.cliVersion}`"
      icon-name="file-json"
      density="compact"
    >
      <template #actions>
        <ActionButton
          v-if="snapshot.manifest.saved"
          class="btn-danger"
          @click="emit('delete', snapshot.manifest.captureId)"
        >
          <Trash2 :size="14" /> Delete snapshot…
        </ActionButton>
      </template>
    </PageHeader>

    <div class="capture-viewer__tabs">
      <SegmentedControl v-model="view" :options="tabs" />
    </div>

    <div v-if="view === 'overview'" class="capture-overview">
      <div class="capture-overview__stats">
        <StatCard :value="formatBytes(snapshot.manifest.rawBodyBytes)" label="Request body" />
        <StatCard
          :value="formatNumberFull(snapshot.manifest.estimatedTokens)"
          label="Estimated tokens"
          color="warning"
        />
        <StatCard :value="snapshot.manifest.parsed.messages.length" label="Request items" />
        <StatCard :value="snapshot.manifest.parsed.toolDefinitions.length" label="Tools" />
      </div>

      <div class="capture-definition">
        <strong>What was captured</strong>
        <p>
          Raw JSON is the exact HTTP request body emitted by Copilot CLI during this capture run.
          A provider may still apply server-side instructions, routing, transformations, and
          tokenization, so this is not the model's final internal token stream.
        </p>
      </div>

      <div class="capture-overview__grid">
        <div class="capture-overview__main">
          <SectionPanel title="Size and estimated tokens">
            <div class="capture-composition" role="table" aria-label="Request composition">
              <div class="capture-composition__head" role="row">
                <span role="columnheader">Section</span>
                <span role="columnheader">Size</span>
                <span role="columnheader">Characters</span>
                <span role="columnheader">Est. tokens</span>
              </div>
              <div v-for="row in composition" :key="row.label" class="capture-composition__row" role="row">
                <span class="capture-composition__label" role="cell">
                  <span>{{ row.label }}</span>
                  <span class="capture-composition__bar" aria-hidden="true">
                    <span :style="{ width: `${Math.max(row.percent, row.bytes ? 1 : 0)}%` }" />
                  </span>
                </span>
                <span role="cell">{{ formatBytes(row.bytes) }}</span>
                <span role="cell">{{ formatNumberFull(row.characters) }}</span>
                <strong role="cell">{{ formatNumberFull(row.estimatedTokens) }}</strong>
              </div>
            </div>
            <p class="capture-metric-note">
              Section sizes use compact JSON. Token counts use the same four-bytes-per-token
              estimate as the total and will differ from provider tokenization.
            </p>
          </SectionPanel>

          <SectionPanel title="Request controls">
            <ContextCaptureJsonViewer
              :value="snapshot.manifest.parsed.requestControls"
              file-name="request-controls.json"
              size="compact"
            />
          </SectionPanel>

          <SectionPanel
            v-if="Object.keys(snapshot.manifest.parsed.unknownFields).length"
            title="Other top-level fields"
          >
            <ContextCaptureJsonViewer
              :value="snapshot.manifest.parsed.unknownFields"
              file-name="other-fields.json"
              size="compact"
            />
          </SectionPanel>
        </div>

        <aside class="capture-overview__aside">
          <SectionPanel title="Request details">
            <dl class="capture-details">
              <div><dt>Method</dt><dd><code>POST</code></dd></div>
              <div><dt>Path</dt><dd><code>{{ snapshot.manifest.requestPath }}</code></dd></div>
              <div><dt>Protocol</dt><dd>{{ protocolLabel[snapshot.manifest.protocol] }}</dd></div>
              <div><dt>Model</dt><dd>{{ snapshot.manifest.parsed.model ?? 'Unknown' }}</dd></div>
              <div><dt>CLI</dt><dd>{{ snapshot.manifest.cliVersion }}</dd></div>
              <div><dt>Storage</dt><dd>{{ snapshot.manifest.saved ? 'Saved as plaintext' : 'View once' }}</dd></div>
              <div><dt>Characters</dt><dd>{{ formatNumberFull(snapshot.manifest.rawBodyCharacters) }}</dd></div>
            </dl>
          </SectionPanel>
        </aside>
      </div>
    </div>

    <ContextCaptureSystem
      v-else-if="view === 'system'"
      :blocks="snapshot.manifest.parsed.systemBlocks"
    />
    <ContextCaptureMessages
      v-else-if="view === 'items'"
      :messages="snapshot.manifest.parsed.messages"
    />
    <ContextCaptureTools
      v-else-if="view === 'tools'"
      :tools="snapshot.manifest.parsed.toolDefinitions"
    />
    <ContextCaptureRaw
      v-else
      :raw-body="snapshot.rawBody"
      :sha256="snapshot.manifest.rawBodySha256"
    />
  </div>
</template>

<style scoped>
.capture-viewer {
  min-width: 0;
}

.capture-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-fg);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
}

.capture-viewer__tabs {
  overflow-x: auto;
  margin-bottom: 20px;
  padding-bottom: 2px;
}

.capture-overview {
  display: grid;
  gap: 20px;
}

.capture-overview__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.capture-definition {
  padding: 14px 16px;
  border-left: 3px solid var(--border-accent);
  background: var(--canvas-subtle);
}

.capture-definition strong {
  font-size: 0.8125rem;
}

.capture-definition p {
  max-width: 900px;
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.capture-overview__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(260px, 0.8fr);
  gap: 24px;
}

.capture-overview__main,
.capture-overview__aside {
  min-width: 0;
}

.capture-composition {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
}

.capture-composition__head,
.capture-composition__row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 90px 100px 90px;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
}

.capture-composition__head {
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 600;
}

.capture-composition__row {
  border-top: 1px solid var(--border-muted);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.capture-composition__row > :not(:first-child) {
  text-align: right;
}

.capture-composition__row strong {
  color: var(--text-primary);
}

.capture-composition__label {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.capture-composition__bar {
  height: 3px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
}

.capture-composition__bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-fg);
}

.capture-metric-note {
  margin: 10px 0 0;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.45;
}

.capture-details {
  overflow: hidden;
  margin: 0;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font-size: 0.75rem;
}

.capture-details > div {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 12px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border-muted);
}

.capture-details > div:last-child {
  border-bottom: 0;
}

.capture-details dt {
  color: var(--text-tertiary);
}

.capture-details dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}

.capture-details code {
  font-size: inherit;
}

@media (max-width: 980px) {
  .capture-overview__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .capture-overview__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .capture-composition__head,
  .capture-composition__row {
    grid-template-columns: minmax(150px, 1fr) 80px 80px;
  }

  .capture-composition__head > :nth-child(3),
  .capture-composition__row > :nth-child(3) {
    display: none;
  }
}
</style>
