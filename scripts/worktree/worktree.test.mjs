import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classify,
  decide,
  mergedPrCommits,
  mergeState,
  parseArgs as parseCleanArgs,
  slugPath,
} from "./clean.mjs";
import {
  AGENT_DIR,
  CLAUDE_DIR,
  folderSize,
  formatBytes,
  lastActivity,
  parseWorktreeList,
  stateIsLive,
} from "./lib.mjs";
import { existingFolderMessage, lowDiskWarning, parseArgs as parseNewArgs } from "./new.mjs";

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

test("clean: slugs name specific agent worktrees", () => {
  const opts = parseCleanArgs(["one", "two", "one", "--yes", "--force"]);
  assert.deepEqual(opts.slugs, ["one", "two"]);
  assert.equal(opts.apply, true);
  assert.equal(opts.force, true);
  assert.deepEqual(parseCleanArgs(["--merged"]).slugs, []);
  assert.throws(() => parseCleanArgs(["Bad_Slug"]), /Not a worktree slug/);
  assert.throws(() => parseCleanArgs(["one", "--merged"]), /not both/);
});

test("clean: named worktrees need not be merged but keep uncommitted and unpushed work", () => {
  const opts = { merged: false, force: false };
  const named = { kind: "agent", targeted: true, merged: false, dirty: false, unpushed: 0 };
  assert.deepEqual(decide(named, opts), { action: "remove", reason: "named and clean" });
  assert.match(decide({ ...named, dirty: true }, opts).reason, /named, but has uncommitted/);
  assert.equal(decide({ ...named, unpushed: 1 }, opts).action, "keep");
  assert.equal(decide({ ...named, unpushed: 1 }, { ...opts, force: true }).action, "remove");
  assert.equal(decide({ ...named, current: true }, { ...opts, force: true }).action, "keep");
  assert.equal(decide({ kind: "missing", registered: false }, opts).action, "skip");
});

test("clean: --merged selects only .claude/worktrees/agent-<hex> that are merged, clean and pushed", () => {
  const entry = { path: "x", head: "abc" };
  const merged = { merged: true, force: false };
  assert.equal(classify(CLAUDE_DIR, "agent-a1b2c3d4", entry, merged), "agent");
  assert.equal(classify(CLAUDE_DIR, "agent-a04ced92437b2f2a1", entry, merged), "agent");
  assert.equal(classify(CLAUDE_DIR, "agent-notes", entry, merged), "claude", "user-titled session");
  assert.equal(classify(CLAUDE_DIR, "agent-a1b2", entry, merged), "claude", "too short for an id");
  assert.equal(classify(CLAUDE_DIR, "agent-a1b2c3d4", entry, { merged: false }), "claude");
  assert.equal(classify(CLAUDE_DIR, "tracepilot-desktop-1", entry, merged), "claude");
  assert.equal(classify(CLAUDE_DIR, "agent-a1b2c3d4", undefined, merged), "leftover");
  assert.equal(classify(AGENT_DIR, "fix-x", entry, { merged: false }), "agent");

  const select = (name, state) => {
    const kind = classify(CLAUDE_DIR, name, entry, merged);
    return decide({ kind, merged: true, dirty: false, unpushed: 0, ...state }, merged).action;
  };
  assert.equal(select("agent-a1b2c3d4"), "remove");
  assert.equal(select("agent-a1b2c3d4", { dirty: true }), "keep");
  assert.equal(select("agent-a1b2c3d4", { unpushed: 3 }), "keep");
  assert.equal(select("agent-a1b2c3d4", { merged: false }), "keep");
  assert.equal(select("my-session"), "report");
  assert.equal(select("agent-notes"), "report");
});

test("clean: a slug names .agent/worktrees, or .claude/worktrees only for an Agent tool name", () => {
  const root = join("C:", "repo");
  const none = () => false;
  assert.equal(slugPath(root, "fix-x", none), join(root, AGENT_DIR, "fix-x"));
  assert.equal(slugPath(root, "agent-notes", none), join(root, AGENT_DIR, "agent-notes"));
  assert.equal(slugPath(root, "agent-a1b2c3d4", none), join(root, CLAUDE_DIR, "agent-a1b2c3d4"));
  const agentFolder = (path) => path === join(root, AGENT_DIR, "agent-a1b2c3d4");
  assert.equal(
    slugPath(root, "agent-a1b2c3d4", agentFolder),
    join(root, AGENT_DIR, "agent-a1b2c3d4"),
    "an existing .agent folder of that name wins",
  );
  assert.deepEqual(parseCleanArgs(["agent-a04ced92437b2f2a1", "--yes"]).slugs, [
    "agent-a04ced92437b2f2a1",
  ]);
});

