<script setup lang="ts">
// STUB: useReplayComposable — manages replay playback state.
// STUB: Currently uses mock turn data for replay simulation.
// STUB: In production, wire to real session turns with accurate timing data.

import { ref, computed, watch, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { MiniTimeline } from '@tracepilot/ui';
import StubBanner from '@/components/StubBanner.vue';
import type { ReplayStep } from '@tracepilot/types';

const route = useRoute();
const sessionId = computed(() => (route.params.id as string) || 'mock-session');

// ── Mock replay data ─────────────────────────────────────────
const MOCK_STEPS: ReplayStep[] = [
  {
    index: 0,
    title: 'User request: Implement auth module',
    type: 'user',
    timestamp: '2025-01-15T10:30:00Z',
    durationMs: 0,
    tokens: 24,
  },
  {
    index: 1,
    title: 'Planning authentication architecture',
    type: 'assistant',
    timestamp: '2025-01-15T10:30:02Z',
    durationMs: 4200,
    tokens: 680,
    toolCalls: [
      { name: 'view', success: true, durationMs: 85, command: 'view src/', output: 'Listed 12 files' },
    ],
  },
  {
    index: 2,
    title: 'Creating auth service file',
    type: 'tool',
    timestamp: '2025-01-15T10:30:06Z',
    durationMs: 320,
    tokens: 0,
    toolCalls: [
      { name: 'create', success: true, durationMs: 320, command: 'create src/auth/service.ts' },
    ],
    filesModified: ['src/auth/service.ts'],
  },
  {
    index: 3,
    title: 'Implementing JWT token generation',
    type: 'assistant',
    timestamp: '2025-01-15T10:30:08Z',
    durationMs: 6100,
    tokens: 1240,
    toolCalls: [
      { name: 'edit', success: true, durationMs: 150, command: 'edit src/auth/service.ts' },
      { name: 'edit', success: true, durationMs: 110, command: 'edit src/auth/types.ts' },
    ],
    filesModified: ['src/auth/service.ts', 'src/auth/types.ts'],
  },
  {
    index: 4,
    title: 'User request: Add password hashing',
    type: 'user',
    timestamp: '2025-01-15T10:30:15Z',
    durationMs: 0,
    tokens: 18,
  },
  {
    index: 5,
    title: 'Adding bcrypt password hashing',
    type: 'assistant',
    timestamp: '2025-01-15T10:30:17Z',
    durationMs: 3800,
    tokens: 920,
    toolCalls: [
      { name: 'edit', success: true, durationMs: 200, command: 'edit src/auth/service.ts' },
    ],
    filesModified: ['src/auth/service.ts'],
    todosChanged: [
      { id: 'hash-passwords', title: 'Add password hashing', status: 'done' },
    ],
  },
  {
    index: 6,
    title: 'Installing bcrypt dependency',
    type: 'tool',
    timestamp: '2025-01-15T10:30:21Z',
    durationMs: 8400,
    tokens: 0,
    toolCalls: [
      { name: 'powershell', success: true, durationMs: 8400, command: 'npm install bcrypt', output: 'added 1 package' },
    ],
    filesModified: ['package.json', 'package-lock.json'],
  },
  {
    index: 7,
    title: 'Running unit tests',
    type: 'tool',
    timestamp: '2025-01-15T10:30:30Z',
    durationMs: 5200,
    tokens: 0,
    toolCalls: [
      { name: 'powershell', success: true, durationMs: 5200, command: 'npm test', output: '12 tests passed' },
    ],
  },
  {
    index: 8,
    title: 'Reviewing test results and summarizing',
    type: 'assistant',
    timestamp: '2025-01-15T10:30:36Z',
    durationMs: 2800,
    tokens: 560,
    todosChanged: [
      { id: 'write-tests', title: 'Write unit tests', status: 'done' },
    ],
  },
  {
    index: 9,
    title: 'User request: Add refresh token endpoint',
    type: 'user',
    timestamp: '2025-01-15T10:30:40Z',
    durationMs: 0,
    tokens: 22,
  },
  {
    index: 10,
    title: 'Implementing refresh token logic',
    type: 'assistant',
    timestamp: '2025-01-15T10:30:42Z',
    durationMs: 5600,
    tokens: 1100,
    toolCalls: [
      { name: 'edit', success: true, durationMs: 180, command: 'edit src/auth/routes.ts' },
      { name: 'create', success: true, durationMs: 90, command: 'create src/auth/refresh.ts' },
    ],
    filesModified: ['src/auth/routes.ts', 'src/auth/refresh.ts'],
    todosChanged: [
      { id: 'refresh-token', title: 'Add refresh token endpoint', status: 'done' },
    ],
  },
  {
    index: 11,
    title: 'Final verification and summary',
    type: 'assistant',
    timestamp: '2025-01-15T10:30:48Z',
    durationMs: 3200,
    tokens: 780,
    toolCalls: [
      { name: 'powershell', success: false, durationMs: 6100, command: 'npm run build', output: 'Build completed with 1 warning' },
    ],
  },
];

// ── useReplayComposable (inline) ─────────────────────────────
const currentStep = ref(0);
const isPlaying = ref(false);
const speed = ref(1);
let playTimer: ReturnType<typeof setInterval> | null = null;

const steps = computed(() => MOCK_STEPS);
const totalSteps = computed(() => steps.value.length);
const currentStepData = computed(() => steps.value[currentStep.value]);

const totalDurationMs = computed(() =>
  steps.value.reduce((sum, s) => sum + s.durationMs, 0),
);
const elapsedMs = computed(() =>
  steps.value.slice(0, currentStep.value + 1).reduce((sum, s) => sum + s.durationMs, 0),
);

function fmtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function clearTimer() {
  if (playTimer !== null) {
    clearInterval(playTimer);
    playTimer = null;
  }
}

function play() {
  if (currentStep.value >= totalSteps.value - 1) {
    currentStep.value = 0;
  }
  isPlaying.value = true;
  clearTimer();
  playTimer = setInterval(() => {
    if (currentStep.value < totalSteps.value - 1) {
      currentStep.value++;
    } else {
      pause();
    }
  }, 1500 / speed.value);
}

function pause() {
  isPlaying.value = false;
  clearTimer();
}

function nextStep() {
  if (currentStep.value < totalSteps.value - 1) {
    currentStep.value++;
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
}

function goToStep(n: number) {
  currentStep.value = Math.max(0, Math.min(n, totalSteps.value - 1));
}

function setSpeed(s: number) {
  speed.value = s;
  if (isPlaying.value) {
    clearTimer();
    playTimer = setInterval(() => {
      if (currentStep.value < totalSteps.value - 1) {
        currentStep.value++;
      } else {
        pause();
      }
    }, 1500 / speed.value);
  }
}

const scrubberPercent = computed(() =>
  totalSteps.value > 1 ? (currentStep.value / (totalSteps.value - 1)) * 100 : 0,
);

function onScrubberClick(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  goToStep(Math.round(pct * (totalSteps.value - 1)));
}

function onScrubberKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); nextStep(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); prevStep(); }
  if (e.key === 'Home') { e.preventDefault(); goToStep(0); }
  if (e.key === 'End') { e.preventDefault(); goToStep(totalSteps.value - 1); }
}

