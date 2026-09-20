import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPORT_SCHEMA_VERSION = 2;
export const FIXTURE_IDENTITY = "v2-nonempty-fixtures";
export const HARNESS_IDENTITY = "criterion-mean-v2";

export const REQUIRED_BENCHMARKS = Object.freeze({
  parseTypedEvents1000Ns: {
    benchmark: "parse_typed_events/1000",
    budgetUnit: "ns",
  },
  computeAnalytics100SessionsNs: {
    benchmark: "compute_analytics/100",
    budgetUnit: "ns",
  },
  searchContent100SessionsMs: {
    benchmark: "ipc_search_content/fts_common_term/100",
    budgetUnit: "ms",
  },
});

function finitePositive(value, label) {
  assert(
    typeof value === "number" && Number.isFinite(value) && value > 0,
    `${label} must be a finite positive number`,
  );
  return value;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path}: ${error.message}`);
  }
}

function convertNanoseconds(value, unit) {
  if (unit === "ns") return value;
  if (unit === "ms") return value / 1_000_000;
  throw new Error(`Unsupported budget unit: ${unit}`);
}

export function collectBenchmarkReport({ criterionDir, budget, provenance = {} }) {
  assert(
    budget && typeof budget === "object" && !Array.isArray(budget),
    "Performance budget must be an object",
  );
  assert(
    budget.rust && typeof budget.rust === "object" && !Array.isArray(budget.rust),
    "Missing rust performance budgets",
  );

  const declaredKeys = Object.keys(budget.rust).filter((key) => key !== "notes");
  const unknownKeys = declaredKeys.filter((key) => !Object.hasOwn(REQUIRED_BENCHMARKS, key));
  assert.equal(unknownKeys.length, 0, `Unknown rust budget key(s): ${unknownKeys.join(", ")}`);

  const missingBudgetKeys = Object.keys(REQUIRED_BENCHMARKS).filter((key) => !(key in budget.rust));
  assert.equal(
    missingBudgetKeys.length,
    0,
    `Missing required rust budget key(s): ${missingBudgetKeys.join(", ")}`,
  );

  const benchmarks = Object.entries(REQUIRED_BENCHMARKS).map(([budgetKey, definition]) => {
    const estimatesPath = join(
      criterionDir,
      ...definition.benchmark.split("/"),
      "new",
      "estimates.json",
    );
    const estimates = readJson(estimatesPath, `required benchmark ${definition.benchmark}`);
    const pointEstimateNs = finitePositive(
      estimates?.mean?.point_estimate,
      `${definition.benchmark} mean point estimate`,
    );
    const lowerBoundNs = finitePositive(
      estimates?.mean?.confidence_interval?.lower_bound,
      `${definition.benchmark} mean confidence lower bound`,
    );
    const upperBoundNs = finitePositive(
      estimates?.mean?.confidence_interval?.upper_bound,
      `${definition.benchmark} mean confidence upper bound`,
    );
    const confidenceLevel = finitePositive(
      estimates?.mean?.confidence_interval?.confidence_level,
      `${definition.benchmark} mean confidence level`,
    );
    assert(confidenceLevel < 1, `${definition.benchmark} mean confidence level must be below 1`);
    assert(
      lowerBoundNs <= pointEstimateNs && pointEstimateNs <= upperBoundNs,
      `${definition.benchmark} mean point estimate must be inside its confidence interval`,
    );

    const budgetValue = finitePositive(budget.rust[budgetKey], `rust.${budgetKey}`);
    const actualInBudgetUnit = convertNanoseconds(pointEstimateNs, definition.budgetUnit);
    return {
      name: definition.benchmark,
      unit: "ns/iter",
      mean: {
        pointEstimate: pointEstimateNs,
        confidenceInterval: {
          confidenceLevel,
          lowerBound: lowerBoundNs,
          upperBound: upperBoundNs,
        },
      },
      budget: {
        key: budgetKey,
        value: budgetValue,
        unit: definition.budgetUnit,
        actual: actualInBudgetUnit,
        enforcement: "advisory",
        status: actualInBudgetUnit <= budgetValue ? "within" : "advisory-exceeded",
      },
    };
  });

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    metadata: {
      fixtureIdentity: FIXTURE_IDENTITY,
      harnessIdentity: HARNESS_IDENTITY,
      estimator: "Criterion mean point estimate",
      sourceUnit: "nanoseconds per iteration",
      workload: "synthetic fixtures",
      provenance,
    },
    benchmarks,
  };
}

function formatNs(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(3)} ms`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(3)} µs`;
  return `${value.toFixed(1)} ns`;
}

export function renderMarkdown(report) {
  const lines = [
    "## Rust benchmark results",
    "",
    `Fixture: \`${report.metadata.fixtureIdentity}\`; harness: \`${report.metadata.harnessIdentity}\`.`,
    "",
    "Criterion mean estimates and their reported confidence intervals are shown below. Timing budgets are advisory on shared runners; missing or invalid required results fail the job.",
    "",
    "| Benchmark | Mean | Confidence interval | Advisory budget | Status |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const result of report.benchmarks) {
    const ci = result.mean.confidenceInterval;
    const confidenceLabel = `${(ci.confidenceLevel * 100).toFixed(1)}%`;
    const budget = `${result.budget.value} ${result.budget.unit}`;
    const status = result.budget.status === "within" ? "within" : "exceeded (advisory)";
    lines.push(
      `| \`${result.name}\` | ${formatNs(result.mean.pointEstimate)} | ${confidenceLabel}: ${formatNs(ci.lowerBound)}–${formatNs(ci.upperBound)} | ${budget} | ${status} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseOptions(args) {
  const options = Object.fromEntries(
    args.map((arg) => {
      assert(arg.startsWith("--") && arg.includes("="), `Expected --key=value: ${arg}`);
      const separator = arg.indexOf("=");
      return [arg.slice(2, separator), arg.slice(separator + 1)];
    }),
  );
  return {
    criterionDir: resolve(options.criterion ?? "target/criterion"),
    budgetPath: resolve(options.budget ?? "perf-budget.json"),
    outputPath: resolve(options.output ?? "benchmark-output.json"),
    summaryPath: resolve(options.summary ?? "benchmark-summary.md"),
  };
}

export function run(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const budget = readJson(options.budgetPath, "performance budget");
  const ciFields = {
    githubSha: process.env.GITHUB_SHA ?? null,
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
    githubEventName: process.env.GITHUB_EVENT_NAME ?? null,
    runnerOs: process.env.RUNNER_OS ?? null,
    runnerArch: process.env.RUNNER_ARCH ?? null,
  };
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const [key, value] of Object.entries(ciFields)) {
      assert(value, `Missing required CI provenance: ${key}`);
    }
  }
  const provenance = {
    ...ciFields,
    nodeVersion: process.version,
    rustcVersion: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
    rustProfile: "bench",
  };
  const report = collectBenchmarkReport({
    criterionDir: options.criterionDir,
    budget,
    provenance,
  });
  mkdirSync(dirname(options.outputPath), { recursive: true });
  mkdirSync(dirname(options.summaryPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(options.summaryPath, renderMarkdown(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = run();
    console.log(renderMarkdown(report));
  } catch (error) {
    console.error(`::error::${error.stack ?? error}`);
    process.exitCode = 1;
  }
}
