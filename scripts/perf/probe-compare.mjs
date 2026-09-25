/**
 * Same-runner base/head comparison of backend phases with wall time and peak
 * memory, which Criterion does not measure.
 *
 * Runs `index_probe` builds of the base and head revisions against one
 * generated corpus. Each repetition executes the indexing pipeline a user
 * hits in practice: a fresh session index, a full search index, then
 * incremental search passes after a few sessions change. Variants alternate
 * in ABBA order so machine drift affects both equally. Reports medians of
 * wall time and the maximum peak RSS (Linux) per phase.
 *
 *   node scripts/perf/probe-compare.mjs --base=<exe> --head=<exe> \
 *     --sessions=<session-state-dir> --work=<scratch-dir> [--repeats=4]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Pipeline steps, run in order against one fresh database per repetition. */
export const PIPELINE = [
  { name: "session index (fresh)", args: ["phase1"] },
  { name: "search index (fresh)", args: ["phase2"] },
  { name: "incremental search, 10 small changed", args: ["phase2-stale", "10", "small"] },
  { name: "incremental search, 3 large changed", args: ["phase2-stale", "3"] },
  { name: "analytics disk-scan fallback", args: ["analytics-fallback"] },
];

export const DEFAULT_THRESHOLD = 0.15;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** ABBA ordering: base, head, head, base, base, head, ... */
export function variantOrder(repeats) {
  return Array.from({ length: repeats }, (_, i) =>
    i % 4 === 0 || i % 4 === 3 ? ["base", "head"] : ["head", "base"],
  ).flat();
}

export function parseProbeLine(stdout) {
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith("{"));
  assert(line, `probe produced no JSON result: ${stdout.slice(0, 200)}`);
  const parsed = JSON.parse(line);
  assert(Number.isFinite(parsed.elapsed_ms), "probe elapsed_ms must be finite");
  return parsed;
}

/** samples: [{ variant, step, elapsedMs, peakRssKib }] */
export function summarize(samples, threshold = DEFAULT_THRESHOLD) {
  return PIPELINE.map((step) => {
    const pick = (variant, key) =>
      samples.filter((s) => s.step === step.name && s.variant === variant).map((s) => s[key]);
    const stats = (variant) => {
      const elapsed = pick(variant, "elapsedMs");
      const rss = pick(variant, "peakRssKib").filter((v) => v != null);
      return {
        runs: elapsed.length,
        medianMs: elapsed.length ? median(elapsed) : null,
        peakRssMib: rss.length ? Math.max(...rss) / 1024 : null,
      };
    };
    const base = stats("base");
    const head = stats("head");
    const timeChange =
      base.medianMs && head.medianMs != null ? head.medianMs / base.medianMs - 1 : null;
    const rssChange =
      base.peakRssMib && head.peakRssMib != null ? head.peakRssMib / base.peakRssMib - 1 : null;
    const flag = (change) =>
      change == null
        ? "n/a"
        : change > threshold
          ? "regression"
          : change < -threshold
            ? "improvement"
            : "unchanged";
    return {
      step: step.name,
      base,
      head,
      timeChange,
      rssChange,
      time: flag(timeChange),
      memory: flag(rssChange),
    };
  });
}

const pct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const ms = (v) =>
  v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
const mib = (v) => (v == null ? "—" : `${Math.round(v)} MiB`);
const ICON = { regression: "🔴", improvement: "🟢", unchanged: "⚪", "n/a": "" };

export function renderMarkdown(rows, { repeats, corpus, threshold = DEFAULT_THRESHOLD }) {
  const lines = [
    "## Backend phases: base vs head (wall time and peak memory)",
    "",
    `${repeats} alternating runs per variant on ${corpus}. Median wall time; maximum peak RSS. Flags use a ±${Math.round(threshold * 100)}% band and are advisory.`,
    "",
    "| Phase | Base time | Head time | Δ time | Base peak | Head peak | Δ memory |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.step} | ${ms(r.base.medianMs)} | ${ms(r.head.medianMs)} | ${ICON[r.time]} ${pct(r.timeChange)} | ${mib(r.base.peakRssMib)} | ${mib(r.head.peakRssMib)} | ${ICON[r.memory]} ${pct(r.rssChange)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseOptions(args) {
  const o = Object.fromEntries(
    args.map((arg) => {
      assert(arg.startsWith("--") && arg.includes("="), `Expected --key=value: ${arg}`);
      const at = arg.indexOf("=");
      return [arg.slice(2, at), arg.slice(at + 1)];
    }),
  );
  assert(o.base && o.head && o.sessions && o.work, "Supply --base --head --sessions --work");
  return {
    base: resolve(o.base),
    head: resolve(o.head),
    sessions: resolve(o.sessions),
    work: resolve(o.work),
    repeats: Number(o.repeats ?? 4),
    corpus: o.corpus ?? "generated corpus",
    output: resolve(o.output ?? "probe-compare.json"),
    summary: resolve(o.summary ?? "probe-compare.md"),
  };
}

export function run(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  assert(Number.isInteger(options.repeats) && options.repeats > 0 && options.repeats <= 20);
  const samples = [];
  for (const [i, variant] of variantOrder(options.repeats).entries()) {
    const dbDir = join(options.work, `${variant}-${i}`);
    rmSync(dbDir, { recursive: true, force: true });
    mkdirSync(dbDir, { recursive: true });
    const db = join(dbDir, "index.db");
    for (const step of PIPELINE) {
      const stdout = execFileSync(
        options[variant],
        [step.args[0], options.sessions, db, ...step.args.slice(1)],
        {
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const result = parseProbeLine(stdout);
      samples.push({
        variant,
        step: step.name,
        elapsedMs: result.elapsed_ms,
        peakRssKib: result.peak_rss_kib ?? null,
      });
    }
    rmSync(dbDir, { recursive: true, force: true });
  }
  const rows = summarize(samples);
  for (const path of [options.output, options.summary])
    mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    options.output,
    `${JSON.stringify({ repeats: options.repeats, samples, rows }, null, 2)}\n`,
  );
  const markdown = renderMarkdown(rows, options);
  writeFileSync(options.summary, markdown);
  return { rows, markdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { rows, markdown } = run();
    console.log(markdown);
    for (const row of rows) {
      if (row.time === "regression")
        console.log(`::warning title=Backend time regression::${row.step} ${pct(row.timeChange)}`);
      if (row.memory === "regression")
        console.log(`::warning title=Backend memory regression::${row.step} ${pct(row.rssChange)}`);
    }
  } catch (error) {
    console.error(`::error::${error.stack ?? error}`);
    process.exitCode = 1;
  }
}