test("clean: a worker merged into a squash-merged integration branch is merged via its PR", () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "wt-squash-")));
  const config = [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.com",
    "-c",
    "commit.gpgsign=false",
  ];
  const run = (...args) =>
    execFileSync("git", [...config, ...args], { cwd: repo, encoding: "utf8" }).trim();
  const commit = (file, message) => {
    writeFileSync(join(repo, file), message);
    run("add", file);
    run("commit", "--quiet", "-m", message);
    return run("rev-parse", "HEAD");
  };
  try {
    run("init", "--quiet", "-b", "main");
    const init = commit("readme.txt", "init");
    run("checkout", "--quiet", "-b", "integration");
    run("checkout", "--quiet", "-b", "worker");
    const worker = commit("a.txt", "worker change");
    run("checkout", "--quiet", "-b", "late");
    const late = commit("b.txt", "worker follow-up that never merged");
    run("checkout", "--quiet", "integration");
    run("merge", "--quiet", "--no-ff", "-m", "merge worker", "worker");
    const integration = run("rev-parse", "HEAD");
    run("checkout", "--quiet", "main");
    run("merge", "--quiet", "--squash", "integration");
    run("commit", "--quiet", "-m", "integration (#7)");

    // Stands in for gh pr list; PR #8's head was never fetched, so it is skipped.
    const prs = [
      { number: 8, oid: "f".repeat(40) },
      { number: 7, oid: integration },
    ];
    const ctx = { root: repo, base: "main", prCommits: mergedPrCommits(prs, "main", repo) };
    assert.deepEqual(mergeState(worker, { ...ctx, prCommits: undefined }), { merged: false });
    assert.deepEqual(mergeState(worker, ctx), { merged: true, via: "merged via PR #7" });
    assert.deepEqual(mergeState(integration, ctx), { merged: true, via: "merged via PR #7" });
    assert.deepEqual(mergeState(late, ctx), { merged: false });
    assert.deepEqual(mergeState(init, ctx), { merged: true });
    assert.equal(mergedPrCommits([], "main", repo).size, 0);
    const item = { kind: "agent", merged: true, mergedVia: "merged via PR #7", unpushed: 0 };
    assert.equal(decide(item, { merged: true }).reason, "merged via PR #7 and clean");
    assert.match(decide({ ...item, dirty: true }, { merged: true }).reason, /PR #7, but has/);
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("clean: --merged keeps worktrees another run may still use; --force doesn't override", () => {
  const merged = { merged: true, force: false, includeRecent: false };
  const idle = { kind: "agent", merged: true, dirty: false, unpushed: 0, recent: false };
  assert.equal(decide(idle, merged).action, "remove");
  const recent = { ...idle, recent: true };
  assert.match(decide(recent, merged).reason, /active in the last 12 hours/);
  assert.equal(decide(recent, { ...merged, force: true }).action, "keep");
  assert.equal(decide(recent, { ...merged, includeRecent: true }).action, "remove");
  const live = { ...idle, liveApps: ["demo (desktop)"] };
  const everything = { merged: true, force: true, includeRecent: true };
  assert.match(decide(live, everything).reason, /demo \(desktop\) is running/);
  assert.equal(decide({ ...recent, ...live, targeted: true }, { merged: false }).action, "remove");
  assert.equal(parseCleanArgs(["--merged", "--include-recent"]).includeRecent, true);
});

test("clean: app state with a live pid counts as running; dead or empty doesn't", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-state-"));
  const state = (name, value) => {
    const file = join(dir, name);
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  try {
    assert.equal(stateIsLive(state("live.json", { processes: [{ pid: process.pid }] })), true);
    assert.equal(stateIsLive(state("one.json", { processes: { pid: process.pid } })), true);
    assert.equal(stateIsLive(state("dead.json", { processes: [{ pid: 2 ** 31 - 2 }] })), false);
    assert.equal(stateIsLive(state("empty.json", { processes: [] })), false);
    assert.equal(stateIsLive(state("bad.json", "{not json")), true, "unreadable counts as live");
    const then = Date.now() - 60_000;
    assert.ok(lastActivity(dir, join(dir, "missing")) >= then, "folder mtime counts");
    assert.equal(lastActivity(join(dir, "nope")), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: an existing folder explains whether it is a worktree or a leftover", () => {
  const path = join("C:", "repo", ".agent", "worktrees", "integration");
  const registered = existingFolderMessage(path, { path, branch: "agent/integration" }, true);
  assert.match(registered, /already a registered worktree on branch agent\/integration/);
  assert.match(registered, /Reuse it/);
  const leftover = existingFolderMessage(path, undefined, false);
  assert.match(leftover, /leftover folder, not a worktree/);
  assert.match(leftover, /git -C on it would act on the main checkout/);
  assert.match(leftover, /pnpm worktree:clean integration --yes/);
  const withGit = existingFolderMessage(path, undefined, true);
  assert.match(withGit, /may hold uncommitted work/);
  assert.match(withGit, /--force/);
});

test("new: warns only when free disk is known to be low", () => {
  assert.equal(lowDiskWarning(undefined), undefined);
  assert.equal(lowDiskWarning(200 * 1024 ** 3), undefined);
  assert.match(lowDiskWarning(20 * 1024 ** 3), /20\.0 GB free.*worktree:clean --merged/);
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
  // Make a worktree look untouched for two days: its folder and git admin files.
  const age = (path) => {
    const gitDir = run(["rev-parse", "--absolute-git-dir"], path).trim();
    const then = new Date(Date.now() - 48 * 60 * 60 * 1000);
    for (const file of [
      path,
      join(gitDir, "HEAD"),
      join(gitDir, "index"),
      join(gitDir, "logs", "HEAD"),
    ]) {
      if (existsSync(file)) utimesSync(file, then, then);
    }
  };
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
    assert.deepEqual(created.stdout.trimEnd().split(/\r?\n/).slice(-2), [
      `worktree: ${worktree}`,
      "branch: agent/demo",
    ]);
    const again = node("new.mjs", ["demo", "--no-install"]);
    assert.equal(again.status, 1, "refuses an existing worktree");
    assert.match(again.stderr, /registered worktree on branch agent\/demo/);
    assert.doesNotMatch(again.stdout, /^worktree: /m);

    const ghost = join(repo, ".agent", "worktrees", "ghost");
    mkdirSync(ghost, { recursive: true });
    const blocked = node("new.mjs", ["ghost", "--no-install"]);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /leftover folder.*\n.*act on the main checkout/);
    assert.doesNotMatch(blocked.stdout, /^(worktree|branch): /m);
    const namedDry = node("clean.mjs", ["ghost", "nope"]);
    assert.equal(namedDry.status, 0, namedDry.stderr);
    assert.match(namedDry.stdout, /remove {2}\.agent\/worktrees\/ghost: leftover/);
    assert.match(namedDry.stdout, /skip {4}\.agent\/worktrees\/nope: no such folder/);
    assert.ok(existsSync(ghost), "named dry run changes nothing");
    assert.equal(node("clean.mjs", ["ghost", "--yes"]).status, 0);
    assert.ok(!existsSync(ghost));

    // Claude Code's Agent tool worktrees: agent-* go when merged, clean and idle; sessions stay.
    writeFileSync(join(worktree, "wip.txt"), "uncommitted");
    age(worktree);
    const claudeDir = join(repo, ".claude", "worktrees");
    const names = [
      "agent-a1a1a1a1",
      "agent-b2b2b2b2",
      "agent-d4d4d4d4",
      "agent-e5e5e5e5",
      "desktop-c3",
      "agent-notes",
    ];
    for (const name of names) {
      run(["worktree", "add", "--quiet", "-b", `worktree-${name}`, join(claudeDir, name), "main"]);
    }
    writeFileSync(join(claudeDir, "agent-b2b2b2b2", "wip.txt"), "uncommitted");
    const appState = join(claudeDir, "agent-e5e5e5e5", ".tracepilot", "instances", "e5");
    mkdirSync(appState, { recursive: true });
    writeFileSync(
      join(appState, "desktop.json"),
      JSON.stringify({ processes: { pid: process.pid } }),
    );
    // agent-d4d4d4d4 stays fresh, like a worker another run has only just created.
    for (const name of names.filter((n) => n !== "agent-d4d4d4d4")) age(join(claudeDir, name));

    const forced = node("clean.mjs", ["--merged", "--force"]);
    assert.match(
      forced.stdout,
      /keep {4}\.claude\/worktrees\/agent-d4d4d4d4 .*active in the last 12 hours/,
    );
    assert.match(
      forced.stdout,
      /keep {4}\.claude\/worktrees\/agent-e5e5e5e5 .*e5 \(desktop\) is running/,
    );

    const claudeRun = node("clean.mjs", ["--merged", "--yes"]);
    assert.equal(claudeRun.status, 0, claudeRun.stdout + claudeRun.stderr);
    assert.match(
      claudeRun.stdout,
      /remove {2}\.claude\/worktrees\/agent-a1a1a1a1 \[worktree-agent-a1a1a1a1\]/,
    );
    assert.match(claudeRun.stdout, /keep {4}\.claude\/worktrees\/agent-b2b2b2b2 .*uncommitted/);
    assert.match(claudeRun.stdout, /2 desktop session worktree\(s\)/);
    assert.ok(!existsSync(join(claudeDir, "agent-a1a1a1a1")));
    assert.ok(existsSync(join(claudeDir, "agent-b2b2b2b2", "wip.txt")));
    assert.ok(existsSync(join(claudeDir, "agent-d4d4d4d4")), "recent worktree kept");
    assert.ok(existsSync(join(claudeDir, "desktop-c3")));
    assert.ok(existsSync(join(claudeDir, "agent-notes")), "user-titled session left alone");

    const recent = node("clean.mjs", ["--merged", "--yes", "--include-recent"]);
    assert.equal(recent.status, 0, recent.stdout + recent.stderr);
    assert.ok(!existsSync(join(claudeDir, "agent-d4d4d4d4")), "--include-recent removes it");
    assert.ok(existsSync(join(claudeDir, "agent-e5e5e5e5")), "running app still keeps it");
    // A lead names its own Agent tool workers; a desktop session can't be named.
    const namedDirty = node("clean.mjs", ["agent-b2b2b2b2", "agent-notes"]);
    assert.equal(namedDirty.status, 0, namedDirty.stderr);
    assert.match(
      namedDirty.stdout,
      /keep {4}\.claude\/worktrees\/agent-b2b2b2b2 .*named, but has uncommitted/,
    );
    assert.match(namedDirty.stdout, /skip {4}\.agent\/worktrees\/agent-notes: no such folder/);
    rmSync(join(claudeDir, "agent-b2b2b2b2", "wip.txt"));
    const namedRun = node("clean.mjs", ["agent-b2b2b2b2", "agent-notes", "--yes"]);
    assert.equal(namedRun.status, 0, namedRun.stdout + namedRun.stderr);
    assert.match(
      namedRun.stdout,
      /remove {2}\.claude\/worktrees\/agent-b2b2b2b2 .*named and clean/,
    );
    assert.ok(!existsSync(join(claudeDir, "agent-b2b2b2b2")));
    assert.ok(existsSync(join(claudeDir, "agent-notes")));
    for (const name of ["agent-e5e5e5e5", "desktop-c3", "agent-notes"]) {
      run(["worktree", "remove", "--force", join(claudeDir, name)]);
    }

    const leftover = join(repo, ".agent", "worktrees", "stale");
    mkdirSync(join(leftover, "target"), { recursive: true });
    writeFileSync(join(leftover, "target", "lib.rlib"), "x".repeat(2048));

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
    age(worktree);
    const merged = node("clean.mjs", ["--merged", "--yes"]);
    assert.equal(merged.status, 0, merged.stdout + merged.stderr);
    assert.ok(!existsSync(worktree));
    assert.equal(run(["worktree", "list", "--porcelain"]).match(/^worktree /gm).length, 1);
    assert.match(run(["branch", "--list", "agent/demo"]), /agent\/demo/, "branch kept");
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
  }
});
