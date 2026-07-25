<script setup lang="ts">
import type { CaptureProgress } from "@tracepilot/types";
import { ActionButton, LoadingSpinner, PageHeader, ProgressBar } from "@tracepilot/ui";
import { Check, Circle } from "lucide-vue-next";
import { computed } from "vue";

const props = withDefaults(
  defineProps<{ progress: CaptureProgress | null; benchmark?: boolean }>(),
  { benchmark: false },
);
const emit = defineEmits<{ cancel: [] }>();
const stages = computed(() => [
  {
    value: "preflight",
    label: props.benchmark ? "Verify CLI and storage" : "Verify session and CLI",
  },
  props.benchmark
    ? { value: "preparingEnvironment", label: "Prepare temporary environment" }
    : { value: "copyingSession", label: "Copy session into private storage" },
  { value: "startingListener", label: "Start loopback capture endpoint" },
  {
    value: "resumingClone",
    label: props.benchmark ? "Start a fresh CLI session" : "Resume the isolated clone",
  },
  { value: "waitingForRequest", label: "Receive one model request" },
  { value: "parsingSnapshot", label: "Validate and parse the payload" },
  { value: "savingSnapshot", label: "Save the immutable request" },
  { value: "cleaningUp", label: "Remove temporary state" },
  { value: "complete", label: "Capture complete" },
]);
const activeIndex = computed(() =>
  Math.max(
    0,
    stages.value.findIndex((stage) => stage.value === props.progress?.stage),
  ),
);
const copyPercent = computed(() => {
  if (props.progress?.stage !== "copyingSession" || !props.progress.totalBytes) return null;
  return ((props.progress.bytesCopied ?? 0) / props.progress.totalBytes) * 100;
});
</script>

<template>
  <div class="capture-progress">
    <PageHeader
      :title="benchmark ? 'Capturing CLI context' : 'Capturing isolated request'"
      :subtitle="benchmark ? 'A fresh temporary CLI session will stop after its first model request.' : 'The source session remains untouched and no request is forwarded to a provider.'"
      icon-name="loader-circle"
      density="compact"
    >
      <template #actions>
        <ActionButton :disabled="progress?.cancellable === false" @click="emit('cancel')">
          Cancel capture
        </ActionButton>
      </template>
    </PageHeader>

    <div class="capture-progress__body">
      <div class="capture-progress__current">
        <LoadingSpinner size="lg" />
        <div>
          <span>Capture in progress</span>
          <strong>{{ progress?.message ?? 'Preparing capture…' }}</strong>
        </div>
      </div>

      <ProgressBar
        v-if="copyPercent != null"
        :percent="copyPercent"
        aria-label="Session copy progress"
      />

      <ol class="capture-progress__steps">
        <li
          v-for="(stage, index) in stages"
          :key="stage.value"
          :class="{
            'is-active': index === activeIndex,
            'is-complete': index < activeIndex,
          }"
        >
          <span class="capture-progress__marker">
            <Check v-if="index < activeIndex" :size="13" />
            <Circle v-else :size="11" :fill="index === activeIndex ? 'currentColor' : 'none'" />
          </span>
          <span>{{ stage.label }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.capture-progress {
  display: grid;
  min-height: 620px;
}

.capture-progress__body {
  display: grid;
  align-content: start;
  gap: 20px;
  width: min(680px, 100%);
  margin: 24px auto 0;
  padding: 24px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-xl);
  background: var(--surface-secondary);
}

.capture-progress__current {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 64px;
}

.capture-progress__current > div {
  display: grid;
  gap: 4px;
}

.capture-progress__current span {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.capture-progress__steps {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.capture-progress__steps li {
  position: relative;
  display: grid;
  grid-template-columns: 24px 1fr;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  color: var(--text-tertiary);
}

.capture-progress__steps li::after {
  position: absolute;
  top: 25px;
  bottom: -11px;
  left: 11px;
  width: 1px;
  background: var(--border-muted);
  content: "";
}

.capture-progress__steps li:last-child::after {
  display: none;
}

.capture-progress__steps li.is-active {
  color: var(--accent-fg);
  font-weight: 600;
}

.capture-progress__steps li.is-complete {
  color: var(--text-secondary);
}

.capture-progress__marker {
  z-index: 1;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid var(--border-default);
  border-radius: 999px;
  background: var(--canvas-default);
}

.is-active .capture-progress__marker {
  border-color: var(--accent-emphasis);
  background: var(--accent-muted);
}
</style>
