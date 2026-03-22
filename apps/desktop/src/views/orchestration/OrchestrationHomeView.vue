<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { formatBytes, formatRelativeTime } from '@tracepilot/ui';
import { ErrorState, LoadingOverlay } from '@tracepilot/ui';
import { useOrchestrationHomeStore } from '@/stores/orchestrationHome';

const store = useOrchestrationHomeStore();
const router = useRouter();

// ── Live Clock ──────────────────────────────────────────────
const now = ref(new Date());
let clockTimer: ReturnType<typeof setInterval> | null = null;

const liveTime = computed(() => {
  const d = now.value;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
});

// ── Helpers ─────────────────────────────────────────────────

// ── Computed values ─────────────────────────────────────────
const idleSessions = computed(() => Math.max(0, store.totalSessions - store.activeSessions));

const budgetPercent = 62; // Hardcoded for now

const budgetBarClass = computed(() => {
  if (budgetPercent >= 90) return 'danger';
  if (budgetPercent >= 70) return 'warning';
  return 'ok';
});

const feedIconClass = (type: string) => {
  const map: Record<string, string> = {
    session_launched: 'feed-icon--accent',
    session_error: 'feed-icon--danger',
    batch_completed: 'feed-icon--success',
    budget_alert: 'feed-icon--warning',
    config_changed: 'feed-icon--accent',
  };
  return map[type] ?? 'feed-icon--accent';
};

const feedIconLabel = (type: string) => {
  const map: Record<string, string> = {
    session_launched: '🚀',
    session_error: '❌',
    batch_completed: '✅',
    budget_alert: '💰',
    config_changed: '🔧',
  };
  return map[type] ?? '📋';
};

const mockFeed = [
  { id: 'mock-1', type: 'session_launched', message: 'Session started in tracepilot', timestamp: new Date(Date.now() - 300_000).toISOString() },
  { id: 'mock-2', type: 'batch_completed', message: 'Batch run completed (3 sessions)', timestamp: new Date(Date.now() - 900_000).toISOString() },
  { id: 'mock-3', type: 'budget_alert', message: 'Budget threshold reached 60%', timestamp: new Date(Date.now() - 3_600_000).toISOString() },
  { id: 'mock-4', type: 'config_changed', message: 'Agent config updated', timestamp: new Date(Date.now() - 7_200_000).toISOString() },
];

const feedItems = computed(() =>
  store.activityFeed.length > 0 ? store.activityFeed : mockFeed,
);

// ── Quick Actions ───────────────────────────────────────────
const quickActions = [
  { emoji: '🚀', title: 'Launch Session', desc: 'Start a new Copilot CLI session', to: '/orchestration/launcher', disabled: false },
  { emoji: '📊', title: 'Open Mission Control', desc: 'Real-time session dashboard', to: '', disabled: true },
  { emoji: '🔧', title: 'Configure Agents', desc: 'Edit agent definitions & configs', to: '/orchestration/config', disabled: false },
  { emoji: '🌳', title: 'Manage Worktrees', desc: 'Create, list, and prune worktrees', to: '/orchestration/worktrees', disabled: false },
];

function navigateAction(action: (typeof quickActions)[0]) {
  if (!action.disabled && action.to) {
    router.push(action.to);
  }
}

// ── Lifecycle ───────────────────────────────────────────────
onMounted(() => {
  store.initialize();
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 1000);
});

