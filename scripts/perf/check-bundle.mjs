import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const FRONTEND_BUDGET_KEYS = Object.freeze([
  "totalBundleSizeKb",
  "largestChunkKb",
  "initialLoadChunks",
]);

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

function assetPaths(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...assetPaths(path));
    else if (entry.isFile() && [".js", ".css"].includes(extname(entry.name))) paths.push(path);
  }
  return paths;
}

function advisoryMetric(actual, budget, extras = {}) {
  return {
    actual,
    budget,
    enforcement: "advisory",
    status: actual <= budget ? "within" : "advisory-exceeded",
    ...extras,
  };
}

export function collectBundleReport({ distDir, budget }) {
  assert(
    budget && typeof budget === "object" && !Array.isArray(budget),
    "Budget must be an object",
  );
  const frontend = budget.frontend;
  assert(
    frontend && typeof frontend === "object" && !Array.isArray(frontend),
    "Missing frontend performance thresholds",
  );
  for (const key of FRONTEND_BUDGET_KEYS) {
    finitePositive(frontend[key], `frontend.${key}`);
  }

  const assetsDir = join(distDir, "assets");
  assert(statSync(assetsDir).isDirectory(), `Missing bundle assets directory: ${assetsDir}`);
  const paths = assetPaths(assetsDir).sort();
  assert(paths.length > 0, "Bundle build produced no JS or CSS assets");

  const assets = paths.map((path) => {
    const content = readFileSync(path);
    return {
      file: relative(distDir, path).split(sep).join("/"),
      bytes: content.byteLength,
      gzipBytes: gzipSync(content, { level: 9, mtime: 0 }).byteLength,
    };
  });
  const totalKb = assets.reduce((total, asset) => total + asset.bytes, 0) / 1024;
  const largest = assets.reduce((current, asset) =>
    asset.bytes > current.bytes ? asset : current,
  );
  const largestKb = largest.bytes / 1024;

  const indexPath = join(distDir, "index.html");
  const indexHtml = readFileSync(indexPath, "utf8");
  const initialAssets = [
    ...new Set(
      [...indexHtml.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
  assert(initialAssets.length > 0, "Bundle index references no initial JS or CSS assets");

  return {
    schemaVersion: 2,
    metadata: {
      source: "Vite production bundle",
      assetScope: "Generated JS and CSS under apps/desktop/dist",
    },
    metrics: {
      totalBundleSizeKb: advisoryMetric(totalKb, frontend.totalBundleSizeKb),
      largestChunkKb: advisoryMetric(largestKb, frontend.largestChunkKb, {
        file: largest.file,
      }),
      initialLoadChunks: advisoryMetric(initialAssets.length, frontend.initialLoadChunks, {
        files: initialAssets,
      }),
    },
    assets,
  };
}

export function renderBundleMarkdown(report) {
  const { totalBundleSizeKb, largestChunkKb, initialLoadChunks } = report.metrics;
  const status = (metric) => (metric.status === "within" ? "within" : "exceeded (advisory)");
  const lines = [
    "## Bundle analysis",
    "",
    "All size thresholds are advisory. Missing or invalid measurement inputs still fail the job.",
    "",
    "| Metric | Actual | Threshold | Status |",
    "| --- | ---: | ---: | --- |",
    `| Total JS + CSS | ${totalBundleSizeKb.actual.toFixed(1)} KiB | ${totalBundleSizeKb.budget} KiB | ${status(totalBundleSizeKb)} |`,
    `| Largest chunk (\`${largestChunkKb.file}\`) | ${largestChunkKb.actual.toFixed(1)} KiB | ${largestChunkKb.budget} KiB | ${status(largestChunkKb)} |`,
    `| Initial HTML JS/CSS assets | ${initialLoadChunks.actual} | ${initialLoadChunks.budget} | ${status(initialLoadChunks)} |`,
    "",
    "| File | Size (KiB) | Gzipped (KiB) |",
    "| --- | ---: | ---: |",
  ];
  lines.push(
    ...report.assets.map(
      (asset) =>
        `| \`${asset.file}\` | ${(asset.bytes / 1024).toFixed(1)} | ${(asset.gzipBytes / 1024).toFixed(1)} |`,
    ),
  );
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
    distDir: resolve(options.dist ?? "apps/desktop/dist"),
    budgetPath: resolve(options.budget ?? "perf-budget.json"),
    outputPath: resolve(options.output ?? "bundle-report.json"),
    summaryPath: resolve(options.summary ?? "bundle-report.md"),
  };
}

export function run(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const budget = readJson(options.budgetPath, "performance thresholds");
  const report = collectBundleReport({ distDir: options.distDir, budget });
  mkdirSync(dirname(options.outputPath), { recursive: true });
  mkdirSync(dirname(options.summaryPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(options.summaryPath, renderBundleMarkdown(report));
  for (const [name, metric] of Object.entries(report.metrics)) {
    if (metric.status === "advisory-exceeded") {
      console.warn(
        `::warning::${name} ${metric.actual} exceeds advisory threshold ${metric.budget}`,
      );
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = run();
    console.log(renderBundleMarkdown(report));
  } catch (error) {
    console.error(`::error::${error.stack ?? error}`);
    process.exitCode = 1;
  }
}
