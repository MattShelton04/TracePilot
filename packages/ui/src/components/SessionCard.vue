<script setup lang="ts">
import type { SessionListItem } from "@tracepilot/types";
import {
  formatRelativeTime,
  isNonCopilotSource,
  modelDisplayName,
  resolveSessionSource,
  runStatusBadge,
  sourceLabel,
} from "@tracepilot/types";
import { Archive, Folder, NotebookPen, Star, Tag } from "lucide-vue-next";
import { computed } from "vue";
import { projectLabelFromCwd } from "../utils/pathUtils";
import Badge from "./Badge.vue";

const props = defineProps<{
  session: SessionListItem;
  /**
   * Live attach state (ADR-0016): `attachable` when the session runs in a
   * `--ui-server` terminal TracePilot can stream, `watching` when attached.
   */
  live?: "attachable" | "watching" | null;
  /** Show the star toggle, which emits `toggle-star`. */
  starrable?: boolean;
  /** User annotations, shown on the card. */
  starred?: boolean;
  archived?: boolean;
  tags?: readonly string[];
  hasNote?: boolean;
}>();

const emit = defineEmits<{
  select: [event: MouseEvent, sessionId: string];
  "toggle-star": [sessionId: string];
}>();

// A session without a repository is still identified by its working directory.
const projectLabel = computed(() =>
  props.session.repository ? null : projectLabelFromCwd(props.session.cwd),
);

function isClaude(session: SessionListItem): boolean {
  return resolveSessionSource(session.source) === "claudeCode";
}

function isActive(session: SessionListItem): boolean {
  return session.isRunning === true;
}

/** A running session whose process waits for input (not when TracePilot streams it). */
const isWaiting = computed(
  () => isActive(props.session) && !props.live && props.session.runStatus === "waiting",
);

function activeLabel(): string {
  if (props.live === "watching") return "Watching";
  if (props.live === "attachable") return "Live";
  return runStatusBadge(props.session.runStatus, props.session.source)?.label ?? "Active";
}

function activeTitle(): string {
  if (props.live === "watching") return "TracePilot is streaming this session live";
  if (props.live === "attachable") return "Running in a terminal TracePilot can stream live";
  return (
    runStatusBadge(props.session.runStatus, props.session.source)?.title ??
    "Session is currently active"
  );
}
</script>

