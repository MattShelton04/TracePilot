<script setup lang="ts">
/**
 * Where, with which agent and when a session ran, plus its ID: the
 * Overview's identity facts, grouped by the question each answers.
 */
import type { SessionDetail } from "@tracepilot/types";
import {
  formatDate,
  formatRelativeTime,
  projectLabelFromCwd,
  splitLastPathSegment,
  useClipboard,
} from "@tracepilot/ui";
import { BookMarked, Check, Copy, Folder, GitBranch, Hash, Monitor } from "lucide-vue-next";
import { computed } from "vue";
import { effortLevel, effortName, formatClock, spansDays } from "@/utils/sessionOverview";
import OverviewPanel from "./OverviewPanel.vue";

const props = defineProps<{
  detail: SessionDetail;
  /** Recorded model id, shown as the tooltip. */
  model: string | null;
  /** The model's display name. */
  modelLabel: string | null;
  effort: string | null;
  /** The host is shown for sources that record it. */
  showHost: boolean;
  isClaude: boolean;
  running: boolean;
}>();

const cwd = computed(() => props.detail.cwd?.trim() || null);
const cwdParts = computed(() => splitLastPathSegment(cwd.value ?? ""));
const project = computed(() => projectLabelFromCwd(cwd.value));
const level = computed(() => (props.effort ? effortLevel(props.effort) : null));
/**
 * Copilot records no effort when the model's default applies. Claude Code
 * versions before it recorded `effort` on each call leave it unknown.
 */
const unsetEffortLabel = computed(() => (props.isClaude ? "Not recorded" : "Model default"));

const created = computed(() =>
  props.detail.createdAt ? Date.parse(props.detail.createdAt) : null,
);
const updated = computed(() =>
  props.detail.updatedAt ? Date.parse(props.detail.updatedAt) : null,
);
const range = computed(() => {
  const start = created.value;
  if (start == null || Number.isNaN(start)) return null;
  const end = updated.value != null && !Number.isNaN(updated.value) ? updated.value : start;
  const withDate = spansDays({ start, end });
  return {
    day: new Date(start).toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    from: formatClock(start),
    to: formatClock(end, withDate),
  };
});

const { copy: copyCwd, copied: cwdCopied } = useClipboard();
const { copy: copyId, copied: idCopied } = useClipboard();
</script>

<template>
  <OverviewPanel title="Context" flush data-testid="session-context">
    <template v-if="detail.createdAt" #aside>
      <span :title="formatDate(detail.createdAt)">{{ formatRelativeTime(detail.createdAt) }}</span>
    </template>

    <div class="facet">
      <div class="facet__label">Where</div>
      <div class="facet__body">
        <div v-if="detail.repository || project || detail.branch" class="facet__line facet__line--wrap">
          <span v-if="detail.repository" class="facet__line">
            <BookMarked :size="14" class="facet__icon" aria-hidden="true" />
            <span class="facet__strong">{{ detail.repository }}</span>
          </span>
          <span v-else-if="project" class="facet__line">
            <Folder :size="14" class="facet__icon" aria-hidden="true" />
            <span class="facet__strong">{{ project }}</span>
          </span>
          <span v-if="(detail.repository || project) && detail.branch" class="facet__sep">/</span>
          <span v-if="detail.branch" class="branch" title="Branch">
            <GitBranch :size="12" aria-hidden="true" />{{ detail.branch }}
          </span>
        </div>
        <span v-else class="facet__muted">No repository or branch recorded</span>
        <div v-if="cwd" class="facet__line">
          <Folder :size="14" class="facet__icon" aria-hidden="true" />
          <span class="cwd-path" :title="cwd" data-testid="session-cwd">
            <span class="cwd-path__head">{{ cwdParts.head }}</span>
            <span class="cwd-path__tail">{{ cwdParts.tail }}</span>
          </span>
          <button
            type="button"
            class="icon-btn"
            :title="cwdCopied ? 'Copied' : 'Copy working directory'"
            :aria-label="cwdCopied ? 'Copied' : 'Copy working directory'"
            data-testid="session-cwd-copy"
            @click="copyCwd(cwd)"
          >
            <Check v-if="cwdCopied" :size="12" aria-hidden="true" />
            <Copy v-else :size="12" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div class="facet">
      <div class="facet__label">Agent</div>
      <div class="facet__body">
        <div class="facet__line facet__line--wrap">
          <span
            v-if="modelLabel"
            class="model-chip"
            :class="{ 'model-chip--claude': isClaude }"
            :title="model ?? undefined"
            data-testid="session-model"
          >{{ modelLabel }}</span>
          <span v-else class="facet__muted">No model recorded</span>
          <span class="effort" title="Main agent reasoning effort" data-testid="session-effort">
            <span
              v-if="level !== null || (!effort && !isClaude)"
              class="effort__bars"
              :class="{ 'effort__bars--default': !effort }"
              aria-hidden="true"
            >
              <i v-for="n in 4" :key="n" :class="{ on: level !== null && n <= level }" />
            </span>
            <span class="effort__label" :class="{ 'effort__label--unknown': !effort && isClaude }">{{
              effort ? effortName(effort) : unsetEffortLabel
            }}</span>
          </span>
          <span v-if="showHost && detail.hostType" class="host-chip" title="Host">
            <Monitor :size="12" aria-hidden="true" />{{ detail.hostType }}
          </span>
        </div>
      </div>
    </div>

    <div class="facet">
      <div class="facet__label">When</div>
      <div class="facet__body">
        <div v-if="range" class="facet__line facet__line--wrap">
          <span class="facet__strong">{{ range.day }}</span>
          <span class="mono">
            {{ range.from }} <span class="facet__sep">→</span>
            <span v-if="running" class="now">now</span>
            <template v-else>{{ range.to }}</template>
          </span>
        </div>
        <span class="facet__muted facet__small">
          Created {{ formatDate(detail.createdAt) || "—" }} · updated
          {{ running ? formatRelativeTime(detail.updatedAt) : formatDate(detail.updatedAt) || "—" }}
        </span>
      </div>
    </div>

    <div class="facet">
      <div class="facet__label">Session</div>
      <div class="facet__body">
        <div class="facet__line">
          <Hash :size="12" class="facet__icon" aria-hidden="true" />
          <span class="session-id mono" :title="detail.id">{{ detail.id }}</span>
          <button
            type="button"
            class="icon-btn"
            :title="idCopied ? 'Copied' : 'Copy session ID'"
            :aria-label="idCopied ? 'Copied' : 'Copy session ID'"
            @click="copyId(detail.id)"
          >
            <Check v-if="idCopied" :size="12" aria-hidden="true" />
            <Copy v-else :size="12" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.facet {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-muted);
}

