import assert from "node:assert/strict";
import test from "node:test";
import { comparisonRefs } from "./compare-refs.mjs";

const head = "a".repeat(40),
  base = "b".repeat(40),
  ancestor = "c".repeat(40);
const merge = "e".repeat(40),
  tip = "f".repeat(40);
test("later PR revisions always compare the whole PR against the merge base, not their own head", () => {
  const calls = [];
  for (const sha of [head, "d".repeat(40)]) {
    assert.deepEqual(
      comparisonRefs(
        { pull_request: { head: { sha }, base: { sha: base } } },
        "pull_request",
        merge,
        (args) => {
          calls.push(args);
          return args[0] === "rev-list" ? `${merge} ${tip} ${sha}` : ancestor;
        },
      ),
      { base: ancestor, head: sha },
    );
  }
  assert.deepEqual(calls, [
    ["rev-list", "--parents", "-n", "1", merge],
    ["merge-base", tip, head],
    ["rev-list", "--parents", "-n", "1", merge],
    ["merge-base", tip, "d".repeat(40)],
  ]);
});
test("a stale event base SHA is only used when the merge commit does not merge this head", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    return args[0] === "rev-list" ? `${merge} ${tip} ${"9".repeat(40)}` : ancestor;
  };
  const event = { pull_request: { head: { sha: head }, base: { sha: base } } };
  assert.deepEqual(comparisonRefs(event, "pull_request", merge, git), { base: ancestor, head });
  assert.deepEqual(calls.at(-1), ["merge-base", base, head]);
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
