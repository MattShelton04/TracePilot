import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collectBenchmarkReport, REQUIRED_BENCHMARKS } from "./check-budgets.mjs";
import { renderSummary, run, summarizeBenchmarks } from "./summarize-benchmarks.mjs";

const BUDGET = {
  rust: {
    parseTypedEvents1000Ns: 5_000_000,
    computeAnalytics100SessionsNs: 10_000_000,
    searchContent100SessionsMs: 200,
  },
};
const COMPILER = "rustc 1.99.0 (b940084d7 2026-09-28)";

function fixture(context, suites = ["parsing", "analytics", "ipc_hot_path"]) {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-benchmark-summary-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const suite of suites) {
    writeFileSync(join(root, `${suite}-outcome.txt`), "success\n");
    writeFileSync(join(root, `${suite}-rustc-version.txt`), `${COMPILER}\n`);
  }
  for (const { benchmark } of Object.values(REQUIRED_BENCHMARKS)) {
    const directory = join(root, ...benchmark.split("/"), "new");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "estimates.json"),
      JSON.stringify({
        mean: {
          point_estimate: 2_000_000,
          confidence_interval: {
            confidence_level: 0.95,
            lower_bound: 1_800_000,
            upper_bound: 2_200_000,
          },
        },
      }),
    );
  }
  return {
    criterionDir: root,
    budget: BUDGET,
    suites,
    benchmarkResult: "success",
    downloadResult: "success",
    contractResult: "success",
  };
}

test("complete aggregate preserves the existing budget report schema and any declared suite count", (t) => {
  const input = fixture(t, [
    "parsing",
    "analytics",
    "indexer",
    "batch_size",
    "ipc_hot_path",
    "extra",
  ]);
  const report = summarizeBenchmarks(input);
  assert.equal(report.status, "complete");
  assert.deepEqual(report.errors, []);
  assert.equal(report.suites.length, 6);
  const original = collectBenchmarkReport({
    ...input,
    provenance: { rustcVersion: COMPILER },
  });
  assert.equal(report.schemaVersion, original.schemaVersion);
  assert.deepEqual(report.metadata, original.metadata);
  assert.deepEqual(report.benchmarks, original.benchmarks);
});

test("a failed non-required suite retains valid measurements but can never publish success", (t) => {
  const input = fixture(t, ["parsing", "analytics", "ipc_hot_path", "batch_size"]);
  writeFileSync(join(input.criterionDir, "batch_size-outcome.txt"), "failure\n");
  const report = summarizeBenchmarks({ ...input, benchmarkResult: "failure" });
  assert.equal(report.status, "incomplete");
  assert.equal(report.benchmarks.length, 3);
  assert(
    report.errors.some((error) => error.includes("Suite batch_size did not finish successfully")),
  );
  const summary = renderSummary(report);
  assert.match(summary, /INCOMPLETE/);
  assert.match(summary, /cannot be treated as a successful baseline/);
  assert.match(summary, /batch_size \| failure/);
  assert.match(summary, /Rust benchmark results/);
});

test("matrix, download or reporting-test failures stay fatal even with complete valid artifacts", (t) => {
  const input = fixture(t);
  for (const field of ["benchmarkResult", "downloadResult", "contractResult"]) {
    const report = summarizeBenchmarks({ ...input, [field]: "failure" });
    assert.equal(report.status, "incomplete", field);
    assert.equal(report.benchmarks.length, 3);
    assert.equal(report.errors.length, 1);
  }
});

test("missing suite evidence cannot be hidden by other suites' valid budget measurements", (t) => {
  const input = fixture(t);
  rmSync(join(input.criterionDir, "analytics-outcome.txt"));
  rmSync(join(input.criterionDir, "analytics-rustc-version.txt"));
  const report = summarizeBenchmarks(input);
  assert.equal(report.status, "incomplete");
  assert(
    report.errors.some((error) => error.includes("Suite analytics is missing outcome evidence")),
  );
  assert(
    report.errors.some((error) =>
      error.includes("Suite analytics is missing rustc-version evidence"),
    ),
  );
});

