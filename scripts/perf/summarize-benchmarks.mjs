import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectBenchmarkReport,
  FIXTURE_IDENTITY,
  HARNESS_IDENTITY,
  REPORT_SCHEMA_VERSION,
  renderMarkdown,
} from "./check-budgets.mjs";

/** Validate every declared suite before publishing an aggregate measurement. */
export function summarizeBenchmarks({
  criterionDir,
  budget,
  suites,
  benchmarkResult,
  downloadResult,
  contractResult,
  provenance = {},
  inputErrors = [],
}) {
  const errors = [...inputErrors];
  let expectedSuites = [];
  try {
    assert(Array.isArray(suites) && suites.length, "Missing declared benchmark suite inventory");
    assert(
      suites.every((suite) => typeof suite === "string" && /^[A-Za-z0-9_-]+$/.test(suite)),
      "Invalid benchmark suite name",
    );
    assert.equal(new Set(suites).size, suites.length, "Duplicate benchmark suite name");
    expectedSuites = suites;
  } catch (error) {
    errors.push(error.message);
  }
  for (const [label, result] of [
    ["Benchmark matrix", benchmarkResult],
    ["Suite artifact download", downloadResult],
    ["Reporting contract tests", contractResult],
  ]) {
    if (result !== "success")
      errors.push(`${label} did not succeed (result: ${result || "missing"}).`);
  }

  const suiteResults = expectedSuites.map((name) => {
    const result = { name, outcome: null, rustcVersion: null };
    for (const [field, suffix] of [
      ["outcome", "outcome"],
      ["rustcVersion", "rustc-version"],
    ]) {
      try {
        result[field] = readFileSync(join(criterionDir, `${name}-${suffix}.txt`), "utf8").trim();
      } catch (error) {
        errors.push(`Suite ${name} is missing ${suffix} evidence: ${error.message}`);
      }
    }
    if (result.outcome !== "success") {
      errors.push(
        `Suite ${name} did not finish successfully (outcome: ${result.outcome || "missing"}).`,
      );
    }
    if (!/^rustc \d+\.\d+\.\d+[^\r\n]*$/.test(result.rustcVersion ?? "")) {
      errors.push(`Suite ${name} has missing or invalid Rust toolchain provenance.`);
      result.rustcVersion = null;
    }
    return result;
  });

  try {
    const unexpected = readdirSync(criterionDir).filter((file) => {
      const suite = file.match(/^(.*)-(?:rustc-version|outcome)\.txt$/)?.[1];
      return suite !== undefined && !expectedSuites.includes(suite);
    });
    if (unexpected.length) errors.push(`Unexpected suite evidence: ${unexpected.join(", ")}.`);
  } catch (error) {
    errors.push(`Cannot read suite artifact directory: ${error.message}`);
  }
  const versions = [...new Set(suiteResults.map((suite) => suite.rustcVersion).filter(Boolean))];
  if (versions.length > 1) errors.push("Benchmark suites used different Rust toolchains.");
  const measuredProvenance = {
    ...provenance,
    rustcVersion: versions.length === 1 ? versions[0] : null,
  };

  let report;
  try {
    report = collectBenchmarkReport({ criterionDir, budget, provenance: measuredProvenance });
  } catch (error) {
    errors.push(`Required benchmark contract failed: ${error.message}`);
    report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      metadata: {
        fixtureIdentity: FIXTURE_IDENTITY,
        harnessIdentity: HARNESS_IDENTITY,
        provenance: measuredProvenance,
      },
      benchmarks: [],
    };
  }
  return {
    ...report,
    status: errors.length ? "incomplete" : "complete",
    suites: suiteResults,
    errors,
  };
}

function markdownCell(value) {
  return String(value ?? "missing")
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/g, " ");
}

export function renderSummary(report) {
  const lines = [
    "## Nightly benchmark validation",
    "",
    report.status === "complete"
      ? "All declared suites and required measurement contracts passed. Timing budgets remain advisory."
      : "**INCOMPLETE — this run failed validation. These partial results are diagnostic and cannot be treated as a successful baseline.**",
    "",
    "| Suite | Cargo benchmark outcome | Recorded compiler |",
    "| --- | --- | --- |",
    ...report.suites.map(
      (suite) =>
        `| ${markdownCell(suite.name)} | ${markdownCell(suite.outcome)} | ${markdownCell(suite.rustcVersion)} |`,
    ),
    "",
  ];
  if (report.errors.length) {
    lines.push(
      "Validation failures:",
      "",
      ...report.errors.map((error) => `- ${markdownCell(error)}`),
      "",
    );
  }
  if (report.benchmarks.length) {
    lines.push(renderMarkdown(report));
  } else {
    lines.push("Required benchmark estimates could not be validated.", "");
  }
  lines.push(
    "Raw estimates, HTML reports, compiler evidence, outcomes and Cargo logs are retained in the individual `criterion-suite-*` artifacts when available.",
    "",
  );
  return lines.join("\n");
}

export function run(args = process.argv.slice(2), env = process.env) {
  const options = Object.fromEntries(
    args.map((arg) => {
      assert(arg.startsWith("--") && arg.includes("="), `Expected --key=value: ${arg}`);
      const separator = arg.indexOf("=");
      return [arg.slice(2, separator), arg.slice(separator + 1)];
    }),
  );
  const inputErrors = [];
  let suites;
  let budget;
  try {
    suites = JSON.parse(env.BENCHMARK_SUITES ?? "");
  } catch (error) {
    inputErrors.push(`Cannot read declared benchmark suite inventory: ${error.message}`);
  }
  try {
    budget = JSON.parse(readFileSync(resolve(options.budget ?? "perf-budget.json"), "utf8"));
  } catch (error) {
    inputErrors.push(`Cannot read performance budget: ${error.message}`);
  }
  const ciFields = {
    githubSha: env.GITHUB_SHA ?? null,
    githubRunId: env.GITHUB_RUN_ID ?? null,
    githubEventName: env.GITHUB_EVENT_NAME ?? null,
    runnerOs: env.RUNNER_OS ?? null,
    runnerArch: env.RUNNER_ARCH ?? null,
  };
  if (env.GITHUB_ACTIONS === "true") {
    for (const [key, value] of Object.entries(ciFields)) {
      if (!value) inputErrors.push(`Missing required CI provenance: ${key}`);
    }
  }
  const report = summarizeBenchmarks({
    criterionDir: resolve(options.criterion ?? "target/criterion"),
    budget,
    suites,
    benchmarkResult: env.BENCHMARK_RESULT,
    downloadResult: env.BENCHMARK_DOWNLOAD_RESULT,
    contractResult: env.BENCHMARK_CONTRACT_RESULT,
    provenance: { ...ciFields, nodeVersion: process.version, rustProfile: "bench" },
    inputErrors,
  });
  const summary = renderSummary(report);
  for (const [path, text] of [
    [options.output ?? "benchmark-output.json", `${JSON.stringify(report, null, 2)}\n`],
    [options.summary ?? "benchmark-summary.md", summary],
    [options.log ?? "benchmark-contract.log", summary],
  ]) {
    const outputPath = resolve(path);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, text);
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = run();
    console.log(renderSummary(report));
    if (report.status !== "complete") {
      for (const error of report.errors)
        console.error(`::error::${error.replace(/[\r\n]+/g, " ")}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`::error::${error.stack ?? error}`);
    process.exitCode = 1;
  }
}
