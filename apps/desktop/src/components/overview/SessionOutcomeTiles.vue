<script setup lang="ts">
/**
 * What a session did: how it ended, what went wrong, where its changes
 * landed, what it saved, and where its time went. One tile per question.
 */
import type { FileCheckpoint } from "@tracepilot/client";
import type { CheckpointEntry, CodeChanges, SessionIncident } from "@tracepilot/types";
import { formatNumberFull, formatRelativeTime } from "@tracepilot/ui";
import {
  Archive,
  ArrowRight,
  CircleCheck,
  Clock,
  FileDiff,
  Flag,
  OctagonX,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Zap,
} from "lucide-vue-next";
import { computed } from "vue";
import type { SessionLiveState } from "@/composables/useSessionLiveState";
import { formatRecordedDuration } from "@/utils/sessionDurations";
import { countIncidents, groupByFolder, splitSessionTime } from "@/utils/sessionOverview";
import OverviewPanel from "./OverviewPanel.vue";

export type OverviewSection = "incidents" | "checkpoints" | "fileHistory" | "plan";

const props = defineProps<{
  live: SessionLiveState;
  /** The source writes exit records (Copilot's shutdown event). */
  hasExitMetrics: boolean;
  shutdownType: string | null | undefined;
  /** Runs recorded between exits; more than one means it was resumed. */
  runCount: number;
  updatedAt: string | null | undefined;
  incidents: SessionIncident[];
  codeChanges: CodeChanges | null | undefined;
  fileSnapshots: FileCheckpoint[];
  checkpoints: CheckpointEntry[];
  hasPlan: boolean;
  /** Repository root and working directory, to show changed paths relative to. */
  roots: (string | null | undefined)[];
  spanMs: number | null;
  apiMs: number | null | undefined;
  toolMs: number | null | undefined;
}>();

const emit = defineEmits<{ jump: [section: OverviewSection] }>();

type Tone = "success" | "warning" | "danger" | "neutral" | "attention";

const exit = computed<{
  tone: Tone;
  title: string;
  detail: string;
  live?: boolean;
  icon?: typeof Flag;
}>(() => {
  const lastActivity = props.updatedAt
    ? `Last activity ${formatRelativeTime(props.updatedAt)}`
    : "";
  if (props.live.running) {
    const waiting = props.live.status === "waiting";
    return {
      tone: waiting ? "warning" : "success",
      title: waiting ? "Waiting for input" : props.live.status === "busy" ? "Working" : "Running",
      detail: lastActivity,
      live: true,
    };
  }
  const runs =
    props.runCount > 1
      ? `Resumed ${props.runCount === 2 ? "once" : `${props.runCount - 1} times`} · ${props.runCount} runs`
      : "One continuous run";
  if (!props.hasExitMetrics) {
    return { tone: "neutral", title: "Not running", detail: lastActivity, icon: Clock };
  }
  if (!props.shutdownType) {
    return {
      tone: "neutral",
      title: "No exit record",
      detail: "The session didn't record a shutdown",
      icon: Clock,
    };
  }
  if (props.shutdownType === "routine") {
    return { tone: "success", title: "Ended normally", detail: runs, icon: Flag };
  }
  return { tone: "danger", title: `Ended: ${props.shutdownType}`, detail: runs, icon: OctagonX };
});