onUnmounted(() => {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <LoadingOverlay :loading="store.loading" message="Loading dashboard…">
        <ErrorState v-if="store.error" heading="Failed to load worktrees" :message="store.error" @retry="store.initialize()" />

        <!-- Main Content -->
        <template v-else>
        <!-- §1 Page Title Area -->
        <div class="page-title-bar fade-section" style="--stagger: 0">
          <h1 class="page-title">
            <svg class="title-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.906.664a1.749 1.749 0 0 1 2.187 0l5.25 4.2c.415.332.657.835.657 1.367v7.019A1.75 1.75 0 0 1 13.25 15h-3.5a.75.75 0 0 1-.75-.75V9H7v5.25a.75.75 0 0 1-.75.75h-3.5A1.75 1.75 0 0 1 1 13.25V6.23c0-.531.242-1.034.657-1.366l5.25-4.2Z" />
            </svg>
            Command Centre
          </h1>
          <div class="live-indicator">
            <span class="live-dot" />
            <span class="live-text">Live — {{ liveTime }}</span>
          </div>
        </div>

        <!-- §2 Hero Stats -->
        <div class="hero-grid fade-section" style="--stagger: 1">
          <!-- Active Sessions -->
          <div class="hero-card accent">
            <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L12 14M12 2L8 6M12 2L16 6" /><path d="M5 18c0-3.87 3.13-7 7-7s7 3.13 7 7" /><circle cx="12" cy="22" r="1" fill="currentColor" />
            </svg>
            <div class="hero-value">{{ store.activeSessions }}</div>
            <div class="hero-label">Active Sessions</div>
            <div class="hero-sub">{{ store.activeSessions }} working, {{ idleSessions }} idle</div>
          </div>

          <!-- Worktrees -->
          <div class="hero-card success">
            <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <div class="hero-value">{{ store.registeredRepos.length || '—' }}</div>
            <div class="hero-label">Repositories</div>
            <div class="hero-sub" v-if="store.worktreeCount > 0">{{ store.worktreeCount }} worktrees · {{ store.staleWorktreeCount }} stale · {{ formatBytes(store.totalDiskUsage) }}</div>
            <div class="hero-sub" v-else-if="store.registeredRepos.length > 0">No worktrees yet</div>
            <div class="hero-sub" v-else>No repos registered yet</div>
          </div>

          <!-- Budget Used -->
          <div class="hero-card warning">
            <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <div class="hero-value">{{ budgetPercent }}%</div>
            <div class="hero-label">Budget Used</div>
            <div class="budget-bar">
              <div
                class="budget-bar-fill"
                :class="budgetBarClass"
                :style="{ width: budgetPercent + '%' }"
              />
            </div>
          </div>

          <!-- Total Sessions -->
          <div class="hero-card done">
            <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
            <div class="hero-value">{{ store.totalSessions }}</div>
            <div class="hero-label">Total Sessions</div>
            <div class="hero-sub">All-time indexed sessions</div>
          </div>
        </div>

        <!-- §3 Two-Column Layout -->
        <div class="two-col fade-section" style="--stagger: 2">
          <!-- Quick Actions -->
          <div class="panel">
            <div class="section-header">
              <svg class="section-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L12 14M12 2L8 6M12 2L16 6" /><path d="M5 18c0-3.87 3.13-7 7-7s7 3.13 7 7" />
              </svg>
              <span>Quick Actions</span>
            </div>
            <div class="actions-grid">
              <div
                v-for="action in quickActions"
                :key="action.title"
                class="action-card"
                :class="{ disabled: action.disabled }"
                tabindex="0"
                role="button"
                @click="navigateAction(action)"
                @keydown.enter="navigateAction(action)"
              >
                <div class="action-emoji-wrap">
                  <span class="action-emoji">{{ action.emoji }}</span>
                </div>
                <div class="action-title">{{ action.title }}</div>
                <div class="action-desc">{{ action.desc }}</div>
              </div>
            </div>
          </div>

          <!-- Activity Feed -->
          <div class="panel">
            <div class="section-header">
              <svg class="section-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <span>Activity Feed</span>
              <span class="feed-badge">{{ feedItems.length }}</span>
            </div>
            <div class="feed-list">
              <div
                v-for="event in feedItems"
                :key="event.id"
                class="feed-item"
              >
                <span class="feed-icon" :class="feedIconClass(event.type)">{{ feedIconLabel(event.type) }}</span>
                <span class="feed-msg">{{ event.message }}</span>
                <span class="feed-time">{{ formatRelativeTime(event.timestamp) }}</span>
              </div>
              <div v-if="feedItems.length === 0" class="feed-empty">No recent activity</div>
            </div>
          </div>
        </div>

        <!-- §4 System Health Bar -->
        <div class="health-bar fade-section" style="--stagger: 3">
          <div class="health-item">
            <span class="health-label">Copilot CLI</span>
            <span class="health-val" :class="store.systemDeps?.copilotAvailable ? 'ok' : 'err'">
              {{ store.systemDeps?.copilotAvailable ? '✅' : '❌' }}
              v{{ store.copilotVersionStr }}
            </span>
          </div>
          <span class="health-divider" />
          <div class="health-item">
            <span class="health-label">Git</span>
            <span class="health-val" :class="store.systemDeps?.gitAvailable ? 'ok' : 'err'">
              {{ store.systemDeps?.gitAvailable ? '✅' : '❌' }}
              v{{ store.systemDeps?.gitVersion ?? 'N/A' }}
            </span>
          </div>
          <span class="health-divider" />
          <div class="health-item">
            <span class="health-label">Sessions</span>
            <span class="health-val" :class="store.activeSessions > 0 ? 'ok' : 'warn'">
              {{ store.activeSessions }} active
            </span>
          </div>
        </div>

      </template>
      </LoadingOverlay>
    </div>
  </div>
</template>

<style scoped>
/* ── Animations ──────────────────────────────────────────────── */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.fade-section {
  animation: fadeInUp 0.4s ease-out both;
  animation-delay: calc(var(--stagger, 0) * 0.08s);
}

/* ── §1 Page Title Area ──────────────────────────────────────── */
.page-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.page-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.title-icon {
  flex-shrink: 0;
  color: var(--accent-fg);
}

.live-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-fg);
  animation: pulse 2s ease-in-out infinite;
}

