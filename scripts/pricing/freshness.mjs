import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import { fetchUpstream } from "./remote.mjs";
import { requireDate, sha256 } from "./source.mjs";

function rows(text, table) {
  const values = parse(text, { uniqueKeys: true });
  if (!Array.isArray(values) || !values.length) throw new Error(`Invalid ${table} source table`);
  const result = new Map();
  for (const row of values) {
    if (!row || typeof row.model !== "string" || !row.model.trim())
      throw new Error(`Invalid ${table} model`);
    const required = table === "usage" ? ["input", "cached_input", "output"] : ["new_multiplier"];
    for (const field of required) {
      if (!/^\$?\d+(\.\d+)?$/.test(String(row[field])))
        throw new Error(`Invalid ${table} ${field}`);
    }
    const key =
      table === "usage" ? `${row.model.trim()} / ${row.tier ?? "Default"}` : row.model.trim();
    if (result.has(key)) throw new Error(`Duplicate ${table} row: ${key}`);
    const normalized = Object.fromEntries(
      Object.entries(row)
        .filter(([field]) => !["release_status", "category"].includes(field))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([field, value]) => {
          if (!["string", "number"].includes(typeof value))
            throw new Error(`Unrecognized ${table} ${field}`);
          if (
            ["input", "cached_input", "cache_write", "output", "new_multiplier"].includes(field) &&
            /^\$?\d+(\.\d+)?$/.test(String(value))
          ) {
            return [field, Number(String(value).replace(/^\$/, ""))];
          }
          return [field, typeof value === "string" ? value.trim() : value];
        }),
    );
    result.set(key, normalized);
  }
  return result;
}

export function compareSources(local, upstream, checkedAt) {
  requireDate(checkedAt);
  const changes = [];
  const compare = (table, before, after) => {
    for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      if (isDeepStrictEqual(before.get(key), after.get(key))) continue;
      const old = before.get(key);
      const next = after.get(key);
      const fields = [...new Set([...Object.keys(old ?? {}), ...Object.keys(next ?? {})])]
        .filter((field) => !isDeepStrictEqual(old?.[field], next?.[field]))
        .sort();
      const describe = (row) =>
        row ? fields.map((field) => `${field}: ${row[field] ?? "absent"}`).join("; ") : "absent";
      changes.push({
        table,
        key,
        kind: !old ? "added" : !next ? "removed" : "changed",
        before: describe(old),
        after: describe(next),
      });
    }
  };
  for (const table of ["usage", "annual"]) {
    if (sha256(local.sources[table]) !== local.snapshot.sha256[table])
      throw new Error(`Saved ${table} source hash mismatch`);
    compare(table, rows(local.sources[table], table), rows(upstream.sources[table], table));
  }
  const footnotes = (snapshot) =>
    new Map(Object.entries(snapshot.footnotes).map(([key, text]) => [key, { text }]));
  compare("footnotes", footnotes(local.snapshot), footnotes(upstream.snapshot));
  for (const [key, note] of Object.entries(local.policy.footnotes)) {
    requireDate(note.effectiveTo);
    if (checkedAt >= note.effectiveTo && local.sources.usage.includes(`[^${key}]`)) {
      changes.push({
        table: "expiry",
        key,
        kind: "changed",
        before: `Valid before ${note.effectiveTo}`,
        after: "Saved promotional rate has expired; verify replacement rates",
      });
    }
  }
  return changes;
}

export async function checkFreshness(local, options = {}) {
  const checkedAt = options.verifiedAt ?? new Date().toISOString().slice(0, 10);
  const report = {
    version: 1,
    checkedAt,
    snapshotRevision: local.snapshot.revision,
    snapshotDate: local.snapshot.verifiedAt,
    status: "unavailable",
    changes: [],
  };
  try {
    const upstream = await fetchUpstream({ ...options, verifiedAt: checkedAt });
    report.upstreamRevision = upstream.snapshot.revision;
    report.changes = compareSources(local, upstream, checkedAt);
    report.status = report.changes.length ? "outdated" : "current";
  } catch (error) {
    report.error = `Could not verify current Copilot pricing: ${error.message}`;
  }
  return report;
}
