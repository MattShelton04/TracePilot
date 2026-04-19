<script setup lang="ts">
/**
 * SdkLiveIndicators — transient live-event banners for SdkSteeringPanel.
 *
 * Renders (from top to bottom as space allows):
 *   - Abort acknowledgment chip (fires on `abort` event, auto-dismisses)
 *   - Compaction banner (session.compaction_start → complete)
 *   - Truncation warning (session.truncation, one-time)
 *   - Handoff notice (session.handoff)
 *   - Snapshot rewind notice (session.snapshot_rewind)
 *
 * All items auto-dismiss after a short delay or when the user clicks.
 * Injected via SdkLiveSessionKey provided by ChatViewMode.
 */
import { onUnmounted, watch } from "vue";
import { useSdkLiveSessionContext } from "@/composables/useLiveSdkSession";

const live = useSdkLiveSessionContext();

// Auto-dismiss abort chip after 4 s.
let abortTimer: ReturnType<typeof setTimeout> | null = null;
let truncationTimer: ReturnType<typeof setTimeout> | null = null;
let compactionTimer: ReturnType<typeof setTimeout> | null = null;

if (live) {
  watch(
    () => live.abortReason.value,
    (v) => {
      if (v) {
        if (abortTimer) clearTimeout(abortTimer);
        abortTimer = setTimeout(() => live.clearAbort(), 4000);
      }
    },
  );

  watch(
    () => live.lastTruncation.value,
    (v) => {
      if (v) {
        if (truncationTimer) clearTimeout(truncationTimer);
        truncationTimer = setTimeout(() => live.clearTruncation(), 8000);
      }
    },
  );

  // Auto-dismiss the "Context compacted" banner after 6 s.
  watch(
    () => live.compaction.lastCompletedAt,
    (v) => {
      if (v != null) {
        if (compactionTimer) clearTimeout(compactionTimer);
        compactionTimer = setTimeout(() => live.clearCompaction(), 6000);
      }
    },
  );
}

onUnmounted(() => {
  if (abortTimer) clearTimeout(abortTimer);
  if (truncationTimer) clearTimeout(truncationTimer);
  if (compactionTimer) clearTimeout(compactionTimer);
});

