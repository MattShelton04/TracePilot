<script setup lang="ts">
/**
 * ReplaySidebar — right panel with current step details, metrics, files, todos, stats.
 */
import type { ReplayStep, SessionDetail, ShutdownMetrics } from '@tracepilot/types';
import {
  Badge,
  formatDuration,
  formatNumber,
  formatTime,
  MiniTimeline,
  StatCard,
  toolIcon,
} from '@tracepilot/ui';

const props = defineProps<{
  step: ReplayStep | null;
  steps: ReplayStep[];
  currentStepIndex: number;
  totalSteps: number;
  detail: SessionDetail | null;
  shutdownMetrics: ShutdownMetrics | null;
}>();

const emit = defineEmits<{
  'go-to-step': [index: number];
}>();
</script>

<template>
  <div v-if="step" class="replay-sidebar">
    <!-- Current Step Card -->
    <section class="panel-section">
      <h3 class="panel-title">Current Step</h3>
      <div class="step-card">
        <div class="step-card-title">{{ step.title }}</div>
        <div class="step-card-badges">
          <Badge v-if="step.model" variant="done">{{ step.model }}</Badge>
          <Badge v-if="step.richToolCalls?.length" variant="neutral">
            {{ step.richToolCalls.length }} tool call{{ step.richToolCalls.length !== 1 ? 's' : '' }}
          </Badge>
          <Badge v-if="step.hasSubagents" variant="accent">Subagents</Badge>
          <Badge v-if="step.sessionEvents?.length" variant="warning">
            {{ step.sessionEvents.length }} event{{ step.sessionEvents.length !== 1 ? 's' : '' }}
          </Badge>
        </div>
        <div class="kv-grid">
          <div class="kv-item">
            <span class="kv-label">Duration</span>
            <span class="kv-value">{{ formatDuration(step.durationMs) || '—' }}</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">Type</span>
            <span class="kv-value">
              <Badge :variant="step.type === 'user' ? 'accent' : step.type === 'assistant' ? 'success' : 'warning'" size="sm">
                {{ step.type === 'user' ? '👤 User' : step.type === 'assistant' ? '🤖 Assistant' : '🔧 Tool' }}
              </Badge>
            </span>
          </div>
          <div class="kv-item">
            <span class="kv-label">Time</span>
            <span class="kv-value">{{ formatTime(step.timestamp) || '—' }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Step Metrics -->
    <section class="panel-section">
      <h3 class="panel-title">Step Metrics</h3>
      <div class="metric-cards">
        <div class="metric-card">
          <span class="metric-value">{{ formatNumber(step.tokens) }}</span>
          <span class="metric-label">Tokens</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{{ formatDuration(step.durationMs) || '—' }}</span>
          <span class="metric-label">Duration</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{{ step.richToolCalls?.length ?? 0 }}</span>
          <span class="metric-label">Tool Calls</span>
        </div>
        <div class="metric-card">
          <span class="metric-value">{{ step.filesModified?.length ?? 0 }}</span>
          <span class="metric-label">Files</span>
        </div>
      </div>
    </section>

    <!-- Tool Calls Summary -->
    <section v-if="step.richToolCalls?.length" class="panel-section">
      <h3 class="panel-title">Tool Calls</h3>
      <div class="tool-call-list">
        <div
          v-for="tc in step.richToolCalls"
          :key="tc.toolCallId ?? tc.toolName"
          class="tool-row"
          :class="{ 'tool-failed': tc.success === false }"
        >
          <span class="tool-icon-sm">{{ toolIcon(tc.toolName) }}</span>
          <span class="tool-name-sm">{{ tc.toolName }}</span>
          <span v-if="tc.durationMs" class="tool-dur">{{ formatDuration(tc.durationMs) }}</span>
          <span class="tool-status-dot" :class="tc.success === false ? 'fail' : tc.success === true ? 'ok' : 'pending'" />
        </div>
      </div>
    </section>

    <!-- Files Modified -->
    <section v-if="step.filesModified?.length" class="panel-section">
      <h3 class="panel-title">Files Modified</h3>
      <ul class="file-list">
        <li v-for="f in step.filesModified" :key="f" class="file-item">
          <span class="file-icon">📄</span>
          <span class="file-path">{{ f }}</span>
        </li>
      </ul>
    </section>

    <!-- Todos Changed -->
    <section v-if="step.todosChanged?.length" class="panel-section">
      <h3 class="panel-title">Todos Changed</h3>
      <div class="todo-list">
        <div v-for="t in step.todosChanged" :key="t.id" class="todo-row">
          <span class="todo-status-icon" :class="'todo-' + t.status">
            {{ t.status === 'done' ? '✓' : t.status === 'in_progress' ? '◐' : '○' }}
          </span>
          <span class="todo-title">{{ t.title }}</span>
          <Badge :variant="t.status === 'done' ? 'success' : t.status === 'in_progress' ? 'accent' : 'neutral'" size="sm">
            {{ t.status }}
          </Badge>
        </div>
      </div>
    </section>

    <!-- Session Stats -->
    <section class="panel-section">
      <h3 class="panel-title">Session Stats</h3>
      <div class="kv-grid">
        <div class="kv-item">
          <span class="kv-label">Total Turns</span>
          <span class="kv-value">{{ totalSteps }}</span>
        </div>
        <div class="kv-item">
          <span class="kv-label">Total Tool Calls</span>
          <span class="kv-value">{{ steps.reduce((s, st) => s + (st.richToolCalls?.length ?? 0), 0) }}</span>
        </div>
        <div v-if="detail?.repository" class="kv-item">
          <span class="kv-label">Repository</span>
          <span class="kv-value" :title="detail.repository">{{ detail.repository.split('/').pop() }}</span>
        </div>
        <div v-if="detail?.branch" class="kv-item">
          <span class="kv-label">Branch</span>
          <span class="kv-value">{{ detail.branch }}</span>
        </div>
      </div>
    </section>

    <!-- Mini Timeline -->
    <section class="panel-section">
      <h3 class="panel-title">Timeline</h3>
      <div class="mini-tl-wrapper">
        <div class="mini-tl-dots">
          <button
            v-for="(s, idx) in steps"
            :key="idx"
            class="mini-dot-btn"
            :class="{
              completed: idx < currentStepIndex,
              current: idx === currentStepIndex,
              future: idx > currentStepIndex,
            }"
            :title="`Turn ${idx + 1}: ${s.title.slice(0, 50)}`"
            :aria-label="`Jump to turn ${idx + 1}`"
            :aria-current="idx === currentStepIndex ? 'step' : undefined"
            @click="emit('go-to-step', idx)"
          />
        </div>
      </div>
    </section>
  </div>

  <!-- Empty state -->
  <div v-else class="replay-sidebar replay-sidebar-empty">
    <p class="empty-text">No step selected</p>
  </div>
