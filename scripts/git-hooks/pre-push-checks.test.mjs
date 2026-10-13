import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "pre-push-checks.mjs");

function dryRun(base) {
  const result = spawnSync(process.execPath, [SCRIPT, "--base", base, "--dry-run"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("nothing changed since the base: only the file-size step", () => {
  const out = dryRun("HEAD");
  assert.match(out, /would run file sizes: node scripts\/check-file-sizes\.mjs --since [0-9a-f]+/);
  assert.doesNotMatch(out, /rustfmt|typecheck/);
});

test("unknown base: full checks", () => {
  const out = dryRun("refs/heads/tracepilot-no-such-branch");
  assert.match(out, /no merge base/);
  assert.match(out, /cargo fmt --all -- --check/);
  assert.match(out, /would run typecheck: pnpm typecheck/);
});
