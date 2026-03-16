<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import {
  StatCard, Badge, SectionPanel, DefList,
  formatDate, formatDuration, useSessionTabLoader,
} from "@tracepilot/ui";

const store = useSessionDetailStore();
const route = useRoute();

useSessionTabLoader(
  () => store.sessionId,
  () => { store.loadCheckpoints(); store.loadShutdownMetrics(); }
);

const detail= computed(() => store.detail);
const metrics = computed(() => store.shutdownMetrics);

const sessionInfoItems = computed(() => {
  const d = detail.value;
  return [
    { label: "Session ID", value: d?.id ?? "—" },
    { label: "Repository", value: d?.repository ?? "—" },
    { label: "Branch", value: d?.branch ?? "—" },
    { label: "Model", value: metrics.value?.currentModel ?? "—" },
    { label: "Host", value: d?.hostType ?? "—" },
    { label: "Duration", value: formatDuration(metrics.value?.totalApiDurationMs) },
    { label: "Created", value: formatDate(d?.createdAt) },
    { label: "Updated", value: formatDate(d?.updatedAt) },
  ];
});

const summaryText = computed(() => detail.value?.summary);
</script>

<template>
  <div>
    <!-- Stats row -->
    <div class="grid-4 mb-6">
      <StatCard :value="detail?.eventCount ?? 0" label="Events" :gradient="true" />
      <StatCard :value="detail?.turnCount ?? 0" label="Turns" :gradient="true" />
      <StatCard :value="detail?.checkpointCount ?? 0" label="Checkpoints" color="success" />
      <StatCard
        :value="metrics?.totalPremiumRequests?.toFixed(1) ?? '—'"
        label="Premium Requests"
        color="done"
      />
    </div>

    <!-- Two-column layout -->
    <div class="grid-2 mb-6">
      <!-- Session Info -->
      <SectionPanel title="Session Info">
        <DefList :items="sessionInfoItems" />
      </SectionPanel>

      <!-- Session Summary -->
      <SectionPanel title="Session Summary">
        <p v-if="summaryText" class="summary-prose">{{ summaryText }}</p>
        <p v-else class="summary-prose" style="font-style: italic;">No summary available.</p>
        <dl class="def-list" style="margin-top: 14px;">
          <dt>API Duration</dt>
          <dd>{{ formatDuration(metrics?.totalApiDurationMs) }}</dd>
          <dt>Current Model</dt>
          <dd>
            <Badge v-if="metrics?.currentModel" variant="done">{{ metrics.currentModel }}</Badge>
            <span v-else>—</span>
          </dd>
          <dt>Shutdown Type</dt>
          <dd>{{ metrics?.shutdownType ?? "—" }}</dd>
          <template v-if="metrics?.codeChanges">
            <dt>Code Changes</dt>
            <dd>
              <span style="color: var(--success-fg); font-weight: 600;">+{{ metrics.codeChanges.linesAdded ?? 0 }}</span>
              <span style="color: var(--text-tertiary);"> / </span>
              <span style="color: var(--danger-fg); font-weight: 600;">−{{ metrics.codeChanges.linesRemoved ?? 0 }}</span>
            </dd>
          </template>
        </dl>
      </SectionPanel>
    </div>

    <!-- Checkpoints -->
    <SectionPanel
      v-if="store.checkpoints.length > 0"
      :title="`Checkpoints (${store.checkpoints.length})`"
      class="mb-6"
    >
      <div
        v-for="cp in store.checkpoints"
        :key="cp.number"
        class="checkpoint-item"
      >
        <div class="checkpoint-number">{{ cp.number }}</div>
        <div class="checkpoint-body">
          <div class="checkpoint-title">{{ cp.title }}</div>
          <div class="checkpoint-file font-mono">{{ cp.filename }}</div>
        </div>
      </div>
    </SectionPanel>

    <!-- Link to Timeline -->
    <router-link
      :to="{ name: 'session-timeline', params: { id: route.params.id } }"
      class="timeline-link"
    >
      View Session Timeline →
    </router-link>
  </div>
</template>
