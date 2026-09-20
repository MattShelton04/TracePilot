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
    "<details>",
    "<summary>Bundle breakdown and advisory thresholds</summary>",
    "",
    "| Metric | Actual | Threshold |",
    "| --- | ---: | ---: |",
    `| Total JS + CSS | ${total.actual.toFixed(1)} KiB | ${total.budget} KiB |`,
    `| Largest chunk | ${largest.actual.toFixed(1)} KiB | ${largest.budget} KiB |`,
    `| Initial HTML JS/CSS assets | ${initial.actual} | ${initial.budget} |`,
    "",
    "Files sorted by uncompressed size. Full data and treemap are retained in the run artifacts.",
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
    if (bytes > 48_000) break;
    lines.push(row);
    shown++;
  }
  if (shown < assets.length)
    lines.push("", `${assets.length - shown} additional files are listed in the run artifacts.`);
  lines.push("", "</details>", "");
  return lines.join("\n");
}