function formatNumber(n: number | null): string {
  if (n == null) return "…";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
</script>

<template>
  <template v-if="live">
    <!-- Abort acknowledgment -->
    <div v-if="live.abortReason.value" class="sdk-live-banner abort" @click="live.clearAbort()">
      <span class="sdk-live-banner-icon">⏹</span>
      <span class="sdk-live-banner-text">Aborted: {{ live.abortReason.value }}</span>
      <button class="sdk-live-banner-dismiss" title="Dismiss" aria-label="Dismiss abort notification" @click.stop="live.clearAbort()">✕</button>
    </div>

    <!-- Compaction in progress -->
    <div v-if="live.compaction.status === 'compacting'" class="sdk-live-banner compacting">
      <span class="sdk-live-banner-icon sdk-live-spin">🗜️</span>
      <span class="sdk-live-banner-text">Compacting context…</span>
    </div>

    <!-- Compaction complete (brief) -->
    <div
      v-if="live.compaction.status === 'idle' && live.compaction.lastCompletedAt"
      class="sdk-live-banner compacted"
      @click="live.clearCompaction()"
    >
      <span class="sdk-live-banner-icon">✓</span>
      <span class="sdk-live-banner-text">
        Context compacted
        <template v-if="live.compaction.checkpointNumber != null">
          — checkpoint #{{ live.compaction.checkpointNumber }}
        </template>
        <template v-if="live.compaction.preTokens != null && live.compaction.postTokens != null">
          ({{ formatNumber(live.compaction.preTokens) }} → {{ formatNumber(live.compaction.postTokens) }} tokens)
        </template>
      </span>
      <button class="sdk-live-banner-dismiss" title="Dismiss" aria-label="Dismiss compaction notice" @click.stop="live.clearCompaction()">✕</button>
    </div>

    <!-- Truncation warning -->
    <div
      v-if="live.lastTruncation.value"
      class="sdk-live-banner truncation"
      @click="live.clearTruncation()"
    >
      <span class="sdk-live-banner-icon">⚠️</span>
      <span class="sdk-live-banner-text">
        Context truncated — {{ formatNumber(live.lastTruncation.value.tokensRemoved) }} tokens removed
      </span>
      <button class="sdk-live-banner-dismiss" title="Dismiss" aria-label="Dismiss truncation notice" @click.stop="live.clearTruncation()">✕</button>
    </div>

    <!-- Handoff notice -->
    <div
      v-if="live.pendingHandoff.value"
      class="sdk-live-banner handoff"
      @click="live.clearHandoff()"
    >
      <span class="sdk-live-banner-icon">↔️</span>
      <span class="sdk-live-banner-text">
        Handed off
        <template v-if="live.pendingHandoff.value.repository">
          from
          <code class="sdk-live-code">
            {{ live.pendingHandoff.value.repository.owner }}/{{ live.pendingHandoff.value.repository.name }}
            <template v-if="live.pendingHandoff.value.repository.branch">
              ({{ live.pendingHandoff.value.repository.branch }})
            </template>
          </code>
        </template>
      </span>
      <button class="sdk-live-banner-dismiss" title="Dismiss" aria-label="Dismiss handoff notice" @click.stop="live.clearHandoff()">✕</button>
    </div>

    <!-- Snapshot rewind notice -->
    <div
      v-if="live.lastSnapshotRewind.value"
      class="sdk-live-banner rewind"
      @click="live.clearRewind()"
    >
      <span class="sdk-live-banner-icon">⏪</span>
      <span class="sdk-live-banner-text">
        Rewound {{ live.lastSnapshotRewind.value.eventsRemoved }} events
      </span>
      <button class="sdk-live-banner-dismiss" title="Dismiss" aria-label="Dismiss rewind notice" @click.stop="live.clearRewind()">✕</button>
    </div>
  </template>
</template>

<style scoped>
.sdk-live-banner {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 11px;
  margin-bottom: 5px;
  border-radius: var(--radius-md);
  font-size: 0.6875rem;
  border: 1px solid transparent;
  cursor: pointer;
  transition: opacity var(--transition-fast);
  animation: sdk-live-slidein 0.2s ease-out;
}

@keyframes sdk-live-slidein {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.sdk-live-banner.abort {
  background: rgba(251, 113, 133, 0.08);
  border-color: rgba(251, 113, 133, 0.2);
  color: var(--danger-fg);
}

.sdk-live-banner.compacting {
  background: rgba(99, 102, 241, 0.07);
  border-color: rgba(99, 102, 241, 0.2);
  color: var(--accent-fg);
  cursor: default;
}

.sdk-live-banner.compacted {
  background: rgba(52, 211, 153, 0.07);
  border-color: rgba(52, 211, 153, 0.2);
  color: var(--success-fg);
}

.sdk-live-banner.truncation {
  background: rgba(251, 191, 36, 0.07);
  border-color: rgba(251, 191, 36, 0.2);
  color: var(--warning-fg);
}

.sdk-live-banner.handoff {
  background: rgba(99, 102, 241, 0.07);
  border-color: rgba(99, 102, 241, 0.2);
  color: var(--accent-fg);
}

.sdk-live-banner.rewind {
  background: rgba(99, 102, 241, 0.07);
  border-color: rgba(99, 102, 241, 0.2);
  color: var(--accent-fg);
}

.sdk-live-banner-icon {
  flex-shrink: 0;
  font-size: 0.75rem;
  line-height: 1;
}

.sdk-live-spin {
  animation: sdk-live-rotate 1.4s linear infinite;
}

@keyframes sdk-live-rotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.sdk-live-banner-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-live-banner-dismiss {
  background: none;
  border: none;
  color: currentColor;
  font-size: 0.5625rem;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  opacity: 0.5;
  transition: opacity var(--transition-fast);
  font-family: inherit;
  flex-shrink: 0;
}

.sdk-live-banner-dismiss:hover {
  opacity: 1;
}

.sdk-live-code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.5625rem;
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
