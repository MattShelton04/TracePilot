/**
 * Pure helpers behind the session Overview: the activity chart's bins and
 * markers, where file changes landed, and how the session's time divides.
 */

/** A time window in Unix milliseconds. */
export interface TimeWindow {
  start: number;
  end: number;
}

/** The shortest window the activity chart draws, so a blip still has width. */
const MIN_WINDOW_MS = 60_000;

/**
 * The window the activity chart spans: the session's recorded start and end,
 * widened to every turn start so none falls off the edge.
 */
export function activityWindow(
  createdAt: number | null,
  updatedAt: number | null,
  turnStarts: readonly (number | null)[],
): TimeWindow | null {
  const times = turnStarts.filter((t): t is number => t != null);
  const candidates = [createdAt, updatedAt, ...times].filter(
    (t): t is number => t != null && Number.isFinite(t),
  );
  if (candidates.length === 0) return null;
  const start = Math.min(...candidates);
  const end = Math.max(...candidates);
  return { start, end: Math.max(end, start + MIN_WINDOW_MS) };
}

/** How many bins suit a session: about one and a half turns each, 16 to 48. */
export function activityBinCount(turns: number): number {
  return Math.max(16, Math.min(48, Math.round(turns / 1.5)));
}

/** Turn starts counted into `count` equal bins across the window. */
export function binTurnStarts(
  turnStarts: readonly (number | null)[],
  window: TimeWindow,
  count: number,
): number[] {
  const bins = new Array<number>(count).fill(0);
  const span = window.end - window.start;
  for (const t of turnStarts) {
    if (t == null) continue;
    const i = Math.floor(((t - window.start) / span) * count);
    bins[Math.min(count - 1, Math.max(0, i))] += 1;
  }
  return bins;
}

/** Where `t` falls across the window, from 0 to 100. */
export function windowPercent(t: number, window: TimeWindow): number {
  const pct = ((t - window.start) / (window.end - window.start)) * 100;
  return Math.min(100, Math.max(0, pct));
}

export type ActivityMarkerKind =
  | "error"
  | "warning"
  | "compaction"
  | "truncation"
  | "resume"
  | "snapshot";

export interface ActivityMarker {
  kind: ActivityMarkerKind;
  at: number;
  label: string;
}

export interface MarkerCluster {
  /** Position across the window, 0–100, of the cluster's first marker. */
  pct: number;
  /** The most severe kind in the cluster, which picks its icon and colour. */
  kind: ActivityMarkerKind;
  markers: ActivityMarker[];
}

const SEVERITY: Record<ActivityMarkerKind, number> = {
  error: 5,
  warning: 4,
  truncation: 3,
  compaction: 2,
  resume: 1,
  snapshot: 0,
};

/**
 * Markers sorted by time, with any closer than `minGapPct` of the window to
 * the previous cluster folded into it, so dense incidents stay legible.
 */
export function clusterMarkers(
  markers: readonly ActivityMarker[],
  window: TimeWindow,
  minGapPct = 2,
): MarkerCluster[] {
  const clusters: MarkerCluster[] = [];
  for (const marker of [...markers].sort((a, b) => a.at - b.at)) {
    const pct = windowPercent(marker.at, window);
    const last = clusters.at(-1);
    if (last && pct - last.pct < minGapPct) {
      last.markers.push(marker);
      if (SEVERITY[marker.kind] > SEVERITY[last.kind]) last.kind = marker.kind;
    } else {
      clusters.push({ pct, kind: marker.kind, markers: [marker] });
    }
  }
  return clusters;
}

/** Splits a path on either separator, dropping empty segments. */
function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

/**
 * `path` relative to the first root it sits under, compared
 * case-insensitively for Windows paths. Paths under no root are unchanged.
 */
export function relativeToRoot(
  path: string,
  roots: readonly (string | null | undefined)[],
): string {
  const parts = segments(path);
  for (const root of roots) {
    if (!root) continue;
    const rootParts = segments(root);
    if (rootParts.length === 0 || rootParts.length >= parts.length) continue;
    const matches = rootParts.every((p, i) => p.toLowerCase() === parts[i].toLowerCase());
    if (matches) return parts.slice(rootParts.length).join("/");
  }
  return path;
}

export interface FolderGroup {
  /**
   * `packages/types/`, `docs/`, `(root)` for files at the top level, or
   * `(elsewhere)` for absolute paths outside every root.
   */
  folder: string;
  files: string[];
}

const ABSOLUTE_PATH = /^([a-z]:[\\/]|[\\/]|~)/i;

