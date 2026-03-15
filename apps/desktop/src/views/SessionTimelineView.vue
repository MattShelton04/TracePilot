<script setup lang="ts">
// STUB: Timeline positions derived from turn indices (not real timestamps).
// STUB: When real timing data is available, use actual timestamps for proportional positioning.
// STUB: Swimlane layout uses CSS grid — consider canvas/SVG for very long sessions.

import { ref, computed, watch } from 'vue';
import { useSessionDetailStore } from '@/stores/sessionDetail';
import type { ConversationTurn, TurnToolCall } from '@tracepilot/types';

const store = useSessionDetailStore();

// Load turns when component mounts (if not already loaded)
watch(
  () => store.detail,
  (d) => {
    if (d) store.loadTurns();
  },
  { immediate: true },
);

// ── Swimlane types ───────────────────────────────────────────

interface SwimlaneBlock {
  id: string;
  label: string;
  type: 'user' | 'assistant' | 'tool';
  leftPct: number;
  widthPct: number;
  color: string;
  turn?: ConversationTurn;
  toolCall?: TurnToolCall;
}

interface SwimlaneDetailData {
  type: string;
  label: string;
  timestamp: string;
  duration: string;
  tokens: string;
  content: string;
  toolCalls: Array<{ name: string; success: boolean; durationMs: number; file?: string }>;
}

// ── Zoom state ───────────────────────────────────────────────
const zoomLevel = ref(1);
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

function zoomIn() {
  zoomLevel.value = Math.min(zoomLevel.value + 0.25, MAX_ZOOM);
}
function zoomOut() {
  zoomLevel.value = Math.max(zoomLevel.value - 0.25, MIN_ZOOM);
}

// ── Transform turns into swimlane blocks ─────────────────────

const totalTurns = computed(() => store.turns.length || 1);

interface Lane {
  name: string;
  blocks: SwimlaneBlock[];
}

const lanes = computed<Lane[]>(() => {
  const turns = store.turns;
  if (!turns.length) return [];

  const userBlocks: SwimlaneBlock[] = [];
  const assistantBlocks: SwimlaneBlock[] = [];
  const toolBlocks: SwimlaneBlock[] = [];
  const count = turns.length;
  const slotWidth = 100 / count;

  turns.forEach((turn, i) => {
    const base = i * slotWidth;

    // User message block
    if (turn.userMessage) {
      userBlocks.push({
        id: `user-${turn.turnIndex}`,
        label: turn.userMessage.slice(0, 40) + (turn.userMessage.length > 40 ? '…' : ''),
        type: 'user',
        leftPct: base + slotWidth * 0.02,
        widthPct: slotWidth * 0.25,
        color: '#6366f1',
        turn,
      });
    }

    // Assistant response block
    if (turn.assistantMessages.length > 0) {
      const msg = turn.assistantMessages[0];
      assistantBlocks.push({
        id: `assistant-${turn.turnIndex}`,
        label: msg.slice(0, 40) + (msg.length > 40 ? '…' : ''),
        type: 'assistant',
        leftPct: base + slotWidth * 0.2,
        widthPct: slotWidth * 0.6,
        color: '#34d399',
        turn,
      });
    }

    // Tool call blocks
    const toolCount = turn.toolCalls.length;
    if (toolCount > 0) {
      const toolSlot = (slotWidth * 0.7) / toolCount;
      turn.toolCalls.forEach((tc, j) => {
        const failed = tc.success === false;
        toolBlocks.push({
          id: `tool-${turn.turnIndex}-${j}`,
          label: tc.toolName,
          type: 'tool',
          leftPct: base + slotWidth * 0.15 + j * toolSlot,
          widthPct: Math.max(toolSlot * 0.85, 1),
          color: failed ? '#fb7185' : '#fbbf24',
          turn,
          toolCall: tc,
        });
      });
    }
  });

  return [
    { name: 'User', blocks: userBlocks },
    { name: 'Assistant', blocks: assistantBlocks },
    { name: 'Tools', blocks: toolBlocks },
  ];
});

// ── Time axis markers ────────────────────────────────────────

const timeMarkers = computed(() => {
  const turns = store.turns;
  if (!turns.length) return [];

  const count = turns.length;
  const step = Math.max(1, Math.floor(count / 6));
  const markers: Array<{ label: string; leftPct: number }> = [];

  for (let i = 0; i < count; i += step) {
    const turn = turns[i];
    const ts = turn.timestamp ? new Date(turn.timestamp) : null;
    const label = ts
      ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : `Turn ${turn.turnIndex}`;
    markers.push({ label, leftPct: (i / count) * 100 });
  }

  // Always include last turn
  const last = turns[count - 1];
  const lastTs = last.timestamp ? new Date(last.timestamp) : null;
  markers.push({
    label: lastTs
      ? lastTs.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : `Turn ${last.turnIndex}`,
    leftPct: 100,
  });

  return markers;
});

// ── Selection ────────────────────────────────────────────────

