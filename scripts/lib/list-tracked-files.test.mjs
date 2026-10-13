import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { listStagedFiles, listTrackedFiles, walkRepoFiles } from "./list-tracked-files.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fixtureTree() {
  const root = mkdtempSync(join(tmpdir(), "tp-list-files-"));
  for (const rel of [
    "package.json",
    "apps/desktop/src/App.vue",
    "node_modules/pkg/index.js",
    "apps/desktop/node_modules/pkg/index.js",
    "crates/core/target/debug/out.rs",
    ".git/HEAD",
    ".claude/worktrees/x/package.json",
    ".agent/worktrees/y/package.json",
    "packages/ui/dist/index.js",
  ]) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), "");
  }
  return root;
}

// With PATH pointing at an empty directory, spawning git fails the same way a
// sandbox's `spawn EPERM` does. (An absent PATH falls back to the parent's.)
function envWithoutGit(emptyDir) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
  );
  return { ...env, PATH: emptyDir };
}

test("walkRepoFiles skips dependency, build, git and agent directories", (t) => {
  const root = fixtureTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(walkRepoFiles(root), ["apps/desktop/src/App.vue", "package.json"]);
});

test("listTrackedFiles falls back to the filesystem when git can't run", (t) => {
  const root = fixtureTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = listTrackedFiles(root, { gitBin: "tracepilot-missing-git", quiet: true });
  assert.deepEqual(files, ["apps/desktop/src/App.vue", "package.json"]);
});

test("listStagedFiles returns null when git can't run", () => {
  assert.equal(listStagedFiles(REPO_ROOT, { gitBin: "tracepilot-missing-git", quiet: true }), null);
});

test("listTrackedFiles uses git ls-files in a repository", () => {
  const files = listTrackedFiles(REPO_ROOT);
  assert.ok(files.includes("scripts/lib/list-tracked-files.mjs") || files.includes("package.json"));
  assert.ok(!files.some((f) => f.startsWith("node_modules/")));
});

test("check scripts still pass when git can't be spawned", (t) => {
  const emptyDir = mkdtempSync(join(tmpdir(), "tp-no-git-"));
  t.after(() => rmSync(emptyDir, { recursive: true, force: true }));
  for (const script of ["scripts/check-catalog-drift.mjs", "scripts/check-no-hex-colors.mjs"]) {
    const result = spawnSync(process.execPath, [script, "--staged"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: envWithoutGit(emptyDir),
    });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
    assert.match(result.stderr, /note: git .* unavailable/);
  }
});
