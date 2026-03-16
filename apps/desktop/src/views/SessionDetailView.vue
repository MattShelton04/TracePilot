<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { TabNav, Badge, ErrorAlert, SkeletonLoader } from "@tracepilot/ui";
import { resumeSessionInTerminal } from "@tracepilot/client";

const route = useRoute();
const store = useSessionDetailStore();
const prefs = usePreferencesStore();

const sessionId = computed(() => route.params.id as string);
const resolvedSessionId = computed(() => store.detail?.id ?? sessionId.value);
const copied = ref(false);

async function copyResumeCommand() {
  const text = `${prefs.cliCommand} --resume ${resolvedSessionId.value}`;
  await navigator.clipboard.writeText(text);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

async function resumeInTerminal() {
  try {
    await resumeSessionInTerminal(resolvedSessionId.value, prefs.cliCommand);
  } catch (e) {
    console.error('Failed to open terminal:', e);
  }
}

const tabs = computed(() => [
  { name: "overview", routeName: "session-overview", label: "Overview" },
  { name: "conversation", routeName: "session-conversation", label: "Conversation", count: store.detail?.turnCount },
  { name: "events", routeName: "session-events", label: "Events", count: store.detail?.eventCount },
  { name: "todos", routeName: "session-todos", label: "Todos" },
  { name: "metrics", routeName: "session-metrics", label: "Metrics" },
  { name: "timeline", routeName: "session-timeline", label: "Timeline" },
]);

const currentModel = computed(() =>
  store.detail?.shutdownMetrics?.currentModel ?? "",
);

onMounted(() => {
  store.loadDetail(sessionId.value);
});

watch(sessionId, (newId) => {
  if (newId) {
    store.loadDetail(newId);
  }
});

onUnmounted(() => {
  store.reset();
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">

      <!-- Loading state -->
      <div v-if="store.loading" style="padding-top: 8px;">
        <SkeletonLoader variant="text" :count="1" />
        <SkeletonLoader variant="badge" :count="3" />
      </div>

      <!-- Error state -->
      <ErrorAlert v-if="store.error" :message="store.error" />

      <!-- Session header + tabs + content -->
      <template v-if="store.detail">
        <h1 class="detail-title">
          {{ store.detail.summary || 'Untitled Session' }}
        </h1>
        <div class="detail-badges">
          <Badge v-if="store.detail.repository" variant="accent">{{ store.detail.repository }}</Badge>
          <Badge v-if="store.detail.branch" variant="success">{{ store.detail.branch }}</Badge>
          <Badge v-if="currentModel" variant="done">{{ currentModel }}</Badge>
          <Badge variant="neutral">{{ store.detail.hostType || 'cli' }}</Badge>
        </div>

        <div class="detail-actions">
          <button
            class="resume-btn"
            @click="copyResumeCommand"
            :title="`Copy: ${prefs.cliCommand} --resume ${sessionId}`"
          >
            {{ copied ? '✓ Copied!' : '📋 Copy Resume Command' }}
          </button>
          <button
            class="resume-btn"
            @click="resumeInTerminal"
            :title="`Resume session ${sessionId} in a new terminal`"
          >
            ▶ Resume in Terminal
          </button>
        </div>

        <TabNav :tabs="tabs" />

        <div class="detail-tab-content">
          <router-view :key="`${sessionId}-${String(route.name)}`" />
        </div>
      </template>

    </div>
  </div>
</template>

<style scoped>
.detail-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin: 0 0 8px 0;
}
.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.resume-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.resume-btn:hover {
  background: var(--neutral-subtle);
  border-color: var(--border-accent);
}
.detail-tab-content {
  padding-top: 4px;
}
</style>