.facet:last-child {
  border-bottom: none;
}

.facet__label {
  padding-top: 2px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

/* Two sizes: 13px for each facet's main line, 12px for chips and detail. */
.facet__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--text-primary);
}

.facet__line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.facet__line--wrap {
  flex-wrap: wrap;
  row-gap: 6px;
}

.facet__icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.facet__strong {
  font-weight: 500;
}

.facet__sep {
  color: var(--text-placeholder);
}

.facet__muted {
  color: var(--text-tertiary);
}

.facet__small {
  font-size: 12px;
  line-height: 16px;
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.now {
  color: var(--success-fg);
}

.branch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--success-fg);
  background: var(--success-subtle);
  min-width: 0;
  overflow-wrap: anywhere;
}

.cwd-path {
  display: flex;
  min-width: 0;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
}

.cwd-path__head {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  color: var(--text-tertiary);
}

.cwd-path__tail {
  flex-shrink: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}

.session-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.icon-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}

.icon-btn:hover {
  color: var(--text-primary);
  background: var(--surface-tertiary);
}

.model-chip {
  padding: 1px 8px;
  border: 1px solid var(--done-muted);
  border-radius: var(--radius-sm);
  background: var(--done-subtle);
  color: var(--done-fg);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 18px;
}

.model-chip--claude {
  border-color: var(--claude-border);
  background: var(--claude-subtle);
  color: var(--claude-fg);
  font-family: var(--font-family);
  font-weight: 500;
}

.effort {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.effort__bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
}

.effort__bars i {
  display: block;
  width: 4px;
  border-radius: 1px;
  background: var(--surface-tertiary);
}

.effort__bars i:nth-child(1) {
  height: 5px;
}
.effort__bars i:nth-child(2) {
  height: 7px;
}
.effort__bars i:nth-child(3) {
  height: 9px;
}
.effort__bars i:nth-child(4) {
  height: 12px;
}

.effort__bars i.on {
  background: var(--done-fg);
}

.effort__bars--default i {
  background: transparent;
  border: 1px dashed var(--border-emphasis);
}

.effort__label {
  color: var(--text-secondary);
}

.effort__label--unknown {
  color: var(--text-tertiary);
}

.host-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-tertiary);
  font-size: 12px;
  line-height: 18px;
  color: var(--text-secondary);
}
</style>
