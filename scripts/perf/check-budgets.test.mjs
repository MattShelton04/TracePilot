import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectBenchmarkReport, FIXTURE_IDENTITY } from "./check-budgets.mjs";

const BUDGET = {
  rust: {
    parseTypedEvents1000Ns: 5_000_000,
    computeAnalytics100SessionsNs: 10_000_000,
    searchContent100SessionsMs: 200,
  },
};

function writeEstimate(
  root,
  name,
  pointEstimate,
  lower = pointEstimate * 0.9,
  upper = pointEstimate * 1.1,
  confidenceLevel = 0.95,
) {
  const directory = join(root, ...name.split("/"), "new");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "estimates.json"),
    JSON.stringify({
      mean: {
        point_estimate: pointEstimate,
        confidence_interval: {
          confidence_level: confidenceLevel,
          lower_bound: lower,
          upper_bound: upper,
        },
      },
    }),
  );
}

function writeCompleteSet(root, overrides = {}) {
  writeEstimate(root, "parse_typed_events/1000", overrides.parse ?? 2_000_000);
  writeEstimate(root, "compute_analytics/100", overrides.analytics ?? 3_000_000);
  writeEstimate(root, "ipc_search_content/fts_common_term/100", overrides.search ?? 150_000_000);
}

test("missing required benchmark result is an error", (testContext) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-budget-"));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  writeEstimate(root, "parse_typed_events/1000", 2_000_000);
  writeEstimate(root, "compute_analytics/100", 3_000_000);

  assert.throws(
    () => collectBenchmarkReport({ criterionDir: root, budget: BUDGET }),
    /required benchmark ipc_search_content\/fts_common_term\/100/,
  );
});

test("invalid required benchmark result is an error", (testContext) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-budget-"));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  writeCompleteSet(root);
  writeEstimate(root, "compute_analytics/100", 0, 0, 0);

  assert.throws(
    () => collectBenchmarkReport({ criterionDir: root, budget: BUDGET }),
    /mean point estimate must be a finite positive number/,
  );
});

test("converts Criterion nanoseconds to each budget unit", (testContext) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-budget-"));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  writeCompleteSet(root, { search: 150_000_000 });

  const report = collectBenchmarkReport({ criterionDir: root, budget: BUDGET });
  const parse = report.benchmarks.find((result) => result.name === "parse_typed_events/1000");
  const search = report.benchmarks.find(
    (result) => result.name === "ipc_search_content/fts_common_term/100",
  );
  assert.equal(parse.budget.actual, 2_000_000);
  assert.equal(parse.budget.unit, "ns");
  assert.equal(search.budget.actual, 150);
  assert.equal(search.budget.unit, "ms");
});

test("rejects unknown rust budget keys", (testContext) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-budget-"));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  writeCompleteSet(root);

  assert.throws(
    () =>
      collectBenchmarkReport({
        criterionDir: root,
        budget: { rust: { ...BUDGET.rust, staleBudgetNs: 1 } },
      }),
    /Unknown rust budget key\(s\): staleBudgetNs/,
  );
});

test("reports an exceeded timing budget without failing the shared-runner check", (testContext) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-budget-"));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  writeCompleteSet(root, { parse: 6_000_000 });

  const report = collectBenchmarkReport({ criterionDir: root, budget: BUDGET });
  const parse = report.benchmarks.find((result) => result.name === "parse_typed_events/1000");
  assert.equal(parse.budget.status, "advisory-exceeded");
  assert.equal(parse.budget.enforcement, "advisory");
});

test("emits the corrected non-empty fixture identity", (testContext) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-budget-"));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  writeCompleteSet(root);

  const provenance = {
    githubSha: "abc123",
    githubRunId: "456",
    githubEventName: "schedule",
    runnerOs: "Linux",
    runnerArch: "X64",
    nodeVersion: "v22.0.0",
    rustcVersion: "rustc 1.90.0",
    rustProfile: "bench",
  };
  const report = collectBenchmarkReport({ criterionDir: root, budget: BUDGET, provenance });
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.metadata.fixtureIdentity, FIXTURE_IDENTITY);
  assert.equal(report.metadata.fixtureIdentity, "v2-nonempty-fixtures");
  assert.deepEqual(report.metadata.provenance, provenance);
});

test("retains Criterion's reported confidence level", (testContext) => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-budget-"));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  writeCompleteSet(root);
  writeEstimate(root, "parse_typed_events/1000", 2_000_000, 1_800_000, 2_200_000, 0.9);

  const report = collectBenchmarkReport({ criterionDir: root, budget: BUDGET });
  const parse = report.benchmarks.find((result) => result.name === "parse_typed_events/1000");
  assert.equal(parse.mean.confidenceInterval.confidenceLevel, 0.9);
});