const incidentCounts = computed(() => countIncidents(props.incidents));
const incidentTone = computed<Tone>(() =>
  incidentCounts.value.errors ? "danger" : incidentCounts.value.total ? "attention" : "success",
);
const incidentBreakdown = computed(() => {
  const c = incidentCounts.value;
  const parts = (
    [
      [c.errors, "error", "errors"],
      [c.rateLimits, "rate limit", "rate limits"],
      [c.warnings, "warning", "warnings"],
      [c.compactions, "compaction", "compactions"],
      [c.truncations, "truncation", "truncations"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return parts.length ? parts.join(" · ") : "No errors, rate limits, compactions or truncations";
});

// Claude Code records the files it backs up, not line counts.
const changedFiles = computed(() => {
  if (props.codeChanges?.filesModified?.length) return props.codeChanges.filesModified;
  const paths = new Set<string>();
  for (const snapshot of props.fileSnapshots) {
    for (const file of snapshot.files) paths.add(file.path);
  }
  return [...paths];
});
const hasLineCounts = computed(
  () => (props.codeChanges?.linesAdded ?? 0) + (props.codeChanges?.linesRemoved ?? 0) > 0,
);
const folders = computed(() => groupByFolder(changedFiles.value, props.roots));
const FOLDER_COLORS = [
  "var(--chart-primary)",
  "var(--chart-info)",
  "var(--chart-secondary)",
  "var(--chart-lime)",
  "var(--chart-pink)",
  "var(--chart-orange)",
];
const footprint = computed(() => {
  const groups = folders.value;
  const shown = groups.slice(0, FOLDER_COLORS.length);
  const rest = groups.slice(FOLDER_COLORS.length).reduce((n, g) => n + g.files.length, 0);
  const segments = shown.map((g, i) => ({
    key: g.folder,
    count: g.files.length,
    color: FOLDER_COLORS[i],
    title: `${g.folder} · ${g.files.length} file${g.files.length === 1 ? "" : "s"}`,
  }));
  if (rest > 0) {
    segments.push({
      key: "other",
      count: rest,
      color: "var(--neutral-emphasis)",
      title: `Other folders · ${rest} files`,
    });
  }
  return segments;
});
const folderSummary = computed(() => {
  const inside = folders.value.filter((g) => g.folder !== "(elsewhere)");
  const elsewhere = inside.length < folders.value.length;
  if (!inside.length) return "outside the working directory";
  const parts = inside
    .slice(0, 3)
    .map((g) => (g.folder === "(root)" ? "the top folder" : g.folder));
  if (inside.length > parts.length) parts.push(`${inside.length - parts.length} more`);
  if (elsewhere) parts.push("elsewhere");
  const last = parts.pop();
  return `in ${parts.length ? `${parts.join(", ")} and ${last}` : last}`;
});

const saved = computed(() => {
  const parts: string[] = [];
  let latest = "";
  let section: OverviewSection | null = null;
  if (props.checkpoints.length) {
    parts.push(
      `${props.checkpoints.length} checkpoint${props.checkpoints.length === 1 ? "" : "s"}`,
    );
    latest = props.checkpoints.at(-1)?.title ?? "";
    section = "checkpoints";
  }
  if (props.fileSnapshots.length) {
    parts.push(
      `${props.fileSnapshots.length} file snapshot${props.fileSnapshots.length === 1 ? "" : "s"}`,
    );
    latest ||= props.fileSnapshots.at(-1)?.prompt?.trim() ?? "";
    section ??= "fileHistory";
  }
  if (props.hasPlan) {
    parts.push("a plan");
    section ??= "plan";
  }
  return { parts, latest, section };
});

const split = computed(() => splitSessionTime(props.spanMs, props.apiMs, props.toolMs));
const hasToolTime = computed(() => (props.toolMs ?? 0) > 0);
const otherMs = computed(() =>
  props.spanMs ? Math.max(0, props.spanMs - (props.apiMs ?? 0) - (props.toolMs ?? 0)) : null,
);
</script>

<template>
  <OverviewPanel title="What happened" flush data-testid="session-outcome">
    <template #icon><ShieldCheck :size="14" aria-hidden="true" /></template>
    <div class="tiles">
      <div class="tile" data-testid="outcome-exit">
        <div class="tile__label"><Flag :size="13" aria-hidden="true" />Exit</div>
        <div class="tile__value">
          <span class="tile__badge" :class="`tone-${exit.tone}`">
            <span v-if="exit.live" class="live-dot" aria-hidden="true" />
            <component :is="exit.icon" v-else :size="13" aria-hidden="true" />
          </span>
          {{ exit.title }}
        </div>
        <div class="tile__detail">{{ exit.detail }}</div>
      </div>

      <div class="tile" data-testid="outcome-incidents">
        <div class="tile__label">
          <TriangleAlert :size="13" aria-hidden="true" />Incidents
          <button v-if="incidentCounts.total" type="button" class="tile__link" @click="emit('jump', 'incidents')">
            View <ArrowRight :size="12" aria-hidden="true" />
          </button>
        </div>
        <div class="tile__value">
          <span class="tile__badge" :class="`tone-${incidentTone}`">
            <CircleCheck v-if="!incidentCounts.total" :size="13" aria-hidden="true" />
            <TriangleAlert v-else :size="13" aria-hidden="true" />
          </span>
          {{
            incidentCounts.total
              ? `${incidentCounts.total} incident${incidentCounts.total === 1 ? "" : "s"}`
              : "No incidents"
          }}
        </div>
        <div class="tile__detail">{{ incidentBreakdown }}</div>
      </div>

      <div class="tile" data-testid="outcome-changes">
        <div class="tile__label">
          <FileDiff :size="13" aria-hidden="true" />{{ codeChanges ? "Changes" : "Files touched" }}
          <button
            v-if="fileSnapshots.length"
            type="button"
            class="tile__link"
            @click="emit('jump', 'fileHistory')"
          >
            View <ArrowRight :size="12" aria-hidden="true" />
          </button>
        </div>
        <template v-if="codeChanges || changedFiles.length">
          <div class="tile__value tile__value--mono">
            <template v-if="hasLineCounts && codeChanges">
              <span class="lines-added">+{{ formatNumberFull(codeChanges.linesAdded ?? 0) }}</span>
              <span class="lines-removed">−{{ formatNumberFull(codeChanges.linesRemoved ?? 0) }}</span>
            </template>
            <template v-else>{{ changedFiles.length }} file{{ changedFiles.length === 1 ? "" : "s" }}</template>
          </div>
          <div v-if="footprint.length" class="footprint" role="img" :aria-label="`Changed files ${folderSummary}`">
            <i
              v-for="seg in footprint"
              :key="seg.key"
              :style="{ flexGrow: seg.count, background: seg.color }"
              :title="seg.title"
              data-reveal="grow-x"
            />
          </div>
          <div class="tile__detail">
            <template v-if="changedFiles.length">
              {{ changedFiles.length }} file{{ changedFiles.length === 1 ? "" : "s" }} {{ folderSummary }}
            </template>
            <template v-else>No file list recorded</template>
          </div>
        </template>
        <div v-else class="tile__value tile__value--muted">None recorded</div>
      </div>

      <div class="tile" data-testid="outcome-saved">
        <div class="tile__label">
          <Archive :size="13" aria-hidden="true" />Saved state
          <button v-if="saved.section" type="button" class="tile__link" @click="emit('jump', saved.section)">
            View <ArrowRight :size="12" aria-hidden="true" />
          </button>
        </div>
        <div class="tile__value" :class="{ 'tile__value--muted': !saved.parts.length }">
          {{ saved.parts.length ? saved.parts.join(" · ") : "Nothing saved" }}
        </div>
        <div class="tile__detail" :title="saved.latest || undefined">
          <template v-if="saved.latest">Latest: “{{ saved.latest }}”</template>
        </div>
      </div>

      <div class="tile tile--wide" data-testid="outcome-time">
        <div class="tile__label">
          <Timer :size="13" aria-hidden="true" />Where the time went
          <span class="tile__aside mono">{{ formatRecordedDuration(spanMs) }}</span>
        </div>
        <template v-if="split">
          <div class="split" role="img" :aria-label="`Model ${Math.round(split.model * 100)}% of the session`">
            <i class="split__model" :style="{ flexGrow: split.model }" data-reveal="grow-x" />
            <i v-if="split.tools" class="split__tools" :style="{ flexGrow: split.tools }" data-reveal="grow-x" />
            <i class="split__other" :style="{ flexGrow: split.other }" />
          </div>
          <div class="legend">
            <span><i class="split__model" />Model <b>{{ formatRecordedDuration(apiMs) }}</b></span>
            <span v-if="hasToolTime"><i class="split__tools" />Tools <b>{{ formatRecordedDuration(toolMs) }}</b></span>
            <span v-if="!split.overlapped">
              <i class="split__other" />{{ hasToolTime ? "You & idle" : "Everything else" }}
              <b>{{ formatRecordedDuration(otherMs) }}</b>
            </span>
            <span v-else class="legend__note">
              <Zap :size="12" aria-hidden="true" />Model calls overlapped (parallel agents)
            </span>
          </div>
        </template>
        <div v-else class="tile__detail">No model timing recorded for this session.</div>
      </div>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: var(--border-muted);
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px;
  background: var(--canvas-subtle);
}

.tile--wide {
  grid-column: 1 / -1;
}

.tile__label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.tile__label > svg {
  color: var(--text-tertiary);
}

.tile__link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-fg);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.tile__link:hover {
  text-decoration: underline;
}

.tile__aside {
  margin-left: auto;
  color: var(--text-tertiary);
  font-weight: 400;
}

.tile__value {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: var(--text-primary);
}

.tile__value--mono {
  font-family: var(--font-mono);
  font-size: 17px;
  font-variant-numeric: tabular-nums;
}

.tile__value--muted {
  font-weight: 500;
  color: var(--text-tertiary);
}

.tile__detail {
  min-height: 16px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile__badge {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: 1px solid;
  border-radius: 50%;
}

.tone-success {
  color: var(--success-fg);
  background: var(--success-subtle);
  border-color: var(--success-muted);
}
.tone-warning {
  color: var(--warning-fg);
  background: var(--warning-subtle);
  border-color: var(--warning-muted);
}
.tone-danger {
  color: var(--danger-fg);
  background: var(--danger-subtle);
  border-color: var(--danger-muted);
}
.tone-attention {
  color: var(--attention-fg);
  background: var(--attention-subtle);
  border-color: var(--warning-muted);
}
.tone-neutral {
  color: var(--neutral-fg);
  background: var(--neutral-subtle);
  border-color: var(--neutral-muted);
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.lines-added {
  color: var(--success-fg);
}

.lines-removed {
  color: var(--danger-fg);
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.footprint,
.split {
  display: flex;
  gap: 1px;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--surface-tertiary);
}

.footprint i,
.split i {
  display: block;
  min-width: 2px;
}

.split__model {
  background: var(--chart-primary);
}

.split__tools {
  background: var(--chart-cyan);
}

.split .split__other {
  background: transparent;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.legend .split__other {
  background: var(--surface-tertiary);
}

.legend b {
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--text-primary);
}

.legend__note {
  color: var(--text-tertiary);
}
</style>
