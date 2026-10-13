#!/usr/bin/env node
/**
 * List, and with --yes remove, agent worktrees that are no longer needed.
 *
 * Usage: pnpm worktree:clean [--dry-run] [--merged] [--yes] [--force]
 *
 * Without --yes nothing changes; the plan is printed. With --yes it:
 * - removes leftover folders under `.agent/worktrees/` and `.claude/worktrees/`
 *   that git no longer tracks and that have no `.git` file (what a Windows
 *   "Directory not empty" removal leaves behind, often with a large target/);
 * - with --merged, removes registered `.agent/worktrees/` worktrees whose HEAD
 *   is in origin/main or is the head of a merged PR (via gh), if they have no
 *   uncommitted changes or unpushed commits (--force overrides both);
 * - stops app instances recorded inside each removed folder first;
 * - prunes stale worktree registrations and reports the disk freed.
 * Registered `.claude/worktrees/` and worktrees elsewhere are only reported.
 * Branches are kept.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AGENT_DIR,
  CLAUDE_DIR,
  folderSize,
  formatBytes,
  git,
  mainCheckout,
  parseWorktreeList,
  pathKey,
  refExists,
  tryGit,
} from "./lib.mjs";

const SCRIPT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const USAGE = "Usage: pnpm worktree:clean [--dry-run] [--merged] [--yes] [--force]";

export function parseArgs(argv) {
  const opts = { yes: false, dryRun: false, merged: false, force: false };
  for (const arg of argv) {
    if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--merged") opts.merged = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  // Deleting needs an explicit --yes, and --dry-run always wins.
  opts.apply = opts.yes && !opts.dryRun;
  return opts;
}

/**
 * Decide what to do with one folder or worktree.
 * item: { kind: "leftover" | "agent" | "claude" | "other", hasGit?, current?,
 *         locked?, dirty?, statusError?, merged?, unpushed? }
 */
export function decide(item, opts) {
  const keep = (reason) => ({ action: "keep", reason });
  const remove = (reason) => ({ action: "remove", reason });
  if (item.kind === "leftover") {
    if (!item.hasGit) return remove("leftover folder; git no longer tracks it");
    return opts.force
      ? remove("unregistered folder with a .git file (--force)")
      : keep(
          "unregistered but has a .git file, so it may hold uncommitted work (--force removes it)",
        );
  }
  if (item.kind !== "agent")
    return { action: "report", reason: "not an agent worktree; left alone" };
  if (item.current) return keep("current checkout");
  if (item.locked) return keep("locked (git worktree unlock it first)");
  if (item.statusError) return keep(`can't read its status: ${item.statusError}`);
  if (!opts.merged)
    return keep(item.dirty ? "uncommitted changes" : "clean; --merged checks whether it merged");
  if (!item.merged) return keep("not merged into the base branch");
  if (item.dirty && !opts.force)
    return keep("merged, but has uncommitted changes (--force removes it)");
  if (item.unpushed > 0 && !opts.force) {
    return keep(`merged, but ${item.unpushed} commit(s) are on no remote (--force removes it)`);
  }
  return remove(item.dirty || item.unpushed > 0 ? "merged (--force)" : "merged and clean");
}

/** Heads of merged PRs, so squash-merged branches count as merged. */
function mergedPrHeads(root) {
  const result = spawnSync(
    "gh",
    ["pr", "list", "--state", "merged", "--limit", "300", "--json", "headRefOid"],
    { cwd: root, encoding: "utf8", windowsHide: true, shell: false },
  );
  if (result.status !== 0) return undefined;
  try {
    return new Set(JSON.parse(result.stdout).map((pr) => pr.headRefOid));
  } catch {
    return undefined;
  }
}

function inspectWorktree(entry, ctx) {
  const item = {
    kind: "agent",
    path: entry.path,
    branch: entry.branch ?? "(detached)",
    locked: entry.locked,
  };
  item.current = pathKey(entry.path) === ctx.current;
  const status = tryGit(["status", "--porcelain"], entry.path);
  if (!status.ok) {
    item.statusError = status.err.split("\n")[0] || "git status failed";
    return item;
  }
  item.dirty = status.out.trim() !== "";
  if (ctx.opts.merged) {
    const prMerged = ctx.prHeads?.has(entry.head) ?? false;
    item.merged =
      prMerged || tryGit(["merge-base", "--is-ancestor", entry.head, ctx.base], ctx.root).ok;
    // A merged PR's head was on the remote even if its branch has since been deleted.
    const count = tryGit(
      ["rev-list", "--count", entry.head, "--not", "--remotes", ctx.base],
      ctx.root,
    );
    item.unpushed = prMerged ? 0 : Number.parseInt(count.out, 10) || 0;
  }
  return item;
}

/** App instances whose lifecycle state lives inside this folder. */
function recordedInstances(path) {
  const dir = join(path, ".tracepilot", "instances");
  if (!existsSync(dir)) return [];
  const found = [];
  for (const name of readdirSync(dir)) {
    for (const mode of ["desktop", "ui"]) {
      if (existsSync(join(dir, name, `${mode}.json`)))
        found.push({ name, mode, state: join(dir, name) });
    }
  }
  return found;
}

