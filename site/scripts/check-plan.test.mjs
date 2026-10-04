import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPlan, VIEWPORTS } from "./check-plan.mjs";

test("local checks retain the complete viewport and interaction coverage", () => {
  assert.equal(checkPlan([]).length, 5);
  assert.deepEqual(
    checkPlan([])
      .filter((viewport) => viewport.full)
      .map((viewport) => viewport.name),
    ["1440x960", "390x844"],
  );
  assert.equal(checkPlan([]).filter((viewport) => viewport.reduce).length, 1);
});

test("each CI viewport selects exactly one complete check case", () => {
  for (const viewport of VIEWPORTS)
    assert.deepEqual(checkPlan(["--viewport", viewport.name]), [viewport]);
});

test("multiple selections retain canonical desktop-first order without duplicates", () => {
  assert.deepEqual(
    checkPlan(["--viewport", "390x844", "--viewport", "1440x960", "--viewport", "390x844"]).map(
      (viewport) => viewport.name,
    ),
    ["1440x960", "390x844"],
  );
});

test("invalid selections fail instead of silently skipping browser coverage", () => {
  assert.throws(() => checkPlan(["--viewport", "typo"]), /Unknown site check viewport/);
  assert.throws(() => checkPlan(["--viewport"]), { code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" });
  assert.throws(() => checkPlan(["--unsupported"]), /Unknown option/);
});
