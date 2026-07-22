<script setup lang="ts">
import type { ContextCaptureSnapshot } from "@tracepilot/types";
import {
  ActionButton,
  Badge,
  formatBytes,
  formatDateMedium,
  formatNumberFull,
  ModalDialog,
  SegmentedControl,
  StatCard,
} from "@tracepilot/ui";
import { computed, ref } from "vue";
import ContextCaptureMessages from "./ContextCaptureMessages.vue";
import ContextCaptureRaw from "./ContextCaptureRaw.vue";
import ContextCaptureSystem from "./ContextCaptureSystem.vue";
import ContextCaptureTools from "./ContextCaptureTools.vue";

const props = defineProps<{ snapshot: ContextCaptureSnapshot | null; visible: boolean }>();
const emit = defineEmits<{ "update:visible": [value: boolean]; delete: [captureId: string] }>();
type View = "overview" | "system" | "messages" | "tools" | "raw";
const view = ref<View>("overview");
const tabs = computed(() => [
  { value: "overview", label: "Overview" },
  { value: "system", label: "System", count: props.snapshot?.manifest.parsed.systemBlocks.length },
  { value: "messages", label: "Messages", count: props.snapshot?.manifest.parsed.messages.length },
  { value: "tools", label: "Tools", count: props.snapshot?.manifest.parsed.toolDefinitions.length },
  { value: "raw", label: "Raw JSON" },
]);
const protocolLabel: Record<string, string> = {
  openAiChatCompletions: "OpenAI Chat Completions",
  openAiResponses: "OpenAI Responses",
  anthropicMessages: "Anthropic Messages",
};
</script>