function stopInstance({ name, mode, state }) {
  const app = join(SCRIPT_ROOT, "scripts", "automation", "app.ps1");
  if (process.platform !== "win32" || !existsSync(app)) {
    return `could not stop app instance ${name} (${mode}); stop it with pnpm app:stop`;
  }
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    app,
    "stop",
    "-StateDirectory",
    state,
  ];
  if (mode === "ui") args.push("-Mode", "ui");
  const result = spawnSync("powershell", args, { encoding: "utf8", windowsHide: true });
  return result.status === 0
    ? undefined
    : `stopping app instance ${name} (${mode}) failed: ${result.stderr.trim()}`;
}

/** Delete a folder, tolerating Windows locks; returns an error message or undefined. */
function removeFolder(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    return undefined;
  } catch (error) {
    if (["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(error.code)) {
      return `${error.code}: files are in use. Stop app instances, Playwright sessions, editors and terminals using it, then rerun`;
    }
    return error.message;
  }
}

function removeItem(item, ctx) {
  const before = item.size ?? 0;
  for (const instance of item.instances) {
    const problem = stopInstance(instance);
    if (problem) console.log(`        ${problem}`);
  }
  let problem;
  if (item.kind === "agent") {
    const args = ["worktree", "remove", ...(ctx.opts.force ? ["--force"] : []), item.path];
    const removed = tryGit(args, ctx.root);
    // On Windows git can unregister the worktree, then fail with "Directory not empty".
    const stillRegistered = parseWorktreeList(
      git(["worktree", "list", "--porcelain"], ctx.root),
    ).some((entry) => pathKey(entry.path) === pathKey(item.path));
    if (!removed.ok && stillRegistered) problem = removed.err.split("\n")[0];
    else if (existsSync(item.path)) problem = removeFolder(item.path);
  } else {
    problem = removeFolder(item.path);
  }
  const freed = existsSync(item.path) ? Math.max(0, before - folderSize(item.path)) : before;
  return { problem, freed };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const root = mainCheckout(process.cwd());
  const current = pathKey(git(["rev-parse", "--show-toplevel"], process.cwd()).trim());
  const base = refExists("origin/main", root) ? "origin/main" : "main";
  if (opts.merged) tryGit(["fetch", "--quiet", "--prune", "origin"], root);
  const prHeads = opts.merged ? mergedPrHeads(root) : undefined;
  const ctx = { opts, root, current, base, prHeads };

  const worktrees = parseWorktreeList(git(["worktree", "list", "--porcelain"], root));
  const registered = new Map(worktrees.map((entry) => [pathKey(entry.path), entry]));
  const items = [];
  const claude = { registered: 0 };
  for (const area of [AGENT_DIR, CLAUDE_DIR]) {
    const dir = join(root, area);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const path = join(dir, name.name);
      const entry = registered.get(pathKey(path));
      if (!entry) items.push({ kind: "leftover", path, hasGit: existsSync(join(path, ".git")) });
      else if (area === AGENT_DIR) items.push(inspectWorktree(entry, ctx));
      else claude.registered++;
    }
  }
  const areas = [AGENT_DIR, CLAUDE_DIR].map((area) => `${pathKey(join(root, area))}/`);
  const others = worktrees.filter(
    (entry, index) =>
      index > 0 && !entry.prunable && !areas.some((area) => pathKey(entry.path).startsWith(area)),
  );
  const pruneRun = tryGit(["worktree", "prune", "--dry-run", "--verbose"], root);
  const prune = `${pruneRun.out}\n${pruneRun.err}`
    .split(/\r?\n/)
    .filter((line) => /^Removing /.test(line));

  console.log(
    `worktree:clean: ${opts.apply ? "removing" : "dry run, pass --yes to remove"} (main checkout ${root})`,
  );
  if (opts.merged && !prHeads)
    console.log("  note    gh is unavailable, so squash-merged branches are not detected");
  const show = (path) => relative(root, path).replace(/\\/g, "/") || path;
  let freed = 0;
  let failures = 0;
  for (const item of items) {
    const decision = decide(item, opts);
    const label = item.branch ? `${show(item.path)} [${item.branch}]` : show(item.path);
    if (decision.action !== "remove") {
      console.log(`  keep    ${label}: ${decision.reason}`);
      continue;
    }
    item.size = folderSize(item.path);
    item.instances = recordedInstances(item.path);
    const stops = item.instances.map((i) => ` (stops app instance ${i.name} ${i.mode})`).join("");
    console.log(`  remove  ${label}: ${decision.reason}, ${formatBytes(item.size)}${stops}`);
    if (!opts.apply) {
      freed += item.size;
      continue;
    }
    const result = removeItem(item, ctx);
    freed += result.freed;
    if (result.problem) {
      failures++;
      console.log(`  failed  ${label}: ${result.problem}`);
    }
  }
  for (const line of prune) console.log(`  prune   ${line.replace(/^Removing /, "")}`);
  if (opts.apply && prune.length) tryGit(["worktree", "prune"], root);
  if (claude.registered) {
    console.log(
      `  report  ${CLAUDE_DIR}: ${claude.registered} registered worktree(s), managed by Claude Code; left alone`,
    );
  }
  for (const entry of others) {
    console.log(
      `  report  ${entry.path} [${entry.branch ?? "detached"}]: outside the agent folders; left alone`,
    );
  }
  console.log(`${opts.apply ? "Freed" : "Would free"} ${formatBytes(freed)}.`);
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`worktree:clean: ${error.message}`);
    process.exitCode = 1;
  }
}
