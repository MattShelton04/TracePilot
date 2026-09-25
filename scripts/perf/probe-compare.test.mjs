import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PIPELINE,
  parseProbeLine,
  renderMarkdown,
  summarize,
  variantOrder,
} from "./probe-compare.mjs";

test("variants alternate in ABBA order", () => {
  assert.deepEqual(variantOrder(2), ["base", "head", "head", "base"]);
  const order = variantOrder(4);
  assert.equal(order.filter((v) => v === "base").length, 4);
  assert.equal(order.filter((v) => v === "head").length, 4);
});

test("parses the last JSON line of probe output", () => {
  const parsed = parseProbeLine(
    'warning: noise\n{"mode":"phase1","elapsed_ms":120,"peak_rss_kib":2048,"detail":"x"}\n',
  );
  assert.equal(parsed.elapsed_ms, 120);
  assert.equal(parsed.peak_rss_kib, 2048);
  assert.throws(() => parseProbeLine("no json here"), /no JSON/);
});

test("summarises medians, peak memory and advisory flags", () => {
  const samples = [];
  for (const step of PIPELINE) {
    for (const [variant, ms, kib] of [
      ["base", 1000, 400_000],
      ["base", 1100, 410_000],
      ["head", 500, 200_000],
      ["head", 520, 210_000],
    ]) {
      samples.push({ variant, step: step.name, elapsedMs: ms, peakRssKib: kib });
    }
  }
  const rows = summarize(samples);
  assert.equal(rows.length, PIPELINE.length);
  const [first] = rows;
  assert.equal(first.base.medianMs, 1050);
  assert.equal(first.head.medianMs, 510);
  assert.equal(first.time, "improvement");
  assert.equal(first.memory, "improvement");
  assert.equal(Math.round(first.head.peakRssMib), 205);
  assert.match(renderMarkdown(rows, { repeats: 2, corpus: "test" }), /session index/);
});

test("missing peak memory (non-Linux) is reported as n/a", () => {
  const samples = PIPELINE.flatMap((step) => [
    { variant: "base", step: step.name, elapsedMs: 100, peakRssKib: null },
    { variant: "head", step: step.name, elapsedMs: 100, peakRssKib: null },
  ]);
  const rows = summarize(samples);
  assert.equal(rows[0].memory, "n/a");
  assert.equal(rows[0].time, "unchanged");
});