test("different, empty and malformed recorded compilers fail provenance validation", (t) => {
  const input = fixture(t);
  for (const compiler of ["rustc 1.98.0 (other)", "", "unavailable", `${COMPILER}\nextra`]) {
    writeFileSync(join(input.criterionDir, "analytics-rustc-version.txt"), compiler);
    const report = summarizeBenchmarks(input);
    assert.equal(report.status, "incomplete", compiler);
    assert(report.errors.some((error) => /toolchain/.test(error)));
  }
});

test("unexpected suite evidence and invalid inventories fail explicitly", (t) => {
  const input = fixture(t);
  writeFileSync(join(input.criterionDir, "old-rustc-version.txt"), COMPILER);
  assert.match(summarizeBenchmarks(input).errors.join("\n"), /Unexpected suite evidence/);
  rmSync(join(input.criterionDir, "old-rustc-version.txt"));
  for (const suites of [undefined, [], ["../escape"], ["parsing", "parsing"]]) {
    const report = summarizeBenchmarks({ ...input, suites });
    assert.equal(report.status, "incomplete");
    assert.match(report.errors.join("\n"), /inventory|suite name/);
  }
});

test("missing or malformed required estimates produce an explicit diagnostic report", (t) => {
  const input = fixture(t);
  const estimate = join(input.criterionDir, "parse_typed_events", "1000", "new", "estimates.json");
  rmSync(estimate);
  let report = summarizeBenchmarks(input);
  assert.equal(report.status, "incomplete");
  assert.match(report.errors.join("\n"), /required benchmark parse_typed_events\/1000/);
  writeFileSync(estimate, '{"mean":{"point_estimate":0}}');
  report = summarizeBenchmarks(input);
  assert.equal(report.status, "incomplete");
  assert.match(report.errors.join("\n"), /finite positive number/);
});

test("summary command always writes partial diagnostics and the job summary on missing downloads", (t) => {
  const input = fixture(t);
  const budgetPath = join(input.criterionDir, "budget.json");
  const outputPath = join(input.criterionDir, "summary.json");
  const summaryPath = join(input.criterionDir, "summary.md");
  const logPath = join(input.criterionDir, "summary.log");
  const jobSummaryPath = join(input.criterionDir, "job-summary.md");
  writeFileSync(budgetPath, JSON.stringify(BUDGET));
  const report = run(
    [
      `--criterion=${join(input.criterionDir, "missing-download")}`,
      `--budget=${budgetPath}`,
      `--output=${outputPath}`,
      `--summary=${summaryPath}`,
      `--log=${logPath}`,
    ],
    {
      BENCHMARK_SUITES: JSON.stringify(input.suites),
      BENCHMARK_RESULT: "failure",
      BENCHMARK_DOWNLOAD_RESULT: "failure",
      BENCHMARK_CONTRACT_RESULT: "success",
      GITHUB_STEP_SUMMARY: jobSummaryPath,
    },
  );
  assert.equal(report.status, "incomplete");
  assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).status, "incomplete");
  for (const path of [summaryPath, logPath, jobSummaryPath]) {
    assert.match(readFileSync(path, "utf8"), /Suite artifact download did not succeed/);
    assert.match(readFileSync(path, "utf8"), /INCOMPLETE/);
  }
});

test("CLI fails while retaining diagnostic artifacts when preparation or budget inputs are missing", (t) => {
  const input = fixture(t);
  const script = fileURLToPath(new URL("./summarize-benchmarks.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    cwd: input.criterionDir,
    env: { ...process.env, BENCHMARK_SUITES: "", GITHUB_STEP_SUMMARY: "" },
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot read declared benchmark suite inventory/);
  assert.match(result.stderr, /Cannot read performance budget/);
  const report = JSON.parse(
    readFileSync(join(input.criterionDir, "benchmark-output.json"), "utf8"),
  );
  assert.equal(report.status, "incomplete");
  assert.match(
    readFileSync(join(input.criterionDir, "benchmark-summary.md"), "utf8"),
    /INCOMPLETE/,
  );
});
