import assert from "node:assert/strict";
import test from "node:test";
import { renderBundleMarkdown, sizeDelta, validateBundleReport } from "./bundle-markdown.mjs";

const report = (size = 2) => ({
  schemaVersion: 2,
  metrics: {
    totalBundleSizeKb: { actual: size, budget: 1 },
    largestChunkKb: { actual: size, budget: 1 },
    initialLoadChunks: { actual: 1, budget: 2 },
  },
  assets: [{ file: "assets/app.js", bytes: size * 1024, gzipBytes: size * 100 }],
});
test("summary and signed changes precede a closed breakdown with valid Markdown spacing", () => {
  const body = renderBundleMarkdown(report(3), report(2));
  const [summary, detail] = body.split("<details>");
  assert.match(summary, /\+1.0 KiB \(\+50.0%\)/);
  assert.match(summary, /Gzipped/);
  assert.equal(summary.includes("| File |"), false);
  assert.match(detail, /<summary>.*<\/summary>\n\n\| Metric/);
  assert.ok(body.endsWith("\n</details>\n"));
  assert.equal(sizeDelta(1, 2), "-1.0 KiB (-50.0%)");
  assert.equal(sizeDelta(2, 2), "0.0 KiB (0.0%)");
  assert.equal(sizeDelta(1, 0), "+1.0 KiB (new)");
  assert.equal(sizeDelta(0, 0), "0.0 KiB (0.0%)");
});
test("untrusted names cannot inject HTML or table rows, and huge inventories fit comments", () => {
  const value = report();
  value.assets = Array.from({ length: 2000 }, () => ({
    file: `<script>|\`\n${"x".repeat(280)}`,
    bytes: 1,
    gzipBytes: 1,
  }));
  const body = renderBundleMarkdown(value);
  assert.equal(body.includes("<script>"), false);
  assert.match(body, /additional files/);
  assert.ok(Buffer.byteLength(body) < 50_000);
  assert.ok(body.endsWith("\n</details>\n"));
});
test("invalid artifact shapes, sizes and oversized inventories are rejected", () => {
  for (const value of [
    null,
    { schemaVersion: 1 },
    { ...report(), assets: [] },
    { ...report(), assets: Array(2001).fill({}) },
  ]) {
    assert.throws(() => validateBundleReport(value));
  }
  for (const size of [NaN, Infinity, -1, "10"])
    assert.throws(() => validateBundleReport(report(size)));
});