// Role display helpers
function roleIcon(type: string): string {
  switch (type) {
    case 'user': return '👤';
    case 'assistant': return '🤖';
    case 'tool': return '🔧';
    default: return '•';
  }
}

function roleLabel(type: string): string {
  switch (type) {
    case 'user': return 'User';
    case 'assistant': return 'Assistant';
    case 'tool': return 'Tool';
    default: return type;
  }
}

// Model stub — in production this comes from the session
const currentModel = computed(() => {
  const step = currentStepData.value;
  if (step.type === 'assistant') return 'claude-sonnet-4';
  if (step.type === 'tool') return '—';
  return '—';
});

onUnmounted(() => {
  clearTimer();
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <StubBanner />
      <!-- Header -->
      <header class="replay-header">
        <h1>Session Replay</h1>
        <span class="text-secondary">{{ sessionId }}</span>
      </header>

      <!-- Transport Controls -->
      <div class="transport-bar">
        <div class="transport-buttons">
          <button class="transport-btn" :disabled="currentStep === 0" @click="prevStep" aria-label="Previous step">
            ⏮
          </button>
          <button class="transport-btn transport-play" @click="isPlaying ? pause() : play()" :aria-label="isPlaying ? 'Pause' : 'Play'">
            {{ isPlaying ? '⏸' : '▶' }}
          </button>
          <button class="transport-btn" :disabled="currentStep >= totalSteps - 1" @click="nextStep" aria-label="Next step">
            ⏭
          </button>
        </div>

        <div class="transport-speed">
          <button
            v-for="s in [0.5, 1, 2, 4]"
            :key="s"
            class="speed-btn"
            :class="{ active: speed === s }"
            @click="setSpeed(s)"
          >
            {{ s }}×
          </button>
        </div>

        <span class="step-counter">
          Step {{ currentStep + 1 }} of {{ totalSteps }}
        </span>
      </div>

      <!-- Scrubber -->
      <div class="scrubber" @click="onScrubberClick" role="slider" tabindex="0" @keydown="onScrubberKeydown" :aria-valuenow="currentStep" :aria-valuemin="0" :aria-valuemax="totalSteps - 1" aria-label="Replay scrubber">
        <div class="scrubber-track">
          <div class="scrubber-fill" :style="{ width: scrubberPercent + '%' }" />
          <div class="scrubber-thumb" :style="{ left: scrubberPercent + '%' }" />
        </div>
        <div class="scrubber-times">
          <span>{{ fmtTime(elapsedMs) }}</span>
          <span>{{ fmtTime(totalDurationMs) }}</span>
        </div>
      </div>

      <!-- Main Split Layout -->
      <div class="replay-layout">
        <!-- Left: Conversation Area -->
        <div class="replay-conversation">
          <div
            v-for="step in steps"
            :key="step.index"
            class="replay-turn"
            :class="{
              'turn-revealed': step.index < currentStep,
              'turn-current': step.index === currentStep,
              'turn-future': step.index > currentStep,
            }"
          >
            <div class="turn-header">
              <span class="role-badge" :class="'role-' + step.type">
                {{ roleIcon(step.type) }} {{ roleLabel(step.type) }}
              </span>
              <span class="turn-timestamp">{{ step.timestamp.split('T')[1]?.replace('Z', '') }}</span>
            </div>
            <div class="turn-content">
              {{ step.title }}
            </div>
            <div v-if="step.toolCalls?.length" class="turn-tools">
              <div v-for="(tc, i) in step.toolCalls" :key="i" class="tool-call-item">
                <span class="tool-name">{{ tc.name }}</span>
                <span v-if="tc.command" class="tool-cmd">{{ tc.command }}</span>
                <span class="tool-status" :class="tc.success ? 'success' : 'fail'">
                  {{ tc.success ? '✓' : '✗' }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Side Panel -->
        <div class="replay-sidebar">
          <!-- Current Step Details -->
          <section class="panel-section">
            <h3 class="panel-title">Current Step</h3>
            <div class="panel-kv">
              <div class="kv-row">
                <span class="kv-key">Type</span>
                <span class="kv-value">
                  <span class="role-badge role-badge-sm" :class="'role-' + currentStepData.type">
                    {{ roleLabel(currentStepData.type) }}
                  </span>
                </span>
              </div>
              <div class="kv-row">
                <span class="kv-key">Tokens</span>
                <span class="kv-value">{{ currentStepData.tokens.toLocaleString() }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">Duration</span>
                <span class="kv-value">{{ fmtDuration(currentStepData.durationMs) }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">Model</span>
                <span class="kv-value">{{ currentModel }}</span>
              </div>
            </div>
          </section>

          <!-- Step Metrics -->
          <section class="panel-section">
            <h3 class="panel-title">Step Metrics</h3>
            <div class="metric-cards">
              <div class="metric-card">
                <span class="metric-value">{{ currentStepData.tokens }}</span>
                <span class="metric-label">Tokens</span>
              </div>
              <div class="metric-card">
                <span class="metric-value">{{ fmtDuration(currentStepData.durationMs) }}</span>
                <span class="metric-label">Duration</span>
              </div>
              <div class="metric-card">
                <span class="metric-value">{{ currentStepData.toolCalls?.length ?? 0 }}</span>
                <span class="metric-label">Tool Calls</span>
              </div>
              <div class="metric-card">
                <span class="metric-value">{{ currentStepData.filesModified?.length ?? 0 }}</span>
                <span class="metric-label">Files</span>
              </div>
            </div>
          </section>

          <!-- Files Modified -->
          <section v-if="currentStepData.filesModified?.length" class="panel-section">
            <h3 class="panel-title">Files Modified</h3>
            <ul class="file-list">
              <li v-for="f in currentStepData.filesModified" :key="f" class="file-item">
                <span class="file-icon">~</span>
                {{ f }}
              </li>
            </ul>
          </section>

          <!-- Todos Changed -->
          <section v-if="currentStepData.todosChanged?.length" class="panel-section">
            <h3 class="panel-title">Todos Changed</h3>
            <ul class="file-list">
              <li v-for="t in currentStepData.todosChanged" :key="t.id" class="file-item">
                <span class="todo-status" :class="'todo-' + t.status">
                  {{ t.status === 'done' ? '✓' : t.status === 'in_progress' ? '◐' : '○' }}
                </span>
                {{ t.title }}
              </li>
            </ul>
          </section>

          <!-- Mini Timeline -->
          <section class="panel-section">
            <h3 class="panel-title">Timeline</h3>
            <MiniTimeline :total="totalSteps" :current="currentStep" />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Header ────────────────────────────────────────────────── */
.replay-header {
  margin-bottom: 16px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.replay-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.text-secondary {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

/* ── Transport Bar ─────────────────────────────────────────── */
.transport-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  margin-bottom: 12px;
}
.transport-buttons {
  display: flex;
  gap: 4px;
}
.transport-btn {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-overlay);
  color: var(--text-primary);
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.transport-btn:hover:not(:disabled) {
  background: var(--canvas-raised);
  border-color: var(--accent-fg);
}
.transport-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.transport-play {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
  color: white;
}
.transport-play:hover {
  background: var(--accent-fg) !important;
  border-color: var(--accent-fg) !important;
}
.transport-speed {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.speed-btn {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.speed-btn.active {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
  color: white;
}
.speed-btn:hover:not(.active) {
  border-color: var(--accent-fg);
  color: var(--text-primary);
}
.step-counter {
  font-size: 0.85rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* ── Scrubber ──────────────────────────────────────────────── */
.scrubber {
  margin-bottom: 16px;
  cursor: pointer;
}
.scrubber-track {
  position: relative;
  height: 6px;
  background: var(--border-default);
  border-radius: 3px;
}
.scrubber-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--accent-emphasis), var(--accent-fg));
  transition: width var(--transition-fast);
}
.scrubber-thumb {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent-fg);
  border: 2px solid var(--canvas-default);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 6px var(--accent-emphasis);
  transition: left var(--transition-fast);
}
.scrubber-times {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-top: 4px;
}

/* ── Layout ────────────────────────────────────────────────── */
.replay-layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 20px;
  min-height: 0;
}

/* ── Conversation ──────────────────────────────────────────── */
.replay-conversation {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: calc(100vh - 320px);
  overflow-y: auto;
  padding-right: 8px;
}
.replay-turn {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  transition: all var(--transition-normal);
}
.turn-revealed {
  opacity: 0.75;
}
.turn-current {
  opacity: 1;
  border-color: var(--accent-fg);
  border-left: 3px solid var(--accent-fg);
  background: var(--canvas-overlay);
  box-shadow: 0 0 12px var(--accent-subtle);
}
.turn-future {
  opacity: 0.25;
  filter: blur(1px);
}
.turn-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.role-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}
.role-badge-sm {
  font-size: 0.7rem;
  padding: 1px 6px;
}
.role-user {
  background: var(--accent-subtle);
  color: var(--accent-fg);
}
.role-assistant {
  background: var(--success-subtle);
  color: var(--success-fg);
}
.role-tool {
  background: var(--warning-subtle);
  color: var(--warning-fg);
}
.turn-timestamp {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', monospace;
}
.turn-content {
  font-size: 0.875rem;
  color: var(--text-primary);
  line-height: 1.5;
}
.turn-tools {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tool-call-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  padding: 4px 8px;
  background: var(--canvas-inset);
  border-radius: 4px;
}
.tool-name {
  font-weight: 600;
  color: var(--accent-fg);
  font-family: 'JetBrains Mono', monospace;
}
.tool-cmd {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-status.success {
  color: var(--success-fg);
}
.tool-status.fail {
  color: var(--danger-fg);
}

/* ── Side Panel ────────────────────────────────────────────── */
.replay-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: calc(100vh - 320px);
  overflow-y: auto;
}
.panel-section {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 14px 16px;
}
.panel-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin: 0 0 10px;
}

/* KV rows */
.panel-kv {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kv-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.kv-key {
  font-size: 0.8rem;
  color: var(--text-tertiary);
}
.kv-value {
  font-size: 0.8rem;
  color: var(--text-primary);
  font-weight: 500;
}

/* Metric cards */
.metric-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.metric-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 8px;
  background: var(--canvas-inset);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-muted);
}
.metric-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}
.metric-label {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* File list */
.file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.file-item {
  font-size: 0.8rem;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
}
.file-icon {
  color: var(--warning-fg);
  font-weight: 700;
}
.todo-status {
  font-size: 0.85rem;
}
.todo-done {
  color: var(--success-fg);
}
.todo-in_progress {
  color: var(--warning-fg);
}
</style>
