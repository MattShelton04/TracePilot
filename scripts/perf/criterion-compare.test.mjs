import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classify, collectComparison, renderMarkdown } from "./criterion-compare.mjs";

function writeBench(root, name, { base, head, change }) {
  const dir = join(root, ...name.split("/"));
  const write = (sub, data) => {
    mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, sub, "estimates.json"), JSON.stringify(data));
  };
  const mean = (point) => ({
    point_estimate: point,
    confidence_interval: { confidence_level: 0.95, lower_bound: point, upper_bound: point },
  });
  write("new", { mean: mean(head) });
  if (base != null) write("pr-base", { mean: mean(base) });
  if (change) {
    write("change", {
      mean: {
        point_estimate: change[0],
        confidence_interval: {
          confidence_level: 0.95,
          lower_bound: change[1],
          upper_bound: change[2],
        },
      },
    });
  }
}

test("classify needs the whole interval beyond the threshold", () => {
  assert.equal(classify({ lower: 0.12, upper: 0.3 }), "regression");
  assert.equal(classify({ lower: -0.4, upper: -0.2 }), "improvement");
  assert.equal(classify({ lower: -0.05, upper: 0.05 }), "unchanged");
  assert.equal(classify({ lower: 0.02, upper: 0.2 }), "inconclusive");
  assert.equal(classify({ lower: 0.06, upper: 0.08 }, 0.05), "regression");
});

test("collects compared benchmarks and skips those without a baseline", () => {
  const root = mkdtempSync(join(tmpdir(), "criterion-compare-"));
  try {
    writeBench(root, "incremental_search/10", {
      base: 5e9,
      head: 1e8,
      change: [-0.98, -0.99, -0.97],
    });
    writeBench(root, "parse_typed_events/1000", {
      base: 2.6e6,
      head: 2.7e6,
      change: [0.03, -0.01, 0.07],
    });
    writeBench(root, "search/fts/100", { base: 1e6, head: 1.5e6, change: [0.5, 0.4, 0.6] });
    writeBench(root, "new_bench/1", { head: 1e6 });
    mkdirSync(join(root, "report"), { recursive: true });

    const report = collectComparison({ criterionDir: root, baseline: "pr-base" });
    assert.equal(report.totals.compared, 3);
    assert.deepEqual(Object.fromEntries(report.rows.map((row) => [row.name, row.verdict])), {
      "incremental_search/10": "improvement",
      "parse_typed_events/1000": "unchanged",
      "search/fts/100": "regression",
    });
    const markdown = renderMarkdown(report);
    assert.match(markdown, /Regressions: \*\*1\*\*/);
    assert.ok(markdown.indexOf("search/fts/100") < markdown.indexOf("incremental_search/10"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports an empty comparison without failing", () => {
  const root = mkdtempSync(join(tmpdir(), "criterion-compare-empty-"));
  try {
    const report = collectComparison({ criterionDir: root, baseline: "pr-base" });
    assert.equal(report.totals.compared, 0);
    assert.match(renderMarkdown(report), /No benchmark had a base result/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects malformed change estimates", () => {
  const root = mkdtempSync(join(tmpdir(), "criterion-compare-bad-"));
  try {
    writeBench(root, "bad/1", { base: 1, head: 1, change: [Number.NaN, 0, 0] });
    assert.throws(() => collectComparison({ criterionDir: root, baseline: "pr-base" }), /finite/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
