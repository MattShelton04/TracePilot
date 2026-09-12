import assert from "node:assert/strict";
import test from "node:test";
import { retainedHistory } from "./history.mjs";

const newer = [
  ...Array.from({ length: 21 }, (_, index) => ({ id: index + 100, pr: index + 900 })),
  ...Array.from({ length: 21 }, (_, index) => ({ id: index + 200, pr: null })),
];

for (const pr of [813, null]) {
  test(`an older ${pr ? "PR" : "main"} rerun retains its new publication within the 20-per-kind limit`, () => {
    const current = { id: 1, pr };
    const entries = [current, ...newer];
    const original = structuredClone(entries);
    const kept = retainedHistory(entries, current.id);
    assert.equal(kept.length, 40);
    assert.ok(
      kept.some((entry) => entry.id === current.id),
      "current publication must remain reachable",
    );
    assert.equal(kept.filter((entry) => Boolean(entry.pr) === Boolean(pr)).length, 20);
    assert.equal(kept.filter((entry) => Boolean(entry.pr) !== Boolean(pr)).length, 20);
    assert.equal(
      kept.some((entry) => entry.id === (pr ? 101 : 201)),
      false,
    );
    assert.deepEqual(
      kept.map((entry) => entry.id),
      kept.map((entry) => entry.id).sort((a, b) => b - a),
    );
    assert.deepEqual(entries, original);
  });
}

test("a new publication uses one slot, and empty or missing-current inventories stay bounded", () => {
  const current = { id: 500, pr: 813 };
  const kept = retainedHistory([...newer, current], current.id);
  assert.equal(kept.length, 40);
  assert.equal(kept[0].id, current.id);
  assert.equal(kept.filter((entry) => entry.pr).length, 20);
  assert.deepEqual(retainedHistory([], 500), []);
  assert.equal(retainedHistory(newer, 999).length, 40);
  assert.deepEqual(retainedHistory([current], current.id), [current]);
});
