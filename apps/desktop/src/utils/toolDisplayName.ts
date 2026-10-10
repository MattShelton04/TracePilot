import type { SessionSource, ToolUsageEntry } from "@tracepilot/types";

/**
 * Tool names on screen follow Conversation's rule: the source's native name
 * when the call recorded one (Claude Code's `Bash`), else the canonical name
 * (Copilot's `powershell`). Canonical names stay the filter and grouping key.
 */
export function toolDisplayName(call: {
  toolName: string;
  nativeToolName?: string | null;
}): string {
  return call.nativeToolName ?? call.toolName;
}

/** How to name an aggregate of one canonical tool, with an optional hint line. */
export interface ToolAggregateLabel {
  label: string;
  /** The other naming, shown as a secondary line or tooltip. */
  hint?: string;
}

/**
 * Names an aggregate of calls under one canonical tool. When every call has a
 * native name from one source, the native names lead and the canonical name
 * is the hint. When the aggregate mixes sources (or calls with no native
 * name), the canonical name leads and the native names are the hint.
 */
export function toolAggregateLabel(
  canonical: string,
  natives: ReadonlyArray<{ name: string; source?: SessionSource }>,
  hasCanonicalOnlyCalls: boolean,
): ToolAggregateLabel {
  const names = [...new Set(natives.map((native) => native.name))];
  if (!names.length) return { label: canonical };
  const sources = new Set(natives.map((native) => native.source));
  if (hasCanonicalOnlyCalls || sources.size > 1) {
    return { label: canonical, hint: names.join(", ") };
  }
  const label = names.join(", ");
  return label === canonical ? { label } : { label, hint: canonical };
}

/**
 * A search row's tool name: the native name its metadata records (Claude
 * Code rows), else the indexed canonical name.
 */
export function searchResultToolName(result: {
  toolName: string | null;
  metadataJson?: string | null;
}): string | null {
  if (!result.toolName || !result.metadataJson) return result.toolName;
  try {
    const native = (JSON.parse(result.metadataJson) as { nativeToolName?: unknown })
      ?.nativeToolName;
    return typeof native === "string" && native ? native : result.toolName;
  } catch {
    return result.toolName;
  }
}

/**
 * One label per aggregate in a list. A label two entries share (Claude Code's
 * `Write` is `create` for a new file and `apply_patch` over an existing one)
 * names its canonical tool too, so rows stay distinguishable.
 */
export function uniqueToolLabels(
  entries: ReadonlyArray<{ canonical: string; label: ToolAggregateLabel }>,
): string[] {
  const counts = new Map<string, number>();
  for (const { label } of entries) counts.set(label.label, (counts.get(label.label) ?? 0) + 1);
  return entries.map(({ canonical, label }) =>
    (counts.get(label.label) ?? 0) > 1 && label.label !== canonical
      ? `${label.label} (${canonical})`
      : label.label,
  );
}

/** The label of a context-window tool aggregate (one session, one source). */
export function contextToolTypeLabel(item: {
  toolName: string;
  nativeToolNames?: readonly string[] | null;
}): ToolAggregateLabel {
  return toolAggregateLabel(
    item.toolName,
    (item.nativeToolNames ?? []).map((name) => ({ name })),
    false,
  );
}

/** Calls of a Tools-page entry recorded under the canonical name only (Copilot's). */
export function canonicalOnlyCalls(tool: ToolUsageEntry): number {
  const native = (tool.nativeTools ?? []).reduce((sum, entry) => sum + entry.callCount, 0);
  return Math.max(tool.callCount - native, 0);
}

/** The label of a Tools-page entry, which can mix sources. */
export function toolUsageLabel(tool: ToolUsageEntry): ToolAggregateLabel {
  return toolAggregateLabel(tool.name, tool.nativeTools ?? [], canonicalOnlyCalls(tool) > 0);
}

/** One distinguishable display name per Tools-page entry. */
export function toolUsageNames(tools: readonly ToolUsageEntry[]): string[] {
  return uniqueToolLabels(
    tools.map((tool) => ({ canonical: tool.name, label: toolUsageLabel(tool) })),
  );
}