/**
 * Files grouped by where they sit: two folders deep when a path has them
 * (`packages/types/`), one for shallower paths, `(root)` for top-level
 * files. Absolute paths outside every root share one `(elsewhere)` group
 * instead of being split by drive and user folder. Largest groups first.
 */
export function groupByFolder(
  paths: readonly string[],
  roots: readonly (string | null | undefined)[],
): FolderGroup[] {
  const groups = new Map<string, string[]>();
  for (const path of new Set(paths)) {
    const relative = relativeToRoot(path, roots);
    const parts = segments(relative);
    const folder =
      relative === path && ABSOLUTE_PATH.test(path)
        ? "(elsewhere)"
        : parts.length > 2
          ? `${parts.slice(0, 2).join("/")}/`
          : parts.length === 2
            ? `${parts[0]}/`
            : "(root)";
    const files = groups.get(folder) ?? [];
    files.push(path);
    groups.set(folder, files);
  }
  return [...groups.entries()]
    .map(([folder, files]) => ({ folder, files }))
    .sort((a, b) => b.files.length - a.files.length || a.folder.localeCompare(b.folder));
}

export interface TimeSplit {
  /** Fractions of the wall-clock span, each 0–1, summing to at most 1. */
  model: number;
  tools: number;
  other: number;
  /** Model and tool time add up to more than the span (parallel agents). */
  overlapped: boolean;
}

/**
 * How the session's wall-clock span divides between waiting on the model,
 * running tools, and everything else. `null` without a span or model time.
 */
export function splitSessionTime(
  spanMs: number | null,
  modelMs: number | null | undefined,
  toolMs: number | null | undefined,
): TimeSplit | null {
  if (!spanMs || spanMs <= 0 || !modelMs) return null;
  const tools = toolMs ?? 0;
  const overlapped = modelMs + tools > spanMs;
  const model = Math.min(1, modelMs / spanMs);
  const toolShare = Math.min(1 - model, tools / spanMs);
  return { model, tools: toolShare, other: Math.max(0, 1 - model - toolShare), overlapped };
}

const DAY_MS = 86_400_000;

/** A clock time such as `7:05 pm`, with the date added for spans over a day. */
export function formatClock(ms: number, withDate = false): string {
  const date = new Date(ms);
  const clock = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!withDate) return clock;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock}`;
}

/** Whether a window crosses into another day, so its labels need dates. */
export function spansDays(window: TimeWindow): boolean {
  return (
    window.end - window.start >= DAY_MS ||
    new Date(window.start).toDateString() !== new Date(window.end).toDateString()
  );
}

/** Reasoning effort as a 0–4 meter level; `null` for a value it can't place. */
export function effortLevel(effort: string): number | null {
  const levels: Record<string, number> = {
    minimal: 1,
    low: 1,
    medium: 2,
    high: 3,
    xhigh: 4,
    "extra-high": 4,
    max: 4,
  };
  return levels[effort.toLowerCase()] ?? null;
}

/** Display text for a reasoning effort: `High`, `Extra high`. */
export function effortName(effort: string): string {
  const lower = effort.toLowerCase();
  if (lower === "xhigh" || lower === "extra-high") return "Extra high";
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export interface IncidentCounts {
  errors: number;
  rateLimits: number;
  warnings: number;
  compactions: number;
  truncations: number;
  total: number;
}

interface IncidentLike {
  eventType: string;
  summary: string;
  detailJson?: unknown;
}

/** Rate limits are recorded as errors; the raw event names the error type. */
export function isRateLimit(incident: IncidentLike): boolean {
  if (incident.eventType !== "error") return false;
  const detail = incident.detailJson as { errorType?: unknown } | null | undefined;
  return detail?.errorType === "rate_limit" || incident.summary === "Rate limit hit";
}

/** Incidents counted by kind, with rate limits split out of errors. */
export function countIncidents(incidents: readonly IncidentLike[]): IncidentCounts {
  const counts = {
    errors: 0,
    rateLimits: 0,
    warnings: 0,
    compactions: 0,
    truncations: 0,
    total: 0,
  };
  for (const incident of incidents) {
    counts.total += 1;
    if (isRateLimit(incident)) counts.rateLimits += 1;
    else if (incident.eventType === "error") counts.errors += 1;
    else if (incident.eventType === "warning") counts.warnings += 1;
    else if (incident.eventType === "compaction") counts.compactions += 1;
    else if (incident.eventType === "truncation") counts.truncations += 1;
  }
  return counts;
}
