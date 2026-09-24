import assert from "node:assert/strict";

const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const escapeCell = (value) =>
  String(value).replace(/[&<>|`\r\n]/g, (char) => `&#${char.charCodeAt(0)};`);
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

/** Artifacts are bounded data, never ready-to-post Markdown. */
export function validateBundleReport(report) {
  assert(report?.schemaVersion === 2, "Unsupported bundle report");
  for (const key of ["totalBundleSizeKb", "largestChunkKb", "initialLoadChunks"]) {
    const metric = report.metrics?.[key];
    assert(number(metric?.actual) && number(metric?.budget), `Invalid metric: ${key}`);
  }
  assert(
    Array.isArray(report.assets) && report.assets.length > 0 && report.assets.length <= 2000,
    "Invalid bundle inventory",
  );
  for (const asset of report.assets) {
    assert(typeof asset.file === "string" && asset.file.length <= 300, "Invalid asset name");
    assert(number(asset.bytes) && number(asset.gzipBytes), "Invalid asset size");
  }
  return report;
}

export function sizeDelta(actual, baseline) {
  const delta = actual - baseline;
  const signed = (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
  const percent =
    baseline > 0 ? `${signed((delta / baseline) * 100)}%` : baseline === actual ? "0.0%" : "new";
  return `${signed(delta)} KiB (${percent})`;
}

// Vite appends an 8-character content hash; strip it to pair base/head chunks.
export const chunkName = (file) => file.replace(/-[\w-]{8}(?=\.(?:js|css)$)/, "");

/** Per-chunk size changes, largest absolute change first; same-name chunks are summed. */
export function chunkChanges(report, baseline) {
  const totals = (assets) => {
    const map = new Map();
    for (const asset of assets) {
      const name = chunkName(asset.file);
      const entry = map.get(name) ?? { bytes: 0, gzipBytes: 0, files: 0 };
      entry.bytes += asset.bytes;
      entry.gzipBytes += asset.gzipBytes;
      entry.files++;
      map.set(name, entry);
    }
    return map;
  };
  const head = totals(report.assets),
    base = totals(baseline.assets);
  const changes = [];
  for (const name of new Set([...head.keys(), ...base.keys()])) {
    const after = head.get(name),
      before = base.get(name);
    const delta = (after?.bytes ?? 0) - (before?.bytes ?? 0);
    if (Math.abs(delta) < 52) continue; // below 0.05 KiB rounds to 0.0 in the table
    changes.push({
      name,
      files: Math.max(after?.files ?? 0, before?.files ?? 0),
      before: before?.bytes,
      after: after?.bytes,
      delta,
      gzipDelta: (after?.gzipBytes ?? 0) - (before?.gzipBytes ?? 0),
    });
  }
  return changes.sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name),
  );
}

function changeLines(report, baseline) {
  const changes = chunkChanges(report, baseline);
  if (!changes.length) return ["No chunk changed by 0.1 KiB or more.", ""];
  const signed = (bytes) => `${bytes > 0 ? "+" : ""}${(bytes / 1024).toFixed(1)}`;
  const size = (bytes) => (bytes === undefined ? "—" : (bytes / 1024).toFixed(1));
  const lines = [
    `**Changes vs base** · ${changes.length} ${changes.length === 1 ? "chunk" : "chunks"} changed, largest first (content hashes removed from names).`,
    "",
    "| Chunk | Base (KiB) | Head (KiB) | Δ (KiB) | Δ gzip (KiB) |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const change of changes.slice(0, 15)) {
    const label = `${escapeCell(change.name)}${change.files > 1 ? ` (${change.files} files)` : ""}${change.before === undefined ? " · new" : change.after === undefined ? " · removed" : ""}`;
    lines.push(
      `| ${label} | ${size(change.before)} | ${size(change.after)} | ${signed(change.delta)} | ${signed(change.gzipDelta)} |`,
    );
  }
  if (changes.length > 15) lines.push("", `${changes.length - 15} smaller chunk changes omitted.`);
  lines.push("");
  return lines;
}

export function renderBundleMarkdown(report, baseline) {
  validateBundleReport(report);
  if (baseline) validateBundleReport(baseline);
  const {
    totalBundleSizeKb: total,
    largestChunkKb: largest,
    initialLoadChunks: initial,
  } = report.metrics;
  const gzip = report.assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  const baseGzip = baseline?.assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  const exceeded = [total, largest, initial].filter(
    (metric) => metric.actual > metric.budget,
  ).length;
  const lines = [
    "## Bundle analysis",
    "",
    `**JS + CSS: ${total.actual.toFixed(1)} KiB**${baseline ? ` · **${sizeDelta(total.actual, baseline.metrics.totalBundleSizeKb.actual)}** vs base` : ""}`,
    `Gzipped: **${kib(gzip)}**${baseline ? ` · ${sizeDelta(gzip / 1024, baseGzip / 1024)} vs base` : ""} · ${report.assets.length} files · ${initial.actual} initial HTML assets.`,
    "",
    `${exceeded ? `${exceeded} advisory threshold${exceeded === 1 ? "" : "s"} exceeded.` : "All advisory thresholds met."} Sizes cover generated JS/CSS; gzip is the sum of individually compressed files.`,
    "",
    ...(baseline ? changeLines(report, baseline) : []),
    "<details>",
    "<summary>Bundle breakdown and advisory thresholds</summary>",
    "",
    "| Metric | Actual | Threshold |",
    "| --- | ---: | ---: |",
    `| Total JS + CSS | ${total.actual.toFixed(1)} KiB | ${total.budget} KiB |`,
    `| Largest chunk | ${largest.actual.toFixed(1)} KiB | ${largest.budget} KiB |`,
    `| Initial HTML JS/CSS assets | ${initial.actual} | ${initial.budget} |`,
    "",
    "Largest files by uncompressed size. Full data and treemap are retained in the run artifacts.",
    "",
    "| File | Size (KiB) | Gzipped (KiB) |",
    "| --- | ---: | ---: |",
  ];
  const assets = [...report.assets].sort(
    (a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file),
  );
  let shown = 0;
  let bytes = Buffer.byteLength(lines.join("\n"));
  for (const asset of assets) {
    const row = `| ${escapeCell(asset.file)} | ${(asset.bytes / 1024).toFixed(1)} | ${(asset.gzipBytes / 1024).toFixed(1)} |`;
    bytes += Buffer.byteLength(row) + 1;
    if (bytes > 48_000 || shown >= 25) break;
    lines.push(row);
    shown++;
  }
  if (shown < assets.length)
    lines.push("", `${assets.length - shown} additional files are listed in the run artifacts.`);
  lines.push("", "</details>", "");
  return lines.join("\n");
}
