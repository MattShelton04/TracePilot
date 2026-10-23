/**
 * Pure helpers behind the session Metrics tab: how a session's cost divides
 * by token kind and model, the changed-file tree, and the log scale the
 * prompt-cache idle plot draws on.
 */
import { formatPercent, type ModelMetricDetail, type TokenCostBreakdown } from "@tracepilot/types";
import { relativeToRoot } from "@/utils/sessionOverview";

/** Series colours for models, in rank order. */
export const MODEL_COLORS: readonly string[] = [
  "var(--chart-info)",
  "var(--chart-orange)",
  "var(--chart-pink)",
  "var(--chart-lime)",
  "var(--chart-secondary)",
  "var(--chart-cyan)",
];

/** A percentage share; a sliver above zero reads `<0.1%`, not `0%`, and nearly all `>99.9%`, not `100%`. */
export function formatShare(percent: number): string {
  if (percent > 0 && percent < 0.05) return "<0.1%";
  if (percent >= 99.95 && percent < 100) return ">99.9%";
  return formatPercent(percent);
}

// ─── Cost split ────────────────────────────────────────────────

export type CostKind = "cacheRead" | "cacheWrite" | "fresh" | "output";

export interface CostSplit {
  /** Each kind's share of the priced cost, 0 to 1. */
  byKind: Record<CostKind, number>;
  /** Each model's share of the priced cost, 0 to 1. */
  byModel: Record<string, number>;
  /** Models with usage that the price list doesn't cover. */
  unpriced: string[];
}

/**
 * How the cost divides between token kinds and models, at list prices. The
 * shares then split a recorded total (observed AI Credits, a provider's
 * estimate) that has no breakdown of its own. Null when nothing is priced.
 */
export function costSplit(
  models: Record<string, ModelMetricDetail>,
  price: (model: string, usage: NonNullable<ModelMetricDetail["usage"]>) => TokenCostBreakdown,
): CostSplit | null {
  const kinds: Record<CostKind, number> = { cacheRead: 0, cacheWrite: 0, fresh: 0, output: 0 };
  const perModel: Record<string, number> = {};
  const unpriced: string[] = [];
  for (const [name, model] of Object.entries(models)) {
    const usage = model.usage;
    if (!usage) continue;
    const tokens =
      (usage.inputTokens ?? 0) +
      (usage.outputTokens ?? 0) +
      (usage.cacheReadTokens ?? 0) +
      (usage.cacheWriteTokens ?? 0);
    if (tokens === 0) continue;
    const cost = price(name, usage);
    // The parts are computed whenever the model has rates, even when a
    // missing cache-write TTL leaves the total unpriced.
    const parts = {
      fresh: cost.inputCost,
      cacheRead: cost.cachedInputCost,
      cacheWrite: cost.cacheWriteCost,
      output: cost.outputCost + cost.reasoningCost,
    };
    const sum = parts.fresh + parts.cacheRead + parts.cacheWrite + parts.output;
    if (!(sum > 0)) {
      unpriced.push(name);
      continue;
    }
    for (const key of Object.keys(parts) as CostKind[]) kinds[key] += parts[key];
    perModel[name] = sum;
  }
  const total = Object.values(perModel).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  const byKind = Object.fromEntries(
    Object.entries(kinds).map(([key, value]) => [key, value / total]),
  ) as Record<CostKind, number>;
  const byModel = Object.fromEntries(
    Object.entries(perModel).map(([key, value]) => [key, value / total]),
  );
  return { byKind, byModel, unpriced };
}

// ─── Changed-file tree ─────────────────────────────────────────

export interface FileTreeNode {
  /** Display name; folders with a single child folder read `a/b/c`. */
  name: string;
  /** Path from the tree root, used as a stable key. */
  path: string;
  isFile: boolean;
  /** Files at or below this node. */
  files: number;
  children: FileTreeNode[];
  /** A top-level folder outside every root, kept absolute and listed last. */
  outside?: boolean;
}

const ABSOLUTE_PATH = /^([a-z]:[\\/]|[\\/]|~)/i;

function sortTree(node: FileTreeNode): void {
  const rank = (n: FileTreeNode) => (n.outside ? 2 : n.isFile ? 1 : 0);
  node.children.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  for (const child of node.children) sortTree(child);
}

/** Folds a folder whose only child is a folder into it, as `a/b`. */
function compact(node: FileTreeNode): FileTreeNode {
  let current = node;
  while (current.children.length === 1 && !current.children[0].isFile && current.path !== "") {
    const only = current.children[0];
    current = { ...only, name: `${current.name}/${only.name}`, outside: current.outside };
  }
  return { ...current, children: current.children.map(compact) };
}

/**
 * One spelling per file: `/` separators, no repeated separators, and an
 * upper-case drive letter on Windows paths. Other letters keep their case,
 * since POSIX file systems tell `A.ts` and `a.ts` apart.
 */
function filePathKey(path: string): string {
  const slashed = path.replace(/[\\/]+/g, "/");
  return /^[a-z]:\//i.test(slashed) ? slashed[0].toUpperCase() + slashed.slice(1) : slashed;
}

/**
 * Changed files with each file once, in its first spelling, so the Overview
 * and Compare count the same files as Metrics' tree.
 */
export function distinctFilePaths(paths: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const key = filePathKey(path);
    if (!seen.has(key)) seen.set(key, path);
  }
  return [...seen.values()];
}