<template>
  <div
    class="card card-interactive session-card-new"
    :class="{
      'card--active': isActive(session),
      'card--waiting': isWaiting,
      'session-card--claude': isClaude(session),
    }"
    role="link"
    tabindex="0"
    @click="emit('select', $event, session.id)"
    @keydown.enter="emit('select', $event as unknown as MouseEvent, session.id)"
    @keydown.space.prevent="emit('select', $event as unknown as MouseEvent, session.id)"
  >
    <Transition name="active-pop">
      <span v-if="isActive(session)" class="active-pop-wrapper active-badge-topright">
        <Badge :variant="isWaiting ? 'warning' : 'success'" class="active-badge" :title="activeTitle()">{{ activeLabel() }}</Badge>
      </span>
    </Transition>
    
    <div class="card-header-new">
      <Transition name="active-pop">
        <span v-if="isActive(session)" class="active-pop-wrapper">
          <span class="active-dot" :class="{ 'active-dot--waiting': isWaiting }" :title="activeTitle()" />
        </span>
      </Transition>
      <h3 class="card-title-new">{{ session.summary || 'Untitled Session' }}</h3>
    </div>

    <div class="card-badges-new">
      <Badge v-if="isNonCopilotSource(session.source)" :variant="isClaude(session) ? 'claude' : 'neutral'" title="Session source">{{ sourceLabel(session.source) }}</Badge>
      <Badge v-if="session.repository" variant="accent">{{ session.repository }}</Badge>
      <Badge
        v-else-if="projectLabel"
        variant="neutral"
        :title="session.cwd ?? undefined"
        data-testid="session-project-chip"
      ><Folder :size="12" aria-hidden="true" class="project-chip__icon" />{{ projectLabel }}</Badge>
      <Badge v-if="session.branch" variant="success">{{ session.branch }}</Badge>
      <Badge v-if="session.currentModel" variant="done" :title="session.currentModel">{{ modelDisplayName(session.currentModel, session.source) }}</Badge>
      <Badge v-if="session.hostType || !isNonCopilotSource(session.source)" variant="neutral">{{ session.hostType || 'cli' }}</Badge>
      <Badge v-if="archived" variant="neutral" data-testid="session-archived-chip"><Archive :size="12" aria-hidden="true" class="project-chip__icon" />Archived</Badge>
      <Badge
        v-for="tag in tags ?? []"
        :key="tag"
        variant="neutral"
        class="session-tag"
        data-testid="session-tag"
      ><Tag :size="12" aria-hidden="true" class="project-chip__icon" />{{ tag }}</Badge>
    </div>

    <div class="card-footer-new">
      <div class="card-stats-new">
        <span class="stat-item-inline" title="Total Events">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          {{ session.eventCount ?? 0 }}
        </span>
        <span class="stat-item-inline" title="Conversation Turns">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          {{ session.turnCount ?? 0 }}
        </span>
        <span v-if="session.errorCount" class="stat-item-inline error" :title="`${session.errorCount} error${session.errorCount !== 1 ? 's' : ''} encountered`">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {{ session.errorCount }}
        </span>
        <span v-if="hasNote" class="stat-item-inline" title="Has a note" data-testid="session-note-indicator">
          <NotebookPen :size="14" aria-hidden="true" />
          <span class="sr-only">Has a note</span>
        </span>
        <span v-if="session.compactionCount" class="stat-item-inline warning" :title="`${session.compactionCount} context compaction${session.compactionCount !== 1 ? 's' : ''} performed`">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          {{ session.compactionCount }}
        </span>
      </div>
      <div class="card-footer-end">
        <button
          v-if="starrable"
          type="button"
          class="star-toggle"
          :class="{ 'star-toggle--on': starred }"
          :aria-pressed="starred"
          :aria-label="starred ? 'Unstar session' : 'Star session'"
          :title="starred ? 'Unstar' : 'Star'"
          data-testid="session-star-toggle"
          @click.stop="emit('toggle-star', session.id)"
          @keydown.enter.stop
          @keydown.space.stop
        >
          <Star :size="16" aria-hidden="true" :fill="starred ? 'currentColor' : 'none'" />
        </button>
        <span class="card-time-new" :title="session.updatedAt ?? undefined">{{ formatRelativeTime(session.updatedAt) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-card-new {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  position: relative;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
}

.card-header-new {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
  padding-right: 48px; /* space for active badge */
}

.card-title-new {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.card-badges-new {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 24px;
}

.project-chip__icon {
  flex-shrink: 0;
}

.card-footer-new {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.card-stats-new {
  display: flex;
  align-items: center;
  gap: 14px;
}

.stat-item-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.stat-item-inline svg {
  color: var(--text-tertiary);
}

.stat-item-inline.error {
  color: var(--danger-fg);
}
.stat-item-inline.error svg {
  color: var(--danger-fg);
}

.stat-item-inline.warning {
  color: var(--warning-fg);
}
.stat-item-inline.warning svg {
  color: var(--warning-fg);
}

.card-footer-end {
  display: flex;
  align-items: center;
  gap: 8px;
}

.star-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}
.star-toggle:hover {
  color: var(--text-primary);
  background: var(--state-hover-overlay);
}
.star-toggle--on,
.star-toggle--on:hover {
  color: var(--accent-fg);
}

.session-tag {
  max-width: 100%;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.card-time-new {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
}

/* --- Claude Code source: a faint clay wash so these sessions stand apart --- */
.session-card--claude {
  border-color: var(--claude-border);
  background-image:
    linear-gradient(135deg, var(--claude-subtle) 0%, transparent 55%),
    var(--gradient-card);
}
.session-card--claude:hover {
  border-color: var(--claude-emphasis);
  box-shadow:
    var(--shadow-md),
    0 0 0 1px var(--claude-muted);
}

/* --- Active State Animations --- */
/* Busy (and sources without a run status) pulse green; Waiting pulses amber. */
.card--active {
  --run-muted: var(--success-muted);
  --run-fg: var(--success-fg);
  border-color: var(--run-muted);
  box-shadow: 0 0 0 1px var(--run-muted);
  animation: card-active-pulse 2s ease-in-out infinite;
}
.card--waiting {
  --run-muted: var(--warning-muted);
  --run-fg: var(--warning-fg);
}
@keyframes card-active-pulse {
  0%, 100% {
    border-color: var(--run-muted);
    box-shadow: 0 0 0 1px var(--run-muted);
  }
  50% {
    border-color: var(--run-fg);
    box-shadow: 0 0 0 2px var(--run-muted);
  }
}
/* A running Claude Code card keeps its clay border; only the outer ring pulses. */
.session-card--claude.card--active {
  border-color: var(--claude-border);
  animation-name: card-active-ring-pulse;
}
@keyframes card-active-ring-pulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--run-muted); }
  50% { box-shadow: 0 0 0 2px var(--run-fg); }
}
.active-badge-topright {
  position: absolute;
  top: 16px;
  right: 16px;
}

.active-pop-wrapper {
  display: inline-flex;
  align-items: center;
  margin-top: 4px; /* align dot with first line of title */
}

.active-pop-enter-active,
.active-pop-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.active-pop-enter-from { opacity: 0; transform: scale(0); }
.active-pop-leave-to { opacity: 0; transform: scale(0); }

.active-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-fg);
  flex-shrink: 0;
  overflow: visible;
  position: relative;
  animation: dot-sync-pulse 2s ease-in-out infinite;
}
.active-dot--waiting {
  background: var(--warning-fg);
}

@keyframes dot-sync-pulse {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.15); opacity: 1; }
}

.active-badge {
  flex-shrink: 0;
  font-size: 0.625rem;
}
</style>
