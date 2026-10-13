import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnlisted } from "./check-scripts-index.mjs";

function check(tree) {
  return findUnlisted(Object.keys(tree), (path) => tree[path]);
}

test("a script named in its folder README is listed", () => {
  assert.deepEqual(
    check({
      "scripts/README.md": "Groups: see pricing.",
      "scripts/pricing/README.md": "- `cli.mjs` — the CLI.",
      "scripts/pricing/cli.mjs": "",
      "scripts/pricing/publish.mjs": "",
    }),
    ["scripts/pricing/publish.mjs"],
  );
});

test("the top-level README needs the path relative to it, not a bare name", () => {
  assert.deepEqual(
    check({
      "scripts/README.md": "`build.ps1`, `site/publish.mjs`, `scripts/macos/smoke.sh`.",
      "scripts/build.ps1": "",
      "scripts/site/publish.mjs": "",
      "scripts/pricing/publish.mjs": "",
      "scripts/macos/smoke.sh": "",
    }),
    ["scripts/pricing/publish.mjs"],
  );
});

test("imported or dot-sourced helpers and tests need no entry", () => {
  assert.deepEqual(
    check({
      "scripts/README.md": "`auto/app.ps1`, `perf/main.mjs`",
      "scripts/auto/app.ps1": ". (Join-Path $PSScriptRoot 'registry.ps1')",
      "scripts/auto/registry.ps1": "",
      "scripts/perf/main.mjs": 'import { x } from "../ci/helper.mjs";',
      "scripts/ci/helper.mjs": "",
      "scripts/ci/helper.test.mjs": 'import "./orphan.mjs";',
      "scripts/ci/orphan.mjs": "",
      "scripts/visual/extract_test.py": "",
    }),
    ["scripts/ci/orphan.mjs"],
  );
});

test("a name must match as a whole token", () => {
  assert.deepEqual(
    check({
      "scripts/README.md": "`pre-cli.mjs` and cli.mjsx and `cli.mjs`.",
      "scripts/cli.mjs": "",
      "scripts/i.mjs": "",
    }),
    ["scripts/i.mjs"],
  );
});