/** Counts the files (leaves) under each folder, so a file is counted once. */
function countFiles(node: FileTreeNode): number {
  node.files = node.isFile ? 1 : node.children.reduce((n, child) => n + countFiles(child), 0);
  return node.files;
}

/**
 * Changed files as a folder tree, relative to the repository or working
 * directory when they sit inside one. Folders come first, then files, each
 * alphabetically, so the tree is the same on every render. One file spelled
 * with either separator or drive-letter case is one row and counts once.
 */
export function buildFileTree(
  paths: readonly string[],
  roots: readonly (string | null | undefined)[],
): FileTreeNode {
  const root: FileTreeNode = { name: "", path: "", isFile: false, files: 0, children: [] };
  // Children by kind and name, so building stays linear in the path count.
  const byName = new Map<FileTreeNode, Map<string, FileTreeNode>>();
  for (const path of new Set(paths.map(filePathKey))) {
    // Paths outside every root stay absolute; their drive and folders
    // compact into one `C:/Users/…` chain, listed after the repository's.
    const relative = relativeToRoot(path, roots);
    const outside = relative === path && ABSOLUTE_PATH.test(path);
    const parts = relative.split(/[\\/]+/).filter(Boolean);
    if (parts.length === 0) continue;
    if (outside && /^[\\/]/.test(path)) parts[0] = `/${parts[0]}`;
    let node = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const childPath = node.path ? `${node.path}/${part}` : part;
      const key = `${isFile ? "f" : "d"}:${part}`;
      let children = byName.get(node);
      if (!children) {
        children = new Map();
        byName.set(node, children);
      }
      let child = children.get(key);
      if (!child) {
        child = { name: part, path: childPath, isFile, files: 0, children: [] };
        if (outside && node === root && !isFile) child.outside = true;
        node.children.push(child);
        children.set(key, child);
      }
      node = child;
    });
  }
  countFiles(root);
  sortTree(root);
  return compact(root);
}

/** The folder paths in a tree, outermost first. */
export function folderPaths(node: FileTreeNode, depth = Number.POSITIVE_INFINITY): string[] {
  if (depth < 0) return [];
  const own = node.isFile || node.path === "" ? [] : [node.path];
  return [...own, ...node.children.flatMap((child) => folderPaths(child, depth - 1))];
}

function prune(node: FileTreeNode, needle: string): FileTreeNode | null {
  if (node.isFile) return node.path.toLocaleLowerCase().includes(needle) ? node : null;
  const children = node.children
    .map((child) => prune(child, needle))
    .filter((child): child is FileTreeNode => child != null);
  if (children.length === 0) return null;
  return { ...node, children, files: children.reduce((n, c) => n + c.files, 0) };
}

/**
 * The tree with only files whose path contains `query`, its folder chains
 * compacted again; null when none match.
 */
export function filterFileTree(node: FileTreeNode, query: string): FileTreeNode | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return node;
  const pruned = prune(node, needle);
  return pruned && compact(pruned);
}

// ─── Idle-time scale for the prompt-cache plot ─────────────────

export interface LogScale {
  lo: number;
  hi: number;
}

const IDLE_TICKS: ReadonlyArray<[number, string]> = [
  [1, "1s"],
  [10, "10s"],
  [60, "1m"],
  [300, "5m"],
  [1800, "30m"],
  [3600, "1h"],
  [6 * 3600, "6h"],
  [86_400, "1d"],
  [7 * 86_400, "7d"],
  [30 * 86_400, "30d"],
];

/**
 * A log10 domain covering every idle time and cache TTL, widened to whole
 * tick marks so the extremes never sit on the plot's edge.
 */
export function idleScale(seconds: readonly number[]): LogScale {
  const values = seconds.filter((s) => Number.isFinite(s) && s > 0);
  const min = Math.max(1, Math.min(...values, 60));
  const max = Math.max(...values, 600);
  const below = [...IDLE_TICKS].reverse().find(([s]) => s <= min)?.[0] ?? 1;
  const above = IDLE_TICKS.find(([s]) => s >= max)?.[0] ?? max;
  return { lo: Math.log10(below), hi: Math.log10(above) };
}

/** Where `seconds` falls across the scale, from 0 to 100. */
export function idlePercent(seconds: number, scale: LogScale): number {
  const x = Math.log10(Math.max(1, seconds));
  const pct = ((x - scale.lo) / (scale.hi - scale.lo)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** The tick marks that fit the scale, thinned until labels are `minGapPx` apart. */
export function idleTicks(
  scale: LogScale,
  widthPx: number,
  minGapPx = 44,
): Array<{ pct: number; label: string }> {
  const ticks = IDLE_TICKS.filter(([s]) => {
    const x = Math.log10(s);
    return x >= scale.lo - 1e-9 && x <= scale.hi + 1e-9;
  }).map(([s, label]) => ({ pct: idlePercent(s, scale), label }));
  const out: typeof ticks = [];
  for (const tick of ticks) {
    const last = out.at(-1);
    if (!last || ((tick.pct - last.pct) / 100) * widthPx >= minGapPx) out.push(tick);
  }
  return out;
}

/**
 * Stacks dots that would overlap: each dot's row above the axis, given its
 * position (0–100), the plot width and the dot diameter in pixels.
 */
export function stackDots(pcts: readonly number[], widthPx: number, dotPx: number): number[] {
  const columns = new Map<number, number>();
  return pcts.map((pct) => {
    const column = Math.round(((pct / 100) * widthPx) / dotPx);
    const row = columns.get(column) ?? 0;
    columns.set(column, row + 1);
    return row;
  });
}
