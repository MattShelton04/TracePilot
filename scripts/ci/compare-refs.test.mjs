import assert from "node:assert/strict";
import test from "node:test";
import { comparisonRefs } from "./compare-refs.mjs";

const head = "a".repeat(40),
  base = "b".repeat(40),
  ancestor = "c".repeat(40);
test("later PR revisions always compare against the merge base, not their own head", () => {
  const calls = [];
  for (const sha of [head, "d".repeat(40)]) {
    assert.deepEqual(
      comparisonRefs(
        { pull_request: { head: { sha }, base: { sha: base } } },
        "pull_request",
        "e".repeat(40),
        (args) => {
          calls.push(args);
          return ancestor;
        },
      ),
      { base: ancestor, head: sha },
    );
  }
  assert.deepEqual(calls, [
    ["merge-base", base, head],
    ["merge-base", base, "d".repeat(40)],
  ]);
});
test("pushes use before; manual and initial pushes use first parent; self-comparisons fail", () => {
  const git = (args) => {
    assert.deepEqual(args, ["rev-parse", `${head}^`]);
    return base;
  };
  assert.deepEqual(comparisonRefs({ before: base }, "push", head, git), { base, head });
  for (const event of [{}, { before: "0".repeat(40) }]) {
    assert.deepEqual(comparisonRefs(event, "workflow_dispatch", head, git), { base, head });
  }
  assert.throws(() => comparisonRefs({ before: head }, "push", head, git), /distinct/);
});
