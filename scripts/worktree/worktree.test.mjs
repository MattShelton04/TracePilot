import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decide, parseArgs as parseCleanArgs } from "./clean.mjs";
import { folderSize, formatBytes, parseWorktreeList } from "./lib.mjs";
import { parseArgs as parseNewArgs } from "./new.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("new: slug doubles as instance name and the branch defaults to agent/<slug>", () => {
  assert.deepEqual(parseNewArgs(["fix-search"]), {
    slug: "fix-search",
    base: undefined,
    branch: "agent/fix-search",
    install: true,
  });
  const opts = parseNewArgs(["x1", "--base", "main", "--branch", "fix/x1", "--no-install"]);
  assert.equal(opts.branch, "fix/x1");
  assert.equal(opts.base, "main");
  assert.equal(opts.install, false);
  assert.throws(() => parseNewArgs(["Bad_Slug"]), /lowercase/);
  assert.throws(() => parseNewArgs([]), /Usage/);
  assert.throws(() => parseNewArgs(["a", "--base"]), /needs a value/);
});

test("clean: deleting needs --yes and --dry-run always wins", () => {
  assert.equal(parseCleanArgs([]).apply, false);
  assert.equal(parseCleanArgs(["--yes"]).apply, true);
  assert.equal(parseCleanArgs(["--yes", "--dry-run"]).apply, false);
  assert.throws(() => parseCleanArgs(["--all"]), /Unknown argument/);
});

test("clean: leftovers without .git go; ones with .git need --force", () => {
  const opts = { merged: false, force: false };
  assert.equal(decide({ kind: "leftover", hasGit: false }, opts).action, "remove");
  assert.equal(decide({ kind: "leftover", hasGit: true }, opts).action, "keep");
  assert.equal(
    decide({ kind: "leftover", hasGit: true }, { ...opts, force: true }).action,
    "remove",
  );
});

test("clean: registered worktrees go only when merged, clean and pushed", () => {
  const merged = { merged: true, force: false };
  const clean = { kind: "agent", merged: true, dirty: false, unpushed: 0 };
  assert.equal(decide(clean, { merged: false, force: false }).action, "keep");
  assert.equal(decide(clean, merged).action, "remove");
  assert.equal(decide({ ...clean, merged: false }, merged).action, "keep");
  assert.match(decide({ ...clean, dirty: true }, merged).reason, /uncommitted/);
  assert.match(decide({ ...clean, unpushed: 2 }, merged).reason, /2 commit\(s\)/);
  assert.equal(
    decide({ ...clean, dirty: true, unpushed: 2 }, { merged: true, force: true }).action,
    "remove",
  );
  assert.equal(decide({ ...clean, locked: true }, { merged: true, force: true }).action, "keep");
  assert.equal(decide({ ...clean, current: true }, { merged: true, force: true }).action, "keep");
  assert.equal(decide({ kind: "claude" }, { merged: true, force: true }).action, "report");
});

test("parseWorktreeList reads porcelain output", () => {
  const list = parseWorktreeList(
    "worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/repo/.agent/worktrees/x\nHEAD def\ndetached\nlocked reason here\n\n",
  );
  assert.deepEqual(list, [
    { path: "C:/repo", head: "abc", branch: "main" },
    { path: "C:/repo/.agent/worktrees/x", head: "def", detached: true, locked: "reason here" },
  ]);
});

test("folderSize counts files without following links", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-size-"));
  try {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "a", "one"), "12345");
    writeFileSync(join(dir, "a", "b", "two"), "123");
    const outside = mkdtempSync(join(tmpdir(), "wt-outside-"));
    writeFileSync(join(outside, "big"), "x".repeat(1000));
    symlinkSync(outside, join(dir, "link"), "junction");
    assert.equal(folderSize(dir), 8);
    rmSync(outside, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(formatBytes(3 * 1024 ** 3), "3.0 GB");
  assert.equal(formatBytes(5 * 1024 ** 2), "5 MB");
});

test("new and clean work end to end in a scratch repository", () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "wt-repo-")));
  const run = (args, cwd = repo) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const node = (script, args) =>
    spawnSync(process.execPath, [join(here, script), ...args], { cwd: repo, encoding: "utf8" });
  try {
    run(["init", "--quiet", "-b", "main"]);
    run([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "init",
    ]);

    const created = node("new.mjs", ["demo", "--base", "main", "--no-install"]);
    assert.equal(created.status, 0, created.stderr);
    const worktree = join(repo, ".agent", "worktrees", "demo");
    assert.equal(run(["branch", "--show-current"], worktree).trim(), "agent/demo");
    assert.match(created.stdout, /pnpm app:start -Instance demo -Fixtures/);
    assert.equal(node("new.mjs", ["demo", "--no-install"]).status, 1, "refuses an existing folder");

    const leftover = join(repo, ".agent", "worktrees", "stale");
    mkdirSync(join(leftover, "target"), { recursive: true });
    writeFileSync(join(leftover, "target", "lib.rlib"), "x".repeat(2048));
    writeFileSync(join(worktree, "wip.txt"), "uncommitted");

    const dry = node("clean.mjs", ["--merged"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /remove {2}\.agent\/worktrees\/stale: leftover/);
    assert.match(
      dry.stdout,
      /keep {4}\.agent\/worktrees\/demo \[agent\/demo\]: merged, but has uncommitted/,
    );
    assert.ok(existsSync(leftover), "dry run changes nothing");

    const applied = node("clean.mjs", ["--merged", "--yes"]);
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);
    assert.ok(!existsSync(leftover));
    assert.ok(existsSync(join(worktree, "wip.txt")), "dirty worktree kept");

    rmSync(join(worktree, "wip.txt"));
    const merged = node("clean.mjs", ["--merged", "--yes"]);
    assert.equal(merged.status, 0, merged.stdout + merged.stderr);
    assert.ok(!existsSync(worktree));
    assert.equal(run(["worktree", "list", "--porcelain"]).match(/^worktree /gm).length, 1);
    assert.match(run(["branch", "--list", "agent/demo"]), /agent\/demo/, "branch kept");
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
  }
});
