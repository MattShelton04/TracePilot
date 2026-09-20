import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collectBundleReport } from "./check-bundle.mjs";

const REPORTER_PATH = fileURLToPath(new URL("./check-bundle.mjs", import.meta.url));

const BUDGET = {
  frontend: {
    totalBundleSizeKb: 1,
    largestChunkKb: 0.5,
    initialLoadChunks: 1,
  },
};

function fixture(testContext) {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-bundle-"));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  const distDir = join(root, "dist");
  const assetsDir = join(distDir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(assetsDir, "app.js"), "x".repeat(2048));
  writeFileSync(join(assetsDir, "app.css"), "y".repeat(256));
  writeFileSync(
    join(distDir, "index.html"),
    '<link href="/assets/app.css"><script src="/assets/app.js"></script>',
  );
  return { root, distDir, assetsDir };
}

function runReporter({ root, distDir, budgetPath }) {
  const outputPath = join(root, "bundle-report.json");
  const summaryPath = join(root, "bundle-report.md");
  const result = spawnSync(
    process.execPath,
    [
      REPORTER_PATH,
      `--dist=${distDir}`,
      `--budget=${budgetPath}`,
      `--output=${outputPath}`,
      `--summary=${summaryPath}`,
    ],
    { encoding: "utf8" },
  );
  return { ...result, outputPath, summaryPath };
}

test("oversized bundle metrics remain advisory", (testContext) => {
  const { root, distDir } = fixture(testContext);
  const report = collectBundleReport({ distDir, budget: BUDGET });

  assert.equal(report.metrics.totalBundleSizeKb.status, "advisory-exceeded");
  assert.equal(report.metrics.totalBundleSizeKb.enforcement, "advisory");
  assert.equal(report.metrics.largestChunkKb.status, "advisory-exceeded");
  assert.equal(report.metrics.initialLoadChunks.status, "advisory-exceeded");

  const budgetPath = join(root, "perf-budget.json");
  writeFileSync(budgetPath, JSON.stringify(BUDGET));
  const cli = runReporter({ root, distDir, budgetPath });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /::warning::totalBundleSizeKb/);
  assert.equal(existsSync(cli.outputPath), true);
  assert.equal(existsSync(cli.summaryPath), true);
});

test("missing bundle measurement output is an error", (testContext) => {
  const { distDir, assetsDir } = fixture(testContext);
  rmSync(join(assetsDir, "app.js"));
  rmSync(join(assetsDir, "app.css"));

  assert.throws(
    () => collectBundleReport({ distDir, budget: BUDGET }),
    /produced no JS or CSS assets/,
  );
});

test("empty initial asset measurement is an error", (testContext) => {
  const { distDir } = fixture(testContext);
  writeFileSync(join(distDir, "index.html"), "<!doctype html><main></main>");

  assert.throws(
    () => collectBundleReport({ distDir, budget: BUDGET }),
    /index references no initial JS or CSS assets/,
  );
});

test("malformed budget and missing index make the CLI fail", (testContext) => {
  const { root, distDir } = fixture(testContext);
  const budgetPath = join(root, "perf-budget.json");
  writeFileSync(budgetPath, "{not json");

  const malformed = runReporter({ root, distDir, budgetPath });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /::error::/);

  writeFileSync(budgetPath, JSON.stringify(BUDGET));
  rmSync(join(distDir, "index.html"));
  const missingIndex = runReporter({ root, distDir, budgetPath });
  assert.equal(missingIndex.status, 1);
  assert.match(missingIndex.stderr, /::error::/);
});

test("missing and non-finite frontend thresholds are errors", (testContext) => {
  const { distDir } = fixture(testContext);

  assert.throws(
    () =>
      collectBundleReport({
        distDir,
        budget: { frontend: { totalBundleSizeKb: 1, largestChunkKb: 1 } },
      }),
    /frontend.initialLoadChunks must be a finite positive number/,
  );
  assert.throws(
    () =>
      collectBundleReport({
        distDir,
        budget: {
          frontend: { ...BUDGET.frontend, totalBundleSizeKb: Number.NaN },
        },
      }),
    /frontend.totalBundleSizeKb must be a finite positive number/,
  );
});