</template>

<style scoped>
.replay-sidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  padding-right: 4px;
  min-width: 280px;
  width: 100%;
}
.replay-sidebar-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.empty-text { color: var(--text-tertiary); font-size: 0.85rem; }

.panel-section {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 12px 14px;
}
.panel-title {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin: 0 0 8px;
}

.step-card { margin: 0; }
.step-card-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.step-card-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }

.kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
.kv-item { display: flex; flex-direction: column; }
.kv-label { font-size: 0.65rem; color: var(--text-tertiary); }
.kv-value { font-size: 0.75rem; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }

.metric-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.metric-card {
  display: flex; flex-direction: column; align-items: center;
  padding: 8px 6px;
  background: var(--canvas-inset);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-muted);
}
.metric-value { font-size: 1rem; font-weight: 700; color: var(--text-primary); }
.metric-label { font-size: 0.625rem; color: var(--text-tertiary); margin-top: 1px; }

/* Tool call list */
.tool-call-list { display: flex; flex-direction: column; gap: 3px; }
.tool-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px;
  background: var(--canvas-inset);
  border-radius: 4px;
  font-size: 0.7rem;
}
.tool-row.tool-failed { background: var(--danger-muted); }
.tool-icon-sm { font-size: 0.7rem; }
.tool-name-sm { font-weight: 600; font-family: 'JetBrains Mono', monospace; color: var(--text-secondary); }
.tool-dur { margin-left: auto; color: var(--text-tertiary); font-family: 'JetBrains Mono', monospace; font-size: 0.625rem; }
.tool-status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.tool-status-dot.ok { background: var(--success-fg); }
.tool-status-dot.fail { background: var(--danger-fg); }
.tool-status-dot.pending { background: var(--neutral-emphasis); }

/* File list */
.file-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.file-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.7rem; color: var(--text-secondary);
}
.file-path { font-family: 'JetBrains Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-icon { font-size: 0.7rem; }

/* Todos */
.todo-list { display: flex; flex-direction: column; gap: 4px; }
.todo-row { display: flex; align-items: center; gap: 6px; font-size: 0.7rem; }
.todo-status-icon { font-size: 0.8rem; }
.todo-done { color: var(--success-fg); }
.todo-in_progress { color: var(--warning-fg); }
.todo-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }

/* Mini timeline */
.mini-tl-wrapper { overflow-x: auto; padding-bottom: 4px; }
.mini-tl-dots { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
.mini-dot-btn {
  width: 10px; height: 10px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: all 150ms;
}
.mini-dot-btn.completed { background: var(--accent-emphasis); }
.mini-dot-btn.current {
  background: var(--accent-fg);
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.3);
  width: 12px; height: 12px;
  animation: pulse 2s infinite;
}
.mini-dot-btn.future { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); }
.mini-dot-btn:hover { transform: scale(1.3); }
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.3); }
  50% { box-shadow: 0 0 0 6px rgba(129, 140, 248, 0.1); }
}
</style>
