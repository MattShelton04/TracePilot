/**
 * Summarise a same-runner Criterion A/B comparison.
 *
 * CI runs the pull request's base revision with `--save-baseline <name>` and
 * then the head revision with `--baseline-lenient <name>` into the same target
 * directory. Criterion then writes `change/estimates.json` for every benchmark
 * that exists in both runs: the relative change of the mean with a confidence
 * interval. Comparing on one machine, minutes apart, removes most of the
 * runner-to-runner variance that makes absolute timings on shared runners
 * unusable as a regression signal.
 *
 * A benchmark is reported as a regression (or improvement) only when the
 * whole confidence interval lies beyond the threshold; everything else is
 * "unchanged" or, when the interval straddles the threshold, "inconclusive".
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_THRESHOLD = 0.1;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Find every benchmark directory that has a `change/estimates.json`. */
export function findComparedBenchmarks(criterionDir) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "report") continue;
      const path = join(dir, entry.name);
      if (entry.name === "change") {
        if (existsSync(join(path, "estimates.json"))) found.push(dir);
        continue;
      }
      walk(path);
    }
  };
  if (existsSync(criterionDir)) walk(criterionDir);
  return found.sort();
}

export function classify(change, threshold = DEFAULT_THRESHOLD) {
  const { lower, upper } = change;
  if (lower > threshold) return "regression";
  if (upper < -threshold) return "improvement";
  if (upper < threshold && lower > -threshold) return "unchanged";
  return "inconclusive";
}

/**
 * Build the comparison from a Criterion directory. `baseline` names the
 * saved baseline directory holding the base revision's absolute estimates.
 */
export function collectComparison({ criterionDir, baseline, threshold = DEFAULT_THRESHOLD }) {
  assert(Number.isFinite(threshold) && threshold > 0, "threshold must be positive");
  const rows = findComparedBenchmarks(criterionDir).map((dir) => {
    const change = readJson(join(dir, "change", "estimates.json")).mean;
    const head = readJson(join(dir, "new", "estimates.json")).mean.point_estimate;
    const basePath = join(dir, baseline, "estimates.json");
    const base = existsSync(basePath) ? readJson(basePath).mean.point_estimate : null;
    const ci = change.confidence_interval;
    const delta = {
      point: change.point_estimate,
      lower: ci.lower_bound,
      upper: ci.upper_bound,
    };
    for (const [key, value] of Object.entries(delta)) {
      assert(Number.isFinite(value), `${dir}: change.${key} must be finite`);
    }
    return {
      name: relative(criterionDir, dir).split(sep).join("/"),
      baseNs: base,
      headNs: head,
      change: delta,
      verdict: classify(delta, threshold),
    };
  });
  const count = (verdict) => rows.filter((row) => row.verdict === verdict).length;
  return {
    threshold,
    baseline,
    totals: {
      compared: rows.length,
      regression: count("regression"),
      improvement: count("improvement"),
      unchanged: count("unchanged"),
      inconclusive: count("inconclusive"),
    },
    rows,
  };
}

function formatNs(value) {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} ms`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} µs`;
  return `${value.toFixed(0)} ns`;
}

const pct = (value) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

const ICON = { regression: "🔴", improvement: "🟢", unchanged: "⚪", inconclusive: "🟡" };

export function renderMarkdown(report) {
  const { totals, threshold } = report;
  const lines = [
    "## Rust benchmarks: base vs head (same runner)",
    "",
    `Compared ${totals.compared} benchmarks. Regressions: **${totals.regression}**, improvements: ${totals.improvement}, inconclusive: ${totals.inconclusive}.`,
    `A verdict requires the whole confidence interval of the mean change to lie beyond ±${(threshold * 100).toFixed(0)}%. Advisory: shared-runner timings do not fail the job.`,
    "",
  ];
  if (report.rows.length === 0) {
    lines.push("No benchmark had a base result to compare against.");
    return `${lines.join("\n")}\n`;
  }
  lines.push("| | Benchmark | Base | Head | Change [CI] |", "| --- | --- | ---: | ---: | ---: |");
  const order = { regression: 0, improvement: 1, inconclusive: 2, unchanged: 3 };
  const rows = [...report.rows].sort(
    (a, b) => order[a.verdict] - order[b.verdict] || b.change.point - a.change.point,
  );
  for (const row of rows) {
    lines.push(
      `| ${ICON[row.verdict]} | \`${row.name}\` | ${formatNs(row.baseNs)} | ${formatNs(row.headNs)} | ${pct(row.change.point)} [${pct(row.change.lower)}, ${pct(row.change.upper)}] |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseOptions(args) {
  const options = Object.fromEntries(
    args.map((arg) => {
      assert(arg.startsWith("--") && arg.includes("="), `Expected --key=value: ${arg}`);
      const at = arg.indexOf("=");
      return [arg.slice(2, at), arg.slice(at + 1)];
    }),
  );
  return {
    criterionDir: resolve(options.criterion ?? "target/criterion"),
    baseline: options.baseline ?? "pr-base",
    threshold: Number(options.threshold ?? DEFAULT_THRESHOLD),
    outputPath: resolve(options.output ?? "benchmark-compare.json"),
    summaryPath: resolve(options.summary ?? "benchmark-compare.md"),
  };
}

export function run(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const report = collectComparison(options);
  for (const path of [options.outputPath, options.summaryPath]) {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(options.summaryPath, renderMarkdown(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = run();
    console.log(renderMarkdown(report));
    for (const row of report.rows.filter((r) => r.verdict === "regression")) {
      console.log(
        `::warning title=Benchmark regression::${row.name} ${pct(row.change.point)} [${pct(row.change.lower)}, ${pct(row.change.upper)}]`,
      );
    }
  } catch (error) {
    console.error(`::error::${error.stack ?? error}`);
    process.exitCode = 1;
  }
}
