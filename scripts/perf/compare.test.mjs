import assert from "node:assert/strict";
import test from "node:test";
import { compare } from "./compare.mjs";

function run(duration = 100) {
  return {
    status: "complete",
    harnessVersion: 2,
    fixtureVersion: 1,
    fixtureHash: "fixture",
    platform: "win32",
    node: "22",
    viewport: { width: 1440, height: 960 },
    cpuThrottleRate: 1,
    webview: { product: "webview", revision: "1" },
    selectedSession: { id: "session", turnCount: 200 },
    launch: {
      build: {
        frontend: "built",
        rustProfile: "release",
        automationDevtools: true,
        executableSha256: "binary",
      },
    },
    samples: ["session-list", "conversation", "analytics", "search"].flatMap((name) =>
      [0, 1, 2, 3].map((iteration) => ({ name, iteration, durationMs: duration + iteration })),
    ),
  };
}
test("detects clear improvement, regression and unchanged samples", () => {
  assert.equal(compare(run(), run(50)).rows[0].status, "improvement");
  assert.equal(compare(run(), run(200)).rows[0].status, "regression");
  assert.equal(compare(run(), run(103)).rows[0].status, "effectively unchanged");
});
test("does not compare incompatible fixtures, renderer slowdown or failed runs", () => {
  assert.equal(
    compare(run(), { ...run(), fixtureHash: "other" }).status,
    "unavailable/incompatible",
  );
  assert.equal(compare(run(), { ...run(), cpuThrottleRate: 4 }).status, "unavailable/incompatible");
  assert.equal(compare(run(), { ...run(), status: "failed" }).status, "execution failure");
});
test("missing operations cannot silently pass", () => {
  assert.equal(compare(run(), { ...run(), samples: [] }).status, "missing result");
});
test("optional scroll operation is compared only when both runs measured it", () => {
  const withScroll = (duration) => {
    const r = run(duration);
    r.samples.push(
      ...[0, 1, 2, 3].map((iteration) => ({
        name: "conversation-scroll",
        iteration,
        durationMs: duration * 40 + iteration,
      })),
    );
    return r;
  };
  const both = compare(withScroll(100), withScroll(50));
  assert.equal(both.rows.find((row) => row.name === "conversation-scroll").status, "improvement");
  const older = compare(run(), withScroll(100));
  assert.equal(older.status, "compared");
  assert.equal(
    older.rows.some((row) => row.name === "conversation-scroll"),
    false,
  );
});