.live-text {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ── §2 Hero Stats Grid ─────────────────────────────────────── */
.hero-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 28px;
}

.hero-card {
  position: relative;
  padding: 24px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  overflow: hidden;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.hero-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.hero-card.accent {
  background: linear-gradient(135deg, var(--accent-muted), var(--canvas-subtle));
  border-color: var(--accent-fg);
}

.hero-card.success {
  background: linear-gradient(135deg, var(--success-muted), var(--canvas-subtle));
  border-color: var(--success-fg);
}

.hero-card.warning {
  background: linear-gradient(135deg, var(--warning-muted), var(--canvas-subtle));
  border-color: var(--warning-fg);
}

.hero-card.done {
  background: linear-gradient(135deg, var(--done-muted), var(--canvas-subtle));
  border-color: var(--done-fg);
}

.hero-icon {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  opacity: 0.3;
}

.hero-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.hero-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-top: 4px;
}

.hero-sub {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* Budget bar inside the hero card */
.budget-bar {
  height: 6px;
  background: var(--canvas-inset);
  border-radius: 3px;
  margin-top: 10px;
  overflow: hidden;
}

.budget-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--transition-normal);
}

.budget-bar-fill.ok {
  background: var(--success-fg);
}

.budget-bar-fill.warning {
  background: var(--warning-fg);
}

.budget-bar-fill.danger {
  background: var(--danger-fg);
}

/* ── §3 Two-Column Layout ────────────────────────────────────── */
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 28px;
}

.panel {
  min-width: 0;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-muted);
}

.section-icon {
  flex-shrink: 0;
  color: var(--accent-fg);
}

.feed-badge {
  margin-left: auto;
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}

/* Quick Actions 2×2 grid */
.actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.action-card {
  padding: 20px;
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast),
    transform var(--transition-fast), box-shadow var(--transition-fast);
}

.action-card:hover:not(.disabled) {
  border-color: var(--accent-fg);
  background: var(--accent-muted);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.action-card:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

.action-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-emoji-wrap {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--canvas-default);
  border-radius: var(--radius-md);
  font-size: 1.4rem;
  margin-bottom: 10px;
}

.action-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.action-desc {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  line-height: 1.4;
}

/* Activity Feed */
.feed-list {
  max-height: 360px;
  overflow-y: auto;
}

.feed-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-muted);
  font-size: 0.8125rem;
  transition: background var(--transition-fast);
  border-radius: var(--radius-sm);
  padding-left: 4px;
  padding-right: 4px;
}

.feed-item:hover {
  background: var(--canvas-subtle);
}

.feed-item:last-child {
  border-bottom: none;
}

.feed-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.75rem;
}

.feed-icon--accent {
  background: var(--accent-muted);
  color: var(--accent-fg);
}

.feed-icon--danger {
  background: var(--danger-muted);
  color: var(--danger-fg);
}

.feed-icon--success {
  background: var(--success-muted);
  color: var(--success-fg);
}

.feed-icon--warning {
  background: var(--warning-muted);
  color: var(--warning-fg);
}

.feed-msg {
  flex: 1;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed-time {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.feed-empty {
  text-align: center;
  padding: 32px 0;
  color: var(--text-placeholder);
  font-size: 0.8125rem;
}

/* ── §4 System Health Bar ────────────────────────────────────── */
.health-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 14px 20px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
  font-size: 0.8125rem;
  margin-bottom: 12px;
}

.health-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.health-label {
  color: var(--text-secondary);
  font-weight: 500;
}

.health-val {
  font-weight: 600;
}

.health-val.ok {
  color: var(--success-fg);
}

.health-val.warn {
  color: var(--warning-fg);
}

.health-val.err {
  color: var(--danger-fg);
}

.health-divider {
  width: 1px;
  height: 18px;
  background: var(--border-muted);
  flex-shrink: 0;
}

/* ── §5 Keyboard Shortcuts Bar ───────────────────────────────── */
</style>