<template>
  <ModalDialog :visible="visible" title="Captured request snapshot" @update:visible="emit('update:visible', $event)">
    <div v-if="snapshot" class="capture-viewer">
      <header>
        <div>
          <strong>Captured {{ formatDateMedium(snapshot.manifest.capturedAt) }}</strong>
          <p>Exact captured payload · Capture run only</p>
          <span>{{ snapshot.manifest.parsed.model ?? 'Unknown model' }} · {{ protocolLabel[snapshot.manifest.protocol] }} · CLI {{ snapshot.manifest.cliVersion }}</span>
        </div>
        <div class="badges">
          <Badge variant="success">exact raw body</Badge>
          <Badge variant="neutral">isolated</Badge>
          <Badge :variant="snapshot.manifest.fidelityManifest.sourceUnchanged ? 'success' : 'warning'">source {{ snapshot.manifest.fidelityManifest.sourceUnchanged ? 'unchanged' : 'changed' }}</Badge>
          <Badge :variant="snapshot.manifest.saved ? 'neutral' : 'warning'">{{ snapshot.manifest.saved ? 'saved plaintext' : 'view once' }}</Badge>
        </div>
      </header>
      <SegmentedControl v-model="view" :options="tabs" />

      <div v-if="view === 'overview'" class="overview">
        <div class="stats">
          <StatCard :value="formatBytes(snapshot.manifest.rawBodyBytes)" label="Exact body size" />
          <StatCard :value="formatNumberFull(snapshot.manifest.rawBodyCharacters)" label="Exact characters" />
          <StatCard :value="formatNumberFull(snapshot.manifest.estimatedTokens)" label="Estimated tokens" color="warning" />
          <StatCard :value="snapshot.manifest.parsed.toolDefinitions.length" label="Tools" />
        </div>
        <section>
          <h4>Provenance</h4>
          <dl>
            <div><dt>Request</dt><dd><code>POST {{ snapshot.manifest.requestPath }}</code></dd></div>
            <div><dt>Protocol evidence</dt><dd>{{ snapshot.manifest.protocolDetectionSource }}</dd></div>
            <div><dt>Working directory</dt><dd><code>{{ snapshot.manifest.fidelityManifest.workingDirectory }}</code></dd></div>
            <div><dt>Source events SHA-256</dt><dd><code>{{ snapshot.manifest.sourceEventsFingerprint.sha256 }}</code></dd></div>
            <div><dt>Safe observed header names</dt><dd>{{ snapshot.manifest.safeHeaderNames.join(', ') || 'None' }}</dd></div>
          </dl>
        </section>
        <section>
          <h4>Section measurements</h4>
          <dl>
            <div><dt>System</dt><dd>{{ formatBytes(snapshot.manifest.parsed.sectionMetrics.systemBytes) }} · {{ snapshot.manifest.parsed.sectionMetrics.systemCharacters }} chars</dd></div>
            <div><dt>Messages</dt><dd>{{ formatBytes(snapshot.manifest.parsed.sectionMetrics.messageBytes) }} · {{ snapshot.manifest.parsed.sectionMetrics.messageCharacters }} chars</dd></div>
            <div><dt>Tools</dt><dd>{{ formatBytes(snapshot.manifest.parsed.sectionMetrics.toolBytes) }} · {{ snapshot.manifest.parsed.sectionMetrics.toolCharacters }} chars</dd></div>
            <div><dt>Controls</dt><dd>{{ formatBytes(snapshot.manifest.parsed.sectionMetrics.controlsBytes) }} · {{ snapshot.manifest.parsed.sectionMetrics.controlsCharacters }} chars</dd></div>
          </dl>
          <p class="metric-note">Bytes and characters are exact compact-JSON measurements of normalized captured values. Tokens are an explicitly labelled byte-based estimate.</p>
        </section>
        <section>
          <h4>Request controls</h4>
          <pre>{{ JSON.stringify(snapshot.manifest.parsed.requestControls, null, 2) }}</pre>
        </section>
        <section v-if="Object.keys(snapshot.manifest.parsed.unknownFields).length">
          <h4>Unrecognized top-level fields (preserved in raw JSON)</h4>
          <pre>{{ JSON.stringify(snapshot.manifest.parsed.unknownFields, null, 2) }}</pre>
        </section>
        <section class="warnings">
          <h4>Fidelity limitations</h4>
          <ul>
            <li v-for="warning in [...snapshot.manifest.warnings, ...snapshot.manifest.parsed.warnings]" :key="warning">{{ warning }}</li>
          </ul>
        </section>
      </div>
      <ContextCaptureSystem v-else-if="view === 'system'" :blocks="snapshot.manifest.parsed.systemBlocks" />
      <ContextCaptureMessages v-else-if="view === 'messages'" :messages="snapshot.manifest.parsed.messages" />
      <ContextCaptureTools v-else-if="view === 'tools'" :tools="snapshot.manifest.parsed.toolDefinitions" />
      <ContextCaptureRaw v-else :raw-body="snapshot.rawBody" :sha256="snapshot.manifest.rawBodySha256" />
    </div>
    <template #footer>
      <ActionButton v-if="snapshot?.manifest.saved" class="btn-danger" @click="emit('delete', snapshot.manifest.captureId)">Delete snapshot…</ActionButton>
      <ActionButton @click="emit('update:visible', false)">Close</ActionButton>
    </template>
  </ModalDialog>
</template>

<style scoped>
.capture-viewer { display: grid; gap: 16px; width: min(980px, 82vw); }
header { display: flex; justify-content: space-between; gap: 20px; }
header p { margin: 4px 0; color: var(--accent-fg); }
header span { color: var(--text-secondary); }
.badges { display: flex; flex-wrap: wrap; align-content: flex-start; justify-content: flex-end; gap: 6px; }
.overview { display: grid; gap: 14px; max-height: 62vh; overflow: auto; padding-right: 4px; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
section { border: 1px solid var(--border-muted); border-radius: var(--radius-md); padding: 12px; }
h4 { margin: 0 0 10px; }
dl { display: grid; gap: 7px; margin: 0; }
dl div { display: grid; grid-template-columns: 180px 1fr; gap: 12px; }
dt { color: var(--text-tertiary); }
dd { margin: 0; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; padding: 10px; background: var(--canvas-inset); border-radius: var(--radius-sm); }
.metric-note { color: var(--text-tertiary); font-size: 12px; }
.warnings { border-color: var(--warning-muted); }
.warnings ul { margin: 0; padding-left: 20px; }
</style>
