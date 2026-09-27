import assert from "node:assert/strict";
import { test } from "node:test";
import { renderFreshness, validateReport } from "./report.mjs";

const report = {
  version: 1,
  status: "outdated",
  checkedAt: "2026-09-27",
  snapshotDate: "2026-09-10",
  headSha: "a".repeat(40),
  snapshotRevision: "b".repeat(40),
  upstreamRevision: "c".repeat(40),
  changes: [
    {
      table: "usage",
      key: "GPT-6 Sol / Long context",
      kind: "changed",
      before: "input: 4",
      after: "input: 3",
    },
  ],
};

test("report explains changes, includes source revisions and gives the simple refresh command", () => {
  const body = renderFreshness(validateReport(report));
  assert.match(body, /Pricing needs review/);
  assert.match(body, /GPT-6 Sol \/ Long context/);
  assert.match(body, /input: 4.*input: 3/);
  assert.match(body, /pnpm pricing:fetch/);
  assert.match(body, /advisory/);
});

test("a resolved advisory and an unverifiable check cannot be mistaken for stale prices", () => {
  assert.match(
    renderFreshness(validateReport({ ...report, status: "current", changes: [] })),
    /Pricing is current/,
  );
  assert.match(
    renderFreshness(
      validateReport({ ...report, status: "unavailable", error: "Timeout", changes: [] }),
    ),
    /not a passing freshness check/,
  );
});

test("artifact data is bounded and escaped instead of interpreted as Markdown or mentions", () => {
  const hostile = {
    ...report,
    changes: [
      { ...report.changes[0], key: "@everyone [click](https://evil.example) <script> |\n" },
    ],
  };
  const body = renderFreshness(validateReport(hostile));
  assert.ok(!body.includes("@everyone"));
  assert.ok(!body.includes("[click]"));
  assert.ok(!body.includes("<script>"));
  assert.throws(() => validateReport({ ...report, headSha: "bad" }), /revisions/);
  assert.throws(() => validateReport({ ...report, status: "current" }), /differences/);
  assert.throws(
    () => validateReport({ ...report, changes: new Array(2001).fill(report.changes[0]) }),
    /differences/,
  );
});

test("even maximum-size escaped rows stay below GitHub's comment limit", () => {
  const large = {
    ...report,
    changes: new Array(100).fill({
      ...report.changes[0],
      key: "&".repeat(10000),
      before: "&".repeat(10000),
      after: "&".repeat(10000),
    }),
  };
  const body = renderFreshness(validateReport(large));
  assert.ok(Buffer.byteLength(body, "utf8") < 60000);
  assert.match(body, /more differences/);
});
