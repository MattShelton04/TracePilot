<script setup lang="ts">
import {
  ActionButton,
  Badge,
  EmptyState,
  ErrorAlert,
  formatBytes,
  formatDateMedium,
  LoadingSpinner,
  PageHeader,
  SectionPanel,
  useConfirmDialog,
} from "@tracepilot/ui";
import { Camera, FileJson2, ShieldCheck } from "lucide-vue-next";
import { computed, onMounted } from "vue";
import { useContextCapture } from "@/composables/useContextCapture";
import ContextCapturePreflight from "./ContextCapturePreflight.vue";
import ContextCaptureProgress from "./ContextCaptureProgress.vue";
import ContextCaptureViewer from "./ContextCaptureViewer.vue";

const props = defineProps<{ sessionId: string }>();
const sessionId = computed(() => props.sessionId);
const capture = useContextCapture(sessionId);
const { confirm } = useConfirmDialog();

function closePreflight() {
  capture.preflight.value = null;
  capture.progress.value = null;
  capture.error.value = null;
}

function closeSnapshot() {
  capture.snapshot.value = null;
  capture.error.value = null;
}

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
  <div class="capture-workspace">
    <ContextCaptureViewer
      v-if="capture.snapshot.value"
      :snapshot="capture.snapshot.value"
      @close="closeSnapshot"
      @delete="deleteSnapshot"
    />

    <div v-else-if="capture.preflight.value" class="capture-run-surface">
      <ErrorAlert v-if="capture.error.value" :message="capture.error.value" variant="inline" />
      <ContextCaptureProgress
        v-if="capture.capturing.value"
        :progress="capture.progress.value"
        @cancel="capture.cancelCapture"
      />
      <ContextCapturePreflight
        v-else
        :preflight="capture.preflight.value"
        :protocol="capture.selectedProtocol.value"
        :save="capture.saveSnapshot.value"
        @update:protocol="capture.selectedProtocol.value = $event"
        @update:save="capture.saveSnapshot.value = $event"
        @cancel="closePreflight"
        @capture="capture.startCapture"
      />
    </div>

    <template v-else>
      <PageHeader
        title="Request snapshots"
        subtitle="Inspect the exact client request body produced by an isolated capture run."
        icon-name="camera"
        density="compact"
      >
        <template #actions>
          <ActionButton
            variant="primary"
            :loading="capture.loading.value"
            @click="capture.runPreflight"
          >
            <Camera :size="14" /> New capture
          </ActionButton>
        </template>
      </PageHeader>

      <ErrorAlert v-if="capture.error.value" :message="capture.error.value" variant="inline" />

      <div class="capture-disclosure">
        <div class="capture-disclosure__icon"><ShieldCheck :size="20" /></div>
        <div>
          <strong>Local, isolated, and never forwarded</strong>
          <p>
            TracePilot resumes a private session copy, intercepts one loopback request, and stops
            before inference. Saved snapshots are plaintext and may contain sensitive context.
          </p>
        </div>
      </div>

      <SectionPanel title="Saved snapshots">
        <div v-if="capture.loading.value" class="capture-loading">
          <LoadingSpinner size="sm" /> Loading snapshots…
        </div>

        <div v-else-if="capture.summaries.value.length" class="capture-list">
          <button
            v-for="item in capture.summaries.value"
            :key="item.captureId"
            type="button"
            class="capture-list__row"
            @click="capture.openCapture(item.captureId)"
          >
            <span class="capture-list__icon"><FileJson2 :size="18" /></span>
            <span class="capture-list__identity">
              <strong>{{ formatDateMedium(item.capturedAt) }}</strong>
              <small>{{ item.model ?? 'Unknown model' }} · {{ item.protocol }}</small>
            </span>
            <span class="capture-list__metrics">
              <span>{{ formatBytes(item.rawBodyBytes) }}</span>
              <span>{{ item.messageCount }} items</span>
              <span>{{ item.toolCount }} tools</span>
              <Badge v-if="item.warningCount" variant="warning">
                {{ item.warningCount }} notes
              </Badge>
            </span>
          </button>
        </div>

        <EmptyState
          v-else
          title="No saved request snapshots"
          description="Run an isolated capture to inspect what Copilot CLI serializes for this session. View-once captures are not retained after you leave this session."
        >
          <template #icon><FileJson2 /></template>
        </EmptyState>
      </SectionPanel>
    </template>
  </div>
</template>

<style scoped>
.capture-workspace {
  min-width: 0;
}

.capture-run-surface {
  min-height: 620px;
}

.capture-disclosure {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  padding: 16px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
  background: var(--surface-secondary);
}

.capture-disclosure__icon,
.capture-list__icon {
  display: grid;
  flex: none;
  place-items: center;
  color: var(--accent-fg);
}

.capture-disclosure__icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--accent-muted);
}

.capture-disclosure p {
  max-width: 780px;
  margin: 4px 0 0;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.capture-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 120px;
  justify-content: center;
  color: var(--text-tertiary);
}

.capture-list {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-list__row {
  display: grid;
  grid-template-columns: 36px minmax(180px, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border: 0;
  border-bottom: 1px solid var(--border-muted);
  background: var(--canvas-default);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.capture-list__row:last-child {
  border-bottom: 0;
}

.capture-list__row:hover {
  background: var(--surface-secondary);
}

.capture-list__identity {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.capture-list__identity small,
.capture-list__metrics {
  color: var(--text-tertiary);
}

.capture-list__identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-list__metrics {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  font-size: 0.75rem;
}

@media (max-width: 760px) {
  .capture-list__row {
    grid-template-columns: 32px 1fr;
  }

  .capture-list__metrics {
    grid-column: 2;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>
