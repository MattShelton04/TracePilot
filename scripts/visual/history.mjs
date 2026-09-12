/** The Pages tree can contain older reports. Accept bounded display data only. */
export function historyEntry(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.id) ||
    value.id < 1 ||
    !/^[a-f0-9]{40}$/.test(value.sha) ||
    (value.pr != null && (!Number.isSafeInteger(value.pr) || value.pr < 1))
  )
    return null;
  const summary = {};
  for (const key of ["changed", "unchanged", "incomplete", "baseUnavailable", "total"])
    summary[key] = Number.isSafeInteger(value.summary?.[key])
      ? Math.min(128, Math.max(0, value.summary[key]))
      : 0;
  return {
    id: value.id,
    sha: value.sha,
    pr: value.pr ?? null,
    attempt: Number.isSafeInteger(value.attempt) && value.attempt > 0 ? value.attempt : 1,
    title: String(value.title ?? "Visual comparison").slice(0, 300),
    created:
      typeof value.created === "string" && Number.isFinite(Date.parse(value.created))
        ? new Date(value.created).toISOString()
        : "Unknown date",
    summary: value.summary && typeof value.summary === "object" ? summary : null,
    views: Array.isArray(value.views)
      ? [
          ...new Set(
            value.views.filter((id) => typeof id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(id)),
          ),
        ].slice(0, 128)
      : [],
  };
}

/** Choose bounded main/PR history without mutating the normalized input entries. */
export function retainedHistory(entries, currentId) {
  const ordered = [...entries].sort((a, b) => b.id - a.id);
  const current = ordered.find((entry) => entry.id === currentId);
  // Reserve one slot for an older rerun before selecting the newest other runs.
  // Its just-published URL must not be deleted by this publication's own pruning.
  const kept = current ? [current] : [];
  const counts = { main: current && !current.pr ? 1 : 0, pr: current?.pr ? 1 : 0 };
  for (const entry of ordered) {
    if (entry.id === current?.id) continue;
    const kind = entry.pr ? "pr" : "main";
    if (counts[kind] >= 20) continue;
    counts[kind]++;
    kept.push(entry);
  }
  return kept.sort((a, b) => b.id - a.id);
}
