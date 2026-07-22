<script setup lang="ts">
import {
  ActionButton,
  Badge,
  ErrorAlert,
  formatBytes,
  formatDateMedium,
  LoadingSpinner,
  SectionPanel,
  useConfirmDialog,
} from "@tracepilot/ui";
import { Camera, ShieldCheck } from "lucide-vue-next";
import { computed, onMounted } from "vue";
import { useContextCapture } from "@/composables/useContextCapture";
import ContextCapturePreflight from "./ContextCapturePreflight.vue";
import ContextCaptureProgress from "./ContextCaptureProgress.vue";
import ContextCaptureViewer from "./ContextCaptureViewer.vue";

const props = defineProps<{ sessionId: string }>();
const sessionId = computed(() => props.sessionId);
const capture = useContextCapture(sessionId);
const { confirm } = useConfirmDialog();
const preflightVisible = computed({
  get: () => capture.preflight.value != null && !capture.capturing.value,
  set: (value) => {
    if (!value) capture.preflight.value = null;
  },
});
const viewerVisible = computed({
  get: () => capture.snapshot.value != null,
  set: (value) => {
    if (!value) capture.snapshot.value = null;
  },
});

async function deleteSnapshot(captureId: string) {
  const { confirmed } = await confirm({
    title: "Delete captured request snapshot?",
    message:
      "This permanently removes this snapshot’s exact request JSON and metadata from local storage.",
    variant: "danger",
    confirmLabel: "Delete snapshot",
  });
  if (confirmed) await capture.deleteCapture(captureId);
}

onMounted(capture.setup);
</script>

<template>
  <SectionPanel title="Captured request snapshots" class="context-capture-panel">
    <ErrorAlert v-if="capture.error.value" :message="capture.error.value" variant="inline" />
    <div class="capture-intro">
      <div class="capture-intro__icon"><ShieldCheck :size="22" /></div>
      <div>
        <strong>Exact captured payload · capture run only</strong>
        <p>Resume a private copy of this inactive session and intercept one model API request on loopback. The request is never forwarded to a provider.</p>
      </div>
      <ActionButton variant="primary" :loading="capture.loading.value" @click="capture.runPreflight">
        <Camera :size="14" /> Run preflight
      </ActionButton>
    </div>
    <div v-if="capture.loading.value && capture.summaries.value.length === 0" class="capture-loading"><LoadingSpinner size="sm" /> Loading snapshots…</div>
    <div v-else-if="capture.summaries.value.length" class="capture-list">
      <button v-for="item in capture.summaries.value" :key="item.captureId" type="button" @click="capture.openCapture(item.captureId)">
        <span><strong>{{ formatDateMedium(item.capturedAt) }}</strong><small>{{ item.model ?? 'Unknown model' }} · {{ item.protocol }}</small></span>
        <span class="capture-list__metrics">{{ formatBytes(item.rawBodyBytes) }} · {{ item.messageCount }} messages · {{ item.toolCount }} tools <Badge v-if="item.warningCount" variant="warning">{{ item.warningCount }} notes</Badge></span>
      </button>
    </div>
    <p v-else class="capture-empty">No saved request snapshots. “View once” captures appear only until this session view is closed.</p>
  </SectionPanel>
  <ContextCapturePreflight
    v-if="capture.preflight.value"
    v-model:visible="preflightVisible"
    :preflight="capture.preflight.value"
    :protocol="capture.selectedProtocol.value"
    :save="capture.saveSnapshot.value"
    @update:protocol="capture.selectedProtocol.value = $event"
    @update:save="capture.saveSnapshot.value = $event"
    @capture="capture.startCapture"
  />
  <ContextCaptureProgress :visible="capture.capturing.value" :progress="capture.progress.value" @cancel="capture.cancelCapture" />
  <ContextCaptureViewer v-if="capture.snapshot.value" v-model:visible="viewerVisible" :snapshot="capture.snapshot.value" @delete="deleteSnapshot" />
</template>

<style scoped>
.capture-intro { display: flex; align-items: center; gap: 12px; }
.capture-intro__icon { display: grid; place-items: center; width: 38px; height: 38px; flex: none; color: var(--accent-fg); background: var(--accent-muted); border-radius: var(--radius-md); }
.capture-intro > div:nth-child(2) { flex: 1; }
.capture-intro p { margin: 4px 0 0; color: var(--text-tertiary); line-height: 1.45; }
.capture-loading, .capture-empty { color: var(--text-tertiary); margin: 14px 0 0; }
.capture-list { display: grid; gap: 8px; margin-top: 14px; }
.capture-list button { display: flex; justify-content: space-between; align-items: center; gap: 16px; width: 100%; text-align: left; padding: 10px 12px; border: 1px solid var(--border-muted); border-radius: var(--radius-md); background: var(--surface-secondary); color: var(--text-primary); cursor: pointer; }
.capture-list button:hover { border-color: var(--border-emphasis); }
.capture-list button > span:first-child { display: grid; gap: 3px; }
.capture-list small, .capture-list__metrics { color: var(--text-tertiary); }
.capture-list__metrics { display: flex; align-items: center; gap: 7px; font-size: 12px; }
</style>
