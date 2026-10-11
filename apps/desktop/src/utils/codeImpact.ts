/**
 * Pure helpers for the Code page: per-day rows for `AnalyticsDayChart`, the
 * file-type split, and short file labels.
 *
 * Line counts are per session (Copilot's shutdown totals, Claude Code's
 * cost-state totals or, before one is written, its edit patches) and land on
 * the session's last day. Nothing records
 * lines per file, so files rank by how many sessions modified them.
 */
import type { CodeImpactData } from "@tracepilot/types";
import type { DayRow, DaySeries } from "@/utils/analyticsDashboard";

export const CODE_SERIES: DaySeries[] = [
  { key: "added", label: "Added", color: "var(--success-fg)" },
  { key: "removed", label: "Removed", color: "var(--danger-fg)" },
];

export function codeDayRows(data: CodeImpactData, days: readonly string[]): DayRow[] {
  const byDate = new Map(data.changesByDay.map((day) => [day.date, day]));
  return days.map((date) => {
    const day = byDate.get(date);
    return {
      from: date,
      to: date,
      values: [day?.additions ?? 0, day?.deletions ?? 0],
      runs: 0,
      errors: 0,
      rateLimits: 0,
    };
  });
}

/** Series colours for the leading file types; the rest share one grey. */
const TYPE_COLORS = [
  "var(--chart-primary)",
  "var(--chart-cyan)",
  "var(--chart-success)",
  "var(--chart-warning)",
  "var(--chart-pink)",
  "var(--chart-orange)",
];
export const OTHER_TYPE_COLOR = "var(--text-tertiary)";

export interface FileTypeRow {
  key: string;
  label: string;
  count: number;
  /** Share of all modifications, 0–100. */
  share: number;
  color: string;
}

/** `.ts` for `ts` or `.ts`; the backend's `(no ext)` reads as words. */
export function extensionLabel(extension: string): string {
  if (!extension || extension === "(no ext)") return "no extension";
  return extension.startsWith(".") ? extension : `.${extension}`;
}

/**
 * Every type with its share of modifications. The first `coloured` get
 * their own colour; later ones share the grey of the split bar's "other".
 */
export function fileTypeRows(
  breakdown: CodeImpactData["fileTypeBreakdown"],
  coloured = TYPE_COLORS.length,
): FileTypeRow[] {
  const total = breakdown.reduce((sum, entry) => sum + entry.count, 0);
  return [...breakdown]
    .sort((a, b) => b.count - a.count)
    .map((entry, i) => ({
      key: entry.extension,
      label: extensionLabel(entry.extension),
      count: entry.count,
      share: total ? (entry.count / total) * 100 : 0,
      color: i < Math.min(coloured, TYPE_COLORS.length) ? TYPE_COLORS[i] : OTHER_TYPE_COLOR,
    }));
}

/** The split bar: coloured types, then everything else as one segment. */
export function fileTypeSplit(rows: readonly FileTypeRow[]): FileTypeRow[] {
  const coloured = rows.filter((row) => row.color !== OTHER_TYPE_COLOR);
  const rest = rows.filter((row) => row.color === OTHER_TYPE_COLOR);
  if (!rest.length) return coloured;
  return [
    ...coloured,
    {
      key: "(other)",
      label: `${rest.length} other type${rest.length === 1 ? "" : "s"}`,
      count: rest.reduce((sum, row) => sum + row.count, 0),
      share: rest.reduce((sum, row) => sum + row.share, 0),
      color: OTHER_TYPE_COLOR,
    },
  ];
}

/**
 * A file's name and the tail of its folder, for a row that must stay short:
 * `C:\repo\apps\desktop\src\App.vue` reads `App.vue` in `…/desktop/src`.
 */
export function splitFilePath(path: string, folderDepth = 2): { name: string; folder: string } {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const name = parts.pop() ?? path;
  const tail = parts.slice(-folderDepth).join("/");
  return { name, folder: parts.length > folderDepth ? `…/${tail}` : tail };
}
