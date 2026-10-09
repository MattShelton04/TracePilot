import {
  claudeCodeModelFamily,
  resolveSessionSource,
  type SessionSource,
  sourceLabel,
} from "@tracepilot/types";

/** The model a row's id names: the registry family for Claude Code ids. */
export function modelFamily(model: string, source: SessionSource): string {
  return source === "claudeCode" ? (claudeCodeModelFamily(model) ?? model) : model;
}

export interface ModelLabel {
  family: string;
  label: string;
}

/**
 * Display names for a per-source model list, shared by the Models page and
 * the Analytics dashboard so both name a model the same way.
 *
 * Claude Code ids name the same models as Copilot's (`claude-opus-4-5-…` is
 * `claude-opus-4.5`), so both sources line up. Two ids of one family in one
 * source keep their own ids; a family in two sources names its source.
 */
export function modelLabels(
  entries: ReadonlyArray<{ model: string; source?: SessionSource }>,
): ModelLabel[] {
  const sources = entries.map((m) => resolveSessionSource(m.source));
  const families = entries.map((m, i) => modelFamily(m.model, sources[i]));
  const count = (family: string, sameSource?: SessionSource) =>
    families.filter((f, j) => f === family && (sameSource == null || sources[j] === sameSource))
      .length;
  return entries.map((m, i) => {
    const family = families[i];
    const source = sources[i];
    const base = count(family, source) > 1 ? m.model : family;
    const label = count(family) > count(family, source) ? `${base} · ${sourceLabel(source)}` : base;
    return { family, label };
  });
}