const selectedBlock = ref<SwimlaneBlock | null>(null);

function selectBlock(block: SwimlaneBlock) {
  selectedBlock.value = selectedBlock.value?.id === block.id ? null : block;
}

const selectedDetail = computed<SwimlaneDetailData | null>(() => {
  const block = selectedBlock.value;
  if (!block) return null;

  const turn = block.turn;
  const tc = block.toolCall;

  if (block.type === 'tool' && tc) {
    return {
      type: 'Tool Call',
      label: tc.toolName,
      timestamp: tc.startedAt
        ? new Date(tc.startedAt).toLocaleTimeString()
        : turn?.timestamp
          ? new Date(turn.timestamp).toLocaleTimeString()
          : '—',
      duration: tc.durationMs ? `${(tc.durationMs / 1000).toFixed(1)}s` : '—',
      tokens: '—',
      content: tc.error || (tc.arguments ? JSON.stringify(tc.arguments, null, 2).slice(0, 200) : '—'),
      toolCalls: [],
    };
  }

  if (!turn) return null;

  const content = block.type === 'user'
    ? (turn.userMessage ?? '—')
    : (turn.assistantMessages[0] ?? '—');

  return {
    type: block.type === 'user' ? 'User Message' : 'Assistant Response',
    label: content.slice(0, 60) + (content.length > 60 ? '…' : ''),
    timestamp: turn.timestamp
      ? new Date(turn.timestamp).toLocaleTimeString()
      : '—',
    duration: turn.durationMs ? formatDuration(turn.durationMs) : '—',
    tokens: '—',
    content: content.slice(0, 500),
    toolCalls: turn.toolCalls.map((tc) => ({
      name: tc.toolName,
      success: tc.success !== false,
      durationMs: tc.durationMs ?? 0,
      file: extractFileFromArgs(tc.arguments),
    })),
  };
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function extractFileFromArgs(args: unknown): string | undefined {
  if (args && typeof args === 'object' && 'path' in args) {
    return String((args as Record<string, unknown>).path);
  }
  if (args && typeof args === 'object' && 'command' in args) {
    return String((args as Record<string, unknown>).command);
  }
  return undefined;
}

function toolBadgeClass(success: boolean): string {
  return success ? 'badge badge-warning' : 'badge badge-danger';
}
</script>

<template>
  <div>
    <!-- Loading state -->
    <div v-if="store.loading" class="empty-state">
      <div class="empty-state-icon">⏳</div>
      <h2 class="empty-state-title">Loading session…</h2>
    </div>

    <!-- Empty state -->
    <div v-else-if="!store.turns.length" class="empty-state">
      <div class="empty-state-icon">📊</div>
      <h2 class="empty-state-title">No Timeline Data</h2>
      <p class="empty-state-desc">This session has no conversation turns to visualize.</p>
    </div>

    <template v-else>
      <!-- Page Title -->
      <div class="mb-4">
        <h2 class="page-title" style="font-size: 1.125rem;">Session Timeline</h2>
        <p class="page-subtitle">Visual timeline of session events and interactions</p>
      </div>

      <!-- Session Info Bar -->
      <div class="session-info-bar" aria-label="Session metadata">
        <span class="session-info-pill">
          <span class="pill-label">ID</span>
          <code class="font-mono" style="font-size: 0.6875rem; color: var(--accent-fg);">
            {{ store.detail?.id?.slice(0, 8) }}…{{ store.detail?.id?.slice(-7) }}
          </code>
        </span>
        <span v-if="store.shutdownMetrics?.currentModel" class="badge badge-accent">
          {{ store.shutdownMetrics.currentModel }}
        </span>
        <span class="session-info-pill">
          <span class="pill-label">Turns</span>
          {{ store.turns.length }}
        </span>
        <span class="session-info-pill">
          <span class="pill-label">Events</span>
          {{ store.detail?.eventCount?.toLocaleString() ?? '—' }}
        </span>
      </div>

      <!-- Timeline controls -->
      <div class="timeline-controls mb-4">
        <button class="btn btn-sm" :disabled="zoomLevel <= MIN_ZOOM" @click="zoomOut">− Zoom Out</button>
        <span class="zoom-label">{{ Math.round(zoomLevel * 100) }}%</span>
        <button class="btn btn-sm" :disabled="zoomLevel >= MAX_ZOOM" @click="zoomIn">+ Zoom In</button>
      </div>

      <!-- Time Axis -->
      <div class="time-axis" aria-label="Time axis">
        <span
          v-for="(marker, mi) in timeMarkers"
          :key="`tm-${mi}`"
          class="time-marker"
          :style="{ left: marker.leftPct + '%' }"
        >
          {{ marker.label }}
        </span>
      </div>

      <!-- Swimlane Visualization -->
      <div class="section-panel mb-6" aria-label="Session activity swimlanes">
        <div class="section-panel-header">Activity Lanes</div>
        <div class="section-panel-body" style="padding: 0;">
          <div
            class="swimlane-container"
            :style="{ width: (100 * zoomLevel) + '%' }"
          >
            <div
              v-for="lane in lanes"
              :key="lane.name"
              class="swimlane"
              role="row"
              :aria-label="`${lane.name} activity lane`"
            >
              <div class="swimlane-label">{{ lane.name }}</div>
              <div class="swimlane-track swimlane-track-tall">
                <div
                  v-for="block in lane.blocks"
                  :key="block.id"
                  class="swimlane-bar"
                  :class="{ 'swimlane-bar--active': selectedBlock?.id === block.id }"
                  :style="{
                    left: block.leftPct + '%',
                    width: block.widthPct + '%',
                    background: block.color,
                  }"
                  :title="block.label"
                  :aria-label="`${block.type}: ${block.label}`"
                  @click="selectBlock(block)"
                >
                  {{ block.label }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Event Detail Panel -->
      <div v-if="selectedDetail" class="section-panel" aria-label="Selected event details">
        <div class="section-panel-header">Event Details</div>
        <div class="section-panel-body">
          <div class="event-detail-grid">
            <div class="event-detail-meta">
              <div class="event-meta-row">
                <span class="event-meta-label">Type</span>
                <span class="badge badge-success">{{ selectedDetail.type }}</span>
              </div>
              <div class="event-meta-row">
                <span class="event-meta-label">Timestamp</span>
                <span class="event-meta-value font-mono">{{ selectedDetail.timestamp }}</span>
              </div>
              <div class="event-meta-row">
                <span class="event-meta-label">Duration</span>
                <span class="event-meta-value">{{ selectedDetail.duration }}</span>
              </div>
              <div v-if="selectedDetail.tokens !== '—'" class="event-meta-row">
                <span class="event-meta-label">Tokens</span>
                <span class="event-meta-value">{{ selectedDetail.tokens }}</span>
              </div>
              <div style="margin-top: 12px;">
                <div class="event-description">{{ selectedDetail.content }}</div>
              </div>
            </div>
            <div v-if="selectedDetail.toolCalls.length">
              <div class="tool-calls-heading">Related Tool Calls</div>
              <div class="tool-call-list">
                <div
                  v-for="(tc, ti) in selectedDetail.toolCalls"
                  :key="`tc-${ti}`"
                  class="tool-call-item"
                >
                  <span :class="toolBadgeClass(tc.success)" style="font-size: 0.625rem; padding: 1px 6px;">
                    {{ tc.name }}
                  </span>
                  <span v-if="tc.file" class="tool-call-file">{{ tc.file }}</span>
                  <span v-if="tc.durationMs" class="tool-call-duration">
                    {{ (tc.durationMs / 1000).toFixed(1) }}s
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mb-4 {
  margin-bottom: 20px;
}
.mb-6 {
  margin-bottom: 24px;
}

/* Session info bar */
.session-info-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.session-info-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}
.session-info-pill .pill-label {
  color: var(--text-tertiary);
  font-weight: 400;
}

/* Timeline controls */
.timeline-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}
.zoom-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
  min-width: 42px;
  text-align: center;
}
.btn-sm {
  padding: 4px 10px;
  font-size: 0.6875rem;
  font-weight: 500;
  border-radius: 4px;
  border: 1px solid var(--border-default);
  background: var(--canvas-raised);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s;
}
.btn-sm:hover:not(:disabled) {
  background: var(--neutral-subtle);
}
.btn-sm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Time axis */
.time-axis {
  position: relative;
  height: 28px;
  margin-bottom: 4px;
  padding-left: 100px;
}
.time-axis::before {
  content: '';
  position: absolute;
  left: 100px;
  right: 0;
  top: 50%;
  height: 1px;
  background: var(--border-default);
}
.time-marker {
  position: absolute;
  z-index: 1;
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  background: var(--canvas-default);
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid var(--border-muted);
  transform: translateX(-50%);
}

/* Swimlane overrides */
.swimlane-container {
  position: relative;
  overflow-x: auto;
}
.swimlane-track-tall {
  min-height: 48px;
}
.swimlane-bar {
  cursor: pointer;
  transition: opacity 0.15s, box-shadow 0.15s;
}
.swimlane-bar:hover {
  opacity: 0.85;
}
.swimlane-bar--active {
  box-shadow: 0 0 0 2px var(--accent-fg);
  z-index: 2;
}

/* Event detail panel */
.event-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.event-detail-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.event-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
}
.event-meta-label {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 500;
  min-width: 80px;
}
.event-meta-value {
  color: var(--text-secondary);
  font-size: 0.8125rem;
}
.event-description {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.65;
  padding: 12px;
  background: var(--canvas-subtle);
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-calls-heading {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.tool-call-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tool-call-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-subtle);
  font-size: 0.75rem;
}
.tool-call-file {
  color: var(--text-tertiary);
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
}
.tool-call-duration {
  margin-left: auto;
  color: var(--text-tertiary);
}

@media (max-width: 768px) {
  .event-detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
