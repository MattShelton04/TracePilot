import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-file-sizes.mjs");

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
}

test("explicit paths check only those files and skip missing ones", () => {
  const result = run("scripts/check-file-sizes.mjs", "./package.json", "deleted/file.ts");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed \(3 file\(s\)/);
});

test("an explicit oversized file fails", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tp-file-sizes-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const big = join(dir, "big.ts");
  writeFileSync(big, "export const x = 1;\n".repeat(501));
  const result = run(big);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /big\.ts {2}501 > 500/);
});
