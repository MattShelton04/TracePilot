<script setup lang="ts">
import type { ContextCaptureSnapshot } from "@tracepilot/types";
import {
  ActionButton,
  Badge,
  CodeBlock,
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
const controlsJson = computed(() =>
  JSON.stringify(props.snapshot.manifest.parsed.requestControls, null, 2),
);
const unknownJson = computed(() =>
  JSON.stringify(props.snapshot.manifest.parsed.unknownFields, null, 2),
);
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

    <div class="capture-viewer__badges">
      <Badge variant="success">Exact raw body · capture run only</Badge>
      <Badge variant="neutral">Isolated</Badge>
      <Badge :variant="snapshot.manifest.fidelityManifest.sourceUnchanged ? 'success' : 'warning'">
        Source {{ snapshot.manifest.fidelityManifest.sourceUnchanged ? 'unchanged' : 'changed' }}
      </Badge>
      <Badge :variant="snapshot.manifest.saved ? 'neutral' : 'warning'">
        {{ snapshot.manifest.saved ? 'Saved plaintext' : 'View once' }}
      </Badge>
    </div>

    <div class="capture-viewer__tabs">
      <SegmentedControl v-model="view" :options="tabs" />
    </div>

    <div v-if="view === 'overview'" class="capture-overview">
      <div class="capture-overview__stats">
        <StatCard :value="formatBytes(snapshot.manifest.rawBodyBytes)" label="Exact body size" />
        <StatCard
          :value="formatNumberFull(snapshot.manifest.rawBodyCharacters)"
          label="Exact characters"
        />
        <StatCard
          :value="formatNumberFull(snapshot.manifest.estimatedTokens)"
          label="Estimated tokens"
          color="warning"
        />
        <StatCard :value="snapshot.manifest.parsed.messages.length" label="Request items" />
        <StatCard :value="snapshot.manifest.parsed.toolDefinitions.length" label="Tools" />
      </div>

      <div class="capture-overview__grid">
        <div class="capture-overview__main">
          <SectionPanel title="Composition">
            <dl class="capture-measurements">
              <div><dt>System instructions</dt><dd>{{ formatBytes(snapshot.manifest.parsed.sectionMetrics.systemBytes) }} <span>{{ formatNumberFull(snapshot.manifest.parsed.sectionMetrics.systemCharacters) }} chars</span></dd></div>
              <div><dt>Request items</dt><dd>{{ formatBytes(snapshot.manifest.parsed.sectionMetrics.messageBytes) }} <span>{{ formatNumberFull(snapshot.manifest.parsed.sectionMetrics.messageCharacters) }} chars</span></dd></div>
              <div><dt>Tool definitions</dt><dd>{{ formatBytes(snapshot.manifest.parsed.sectionMetrics.toolBytes) }} <span>{{ formatNumberFull(snapshot.manifest.parsed.sectionMetrics.toolCharacters) }} chars</span></dd></div>
              <div><dt>Request controls</dt><dd>{{ formatBytes(snapshot.manifest.parsed.sectionMetrics.controlsBytes) }} <span>{{ formatNumberFull(snapshot.manifest.parsed.sectionMetrics.controlsCharacters) }} chars</span></dd></div>
              <div v-if="snapshot.manifest.parsed.attachments.length"><dt>Attachments</dt><dd>{{ snapshot.manifest.parsed.attachments.length }} recognized</dd></div>
            </dl>
            <p class="capture-metric-note">
              Bytes and characters are compact-JSON measurements of captured values. Tokens are a
              clearly labelled byte-based estimate, not provider tokenizer output.
            </p>
          </SectionPanel>

          <SectionPanel title="Request controls">
            <div class="capture-code-card">
              <CodeBlock
                :code="controlsJson"
                language="json"
                :line-numbers="true"
                :show-language-badge="false"
                :max-lines="500"
              />
            </div>
          </SectionPanel>

          <SectionPanel
            v-if="Object.keys(snapshot.manifest.parsed.unknownFields).length"
            title="Additional protocol fields"
          >
            <p class="capture-section-copy">
              These fields are preserved exactly in Raw JSON but are not yet assigned to a
              normalized section.
            </p>
            <div class="capture-code-card">
              <CodeBlock
                :code="unknownJson"
                language="json"
                :line-numbers="true"
                :show-language-badge="false"
                :max-lines="500"
              />
            </div>
          </SectionPanel>
        </div>

        <aside class="capture-overview__aside">
          <SectionPanel title="Provenance">
            <dl class="capture-provenance">
              <div><dt>Request</dt><dd><code>POST {{ snapshot.manifest.requestPath }}</code></dd></div>
              <div><dt>Protocol evidence</dt><dd>{{ snapshot.manifest.protocolDetectionSource }}</dd></div>
              <div><dt>Working directory</dt><dd><code>{{ snapshot.manifest.fidelityManifest.workingDirectory }}</code></dd></div>
              <div><dt>Request SHA-256</dt><dd><code>{{ snapshot.manifest.rawBodySha256 }}</code></dd></div>
              <div><dt>Source events SHA-256</dt><dd><code>{{ snapshot.manifest.sourceEventsFingerprint.sha256 }}</code></dd></div>
              <div><dt>Observed headers</dt><dd>{{ snapshot.manifest.safeHeaderNames.join(', ') || 'None' }}</dd></div>
            </dl>
          </SectionPanel>

          <SectionPanel title="Fidelity notes">
            <ul class="capture-warnings">
              <li
                v-for="warning in [
                  ...snapshot.manifest.warnings,
                  ...snapshot.manifest.parsed.warnings,
                ]"
                :key="warning"
              >
                {{ warning }}
              </li>
            </ul>
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

.capture-viewer__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: -8px 0 16px;
}

.capture-viewer__tabs {
  overflow-x: auto;
  margin-bottom: 20px;
  padding-bottom: 2px;
}

.capture-overview {
  display: grid;
  gap: 24px;
}

.capture-overview__stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.capture-overview__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(300px, 1fr);
  gap: 24px;
}

.capture-overview__main,
.capture-overview__aside {
  min-width: 0;
}

.capture-measurements,
.capture-provenance {
  overflow: hidden;
  margin: 0;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-measurements > div,
.capture-provenance > div {
  display: grid;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-muted);
}

.capture-measurements > div:last-child,
.capture-provenance > div:last-child {
  border-bottom: 0;
}

.capture-measurements > div {
  grid-template-columns: minmax(140px, 1fr) auto;
}

.capture-provenance > div {
  grid-template-columns: 120px minmax(0, 1fr);
}

.capture-measurements dt,
.capture-provenance dt {
  color: var(--text-tertiary);
}

.capture-measurements dd,
.capture-provenance dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.capture-measurements dd {
  text-align: right;
}

.capture-measurements dd span {
  display: block;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.capture-provenance code {
  font-size: 0.6875rem;
}

.capture-metric-note,
.capture-section-copy {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.45;
}

.capture-metric-note {
  margin: 10px 0 0;
}

.capture-section-copy {
  margin: 0 0 8px;
}

.capture-code-card {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-warnings {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 14px 14px 14px 32px;
  border: 1px solid var(--warning-muted);
  border-radius: var(--radius-lg);
  background: var(--warning-subtle);
  color: var(--text-secondary);
  line-height: 1.45;
}

@media (max-width: 980px) {
  .capture-overview__stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .capture-overview__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .capture-overview__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
