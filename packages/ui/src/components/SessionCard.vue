<script setup lang="ts">
import type { SessionListItem } from "@tracepilot/types";
import {
  formatRelativeTime,
  isNonCopilotSource,
  modelDisplayName,
  pullRequestSlug,
  pullRequestStateLabel,
  pullRequestTone,
  resolveSessionSource,
  runStatusBadge,
  sourceLabel,
} from "@tracepilot/types";
import { Folder, TriangleAlert } from "lucide-vue-next";
import { computed } from "vue";
import { projectLabelFromCwd } from "../utils/pathUtils";
import { pullRequestIcon } from "../utils/pullRequests";
import Badge from "./Badge.vue";
import SourceLogo from "./SourceLogo.vue";

const props = defineProps<{
  session: SessionListItem;
  /**
   * Live attach state (ADR-0016): `attachable` when the session runs in a
   * `--ui-server` terminal TracePilot can stream, `watching` when attached.
   */
  live?: "attachable" | "watching" | null;
}>();

const emit = defineEmits<{
  select: [event: MouseEvent, sessionId: string];
}>();

// A session without a repository is still identified by its working directory.
const projectLabel = computed(() =>
  props.session.repository ? null : projectLabelFromCwd(props.session.cwd),
);

// The index counts each rate limit as an error too; the card shows them
// apart, as a warning, the way the session's Overview and Analytics do.
const rateLimitCount = computed(() => props.session.rateLimitCount ?? 0);
const errorCount = computed(() =>
  Math.max(0, (props.session.errorCount ?? 0) - rateLimitCount.value),
);

// The pull request that stands for the session, coloured by its state once known.
const linkedPrs = computed(() => props.session.linkedPullRequests ?? null);
const prTitle = computed(() => {
  const linked = linkedPrs.value;
  if (!linked) return "";
  const state = pullRequestStateLabel(linked.primary.state);
  const head = `${pullRequestSlug(linked.primary)}${state ? ` · ${state}` : ""}`;
  const others = linked.count - 1;
  if (others <= 0) return head;
  return `${head}\n+${others} more linked pull request${others === 1 ? "" : "s"}`;
});

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
      <Badge :variant="isClaude(session) ? 'claude' : 'copilot'" title="Session source">{{ sourceLabel(session.source) }}</Badge>
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
        <span v-if="errorCount" class="stat-item-inline error" :title="`${errorCount} error${errorCount !== 1 ? 's' : ''} encountered`">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {{ errorCount }}
        </span>
        <span
          v-if="rateLimitCount"
          class="stat-item-inline warning"
          :title="`${rateLimitCount} rate limit${rateLimitCount !== 1 ? 's' : ''} hit`"
          data-testid="session-rate-limits"
        >
          <TriangleAlert :size="14" aria-hidden="true" />
          {{ rateLimitCount }}
        </span>
        <span v-if="session.compactionCount" class="stat-item-inline warning" :title="`${session.compactionCount} context compaction${session.compactionCount !== 1 ? 's' : ''} performed`">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          {{ session.compactionCount }}
        </span>
        <span
          v-if="linkedPrs"
          class="stat-item-inline pr-stat"
          :class="`pr-stat--${pullRequestTone(linkedPrs.primary.state)}`"
          :title="prTitle"
          role="img"
          :aria-label="`Pull request ${prTitle}`"
          data-testid="session-pull-requests"
        >
          <component :is="pullRequestIcon(linkedPrs.primary.state)" :size="14" aria-hidden="true" />
          <span class="pr-stat__number">#{{ linkedPrs.primary.number }}</span>
          <span v-if="linkedPrs.count > 1" class="pr-stat__more">+{{ linkedPrs.count - 1 }}</span>
        </span>
      </div>
      <span class="card-footer-end">
        <span class="card-time-new" :title="session.updatedAt ?? undefined">{{ formatRelativeTime(session.updatedAt) }}</span>
        <span
          class="card-source-logo"
          :class="isClaude(session) ? 'card-source-logo--claude' : 'card-source-logo--copilot'"
          :title="sourceLabel(session.source)"
          data-testid="session-source-logo"
        ><SourceLogo :source="resolveSessionSource(session.source)" :size="16" /></span>
      </span>
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

/* The primary pull request; unknown and draft states keep the quiet icon colour. */
.pr-stat {
  gap: 4px;
}
.pr-stat__number,
.pr-stat__more {
  font-variant-numeric: tabular-nums;
}
.pr-stat__more {
  color: var(--text-tertiary);
}
.pr-stat--success svg {
  color: var(--success-fg);
}
.pr-stat--done svg {
  color: var(--done-fg);
}
.pr-stat--danger svg {
  color: var(--danger-fg);
}

.card-footer-end {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

/* The source's mark, so Copilot and Claude Code cards differ beyond colour. */
.card-source-logo {
  display: inline-flex;
}
.card-source-logo--copilot {
  color: var(--accent-fg);
}
.card-source-logo--claude {
  color: var(--claude-fg);
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
