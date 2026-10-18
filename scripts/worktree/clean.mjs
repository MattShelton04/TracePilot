#!/usr/bin/env node
/**
 * List, and with --yes remove, agent worktrees that are no longer needed.
 *
 * Usage: pnpm worktree:clean [--dry-run] [--merged] [--include-recent] [--yes] [--force]
 *        pnpm worktree:clean <slug>... [--dry-run] [--yes] [--force]
 *
 * Without --yes nothing changes; the plan is printed. With --yes it:
 * - removes leftover folders under `.agent/worktrees/` and `.claude/worktrees/`
 *   that git no longer tracks and that have no `.git` file (what a Windows
 *   "Directory not empty" removal leaves behind, often with a large target/);
 * - with --merged, removes registered `.agent/worktrees/*` and
 *   `.claude/worktrees/agent-<hex>` worktrees (Claude Code's Agent tool
 *   isolation) whose HEAD is in origin/main or in the head of a merged PR (via
 *   gh; covers workers merged into a squash-merged integration branch), if
 *   they have no uncommitted changes or unpushed commits (--force overrides both).
 *   Because another run may still be using one, it also keeps any with a running
 *   app instance recorded inside, or whose folder or git HEAD/index/reflog
 *   changed in the last 12 hours (--include-recent drops this recency guard);
 *   --force overrides neither;
 * - with slugs, removes only `.agent/worktrees/<slug>` for each slug (or
 *   `.claude/worktrees/agent-<hex>` for an Agent tool name), registered
 *   or leftover, merged or not, under the same uncommitted/unpushed checks and
 *   with no recency or running-app guard (it is the caller's own choice);
 * - stops app instances recorded inside each removed folder first;
 * - prunes stale worktree registrations and reports the disk freed.
 * Other registered `.claude/worktrees/` (desktop sessions) and worktrees
 * elsewhere are only reported. Branches are kept.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AGENT_DIR,
  AGENT_TOOL_NAME,
  CLAUDE_DIR,
  folderSize,
  formatBytes,
  git,
  lastActivity,
  mainCheckout,
  parseWorktreeList,
  pathKey,
  RECENT_MS,
  refExists,
  SLUG,
  stateIsLive,
  tryGit,
} from "./lib.mjs";

const SCRIPT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const USAGE = [
  "Usage: pnpm worktree:clean [--dry-run] [--merged] [--include-recent] [--yes] [--force]",
  "       pnpm worktree:clean <slug>... [--dry-run] [--yes] [--force]",
  "A slug names .agent/worktrees/<slug>, or .claude/worktrees/<slug> for an Agent tool agent-<hex>.",
].join("\n");

export function parseArgs(argv) {
  const opts = {
    yes: false,
    dryRun: false,
    merged: false,
    force: false,
    includeRecent: false,
    slugs: [],
  };
  for (const arg of argv) {
    if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--merged") opts.merged = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--include-recent") opts.includeRecent = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    else if (!SLUG.test(arg)) throw new Error(`Not a worktree slug: ${arg}\n${USAGE}`);
    else if (!opts.slugs.includes(arg)) opts.slugs.push(arg);
  }
  if (opts.merged && opts.slugs.length) {
    throw new Error(`Pass slugs or --merged, not both.\n${USAGE}`);
  }
  // Deleting needs an explicit --yes, and --dry-run always wins.
  opts.apply = opts.yes && !opts.dryRun;
  return opts;
}

/**
 * What a folder directly under AGENT_DIR or CLAUDE_DIR is. `entry` is its
 * `git worktree list` record, if registered. Claude Code's Agent tool names its
 * isolated worktrees `agent-<hex>`; --merged cleans those like agent worktrees.
 * Other `.claude/worktrees/` entries are desktop sessions and only reported.
 */
export function classify(area, name, entry, opts) {
  if (!entry) return "leftover";
  if (area === AGENT_DIR) return "agent";
  return opts.merged && AGENT_TOOL_NAME.test(name) ? "agent" : "claude";
}

/**
 * The folder a slug names: `.agent/worktrees/<slug>`, or for an Agent tool
 * name with no such folder, `.claude/worktrees/<slug>`. Other `.claude/worktrees/`
 * entries (desktop sessions) can't be named.
 */
export function slugPath(root, slug, exists = existsSync) {
  const agent = join(root, AGENT_DIR, slug);
  if (!AGENT_TOOL_NAME.test(slug) || exists(agent)) return agent;
  return join(root, CLAUDE_DIR, slug);
}

/**
 * Decide what to do with one folder or worktree.
 * item: { kind: "leftover" | "agent" | "claude" | "missing" | "other", hasGit?,
 *         targeted?, current?, locked?, dirty?, statusError?, merged?, unpushed?,
 *         liveApps?, recent? }
 * `targeted` items were named on the command line, so they need not be merged
 * and skip the guards for worktrees another run may still be using.
 */
export function decide(item, opts) {
  const keep = (reason) => ({ action: "keep", reason });
  const remove = (reason) => ({ action: "remove", reason });
  if (item.kind === "missing") {
    return {
      action: "skip",
      reason: item.registered ? "folder is gone; prune clears its registration" : "no such folder",
    };
  }
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
  if (!item.targeted) {
    if (!opts.merged)
      return keep(item.dirty ? "uncommitted changes" : "clean; --merged checks whether it merged");
    if (!item.merged) return keep("not merged into the base branch");
    // Another run may still be using it, so --force overrides neither guard.
    if (item.liveApps?.length) {
      return keep(`app instance ${item.liveApps.join(", ")} is running in it`);
    }
    if (item.recent && !opts.includeRecent) {
      return keep(
        "active in the last 12 hours, maybe by another run (--include-recent removes it)",
      );
    }
  }
  const what = item.targeted ? "named" : (item.mergedVia ?? "merged");
  if (item.dirty && !opts.force)
    return keep(`${what}, but has uncommitted changes (--force removes it)`);
  if (item.unpushed > 0 && !opts.force) {
    return keep(`${what}, but ${item.unpushed} commit(s) are on no remote (--force removes it)`);
  }
  return remove(item.dirty || item.unpushed > 0 ? `${what} (--force)` : `${what} and clean`);
}

/** Merged PRs and their head commits (one gh call); undefined when gh can't say. */
function mergedPrs(root) {
  const result = spawnSync(
    "gh",
    ["pr", "list", "--state", "merged", "--limit", "300", "--json", "headRefOid,number"],
    { cwd: root, encoding: "utf8", windowsHide: true, shell: false },
  );
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout)
      .filter((pr) => typeof pr.headRefOid === "string")
      .map((pr) => ({ number: pr.number, oid: pr.headRefOid }));
  } catch {
    return undefined;
  }
}

/**
 * Map each commit in a merged PR's head but not in `base` to that PR. Squash
 * merges leave a branch's commits out of main, and in the combined flow a
 * worker is merged into an integration branch that is then squash-merged, so
 * its HEAD is only inside that PR's head. One cat-file call keeps the heads
 * that exist locally and one log call walks them all.
 */
export function mergedPrCommits(prs, base, root) {
  const commits = new Map();
  const numbers = new Map(prs.map((pr) => [pr.oid, pr.number]));
  if (!numbers.size) return commits;
  const lines = (values) => `${values.join("\n")}\n`;
  const check = tryGit(["cat-file", "--batch-check"], root, lines([...numbers.keys()]));
  const local = check.out
    .split(/\r?\n/)
    .map((line) => line.split(" "))
    .filter(([oid, type]) => type === "commit" && numbers.has(oid))
    .map(([oid]) => oid);
  if (!local.length) return commits;
  // %S is the PR head (given on stdin) the walk reached each commit from.
  const log = tryGit(
    ["log", "--stdin", "--source", "--no-show-signature", "--format=%H %S"],
    root,
    lines([...local, `^${base}`]),
  );
  for (const line of log.out.split(/\r?\n/)) {
    const match = /^([0-9a-f]{40,64}) ([0-9a-f]{40,64})$/.exec(line);
    if (match) commits.set(match[1], { number: numbers.get(match[2]), oid: match[2] });
  }
  return commits;
}

/** Whether HEAD is in `base` or in a merged PR's head; `via` names the PR. */
export function mergeState(head, ctx) {
  if (tryGit(["merge-base", "--is-ancestor", head, ctx.base], ctx.root).ok) return { merged: true };
  const pr = ctx.prCommits?.get(head);
  if (pr && tryGit(["merge-base", "--is-ancestor", head, pr.oid], ctx.root).ok) {
    return { merged: true, via: `merged via PR #${pr.number}` };
  }
  return { merged: false };
}

function inspectWorktree(entry, ctx, targeted = false) {
  const item = {
    kind: "agent",
    path: entry.path,
    branch: entry.branch ?? "(detached)",
    locked: entry.locked,
    targeted,
  };
  item.current = pathKey(entry.path) === ctx.current;
  if (ctx.opts.merged && !targeted) {
    // Read activity before anything here could touch the index.
    const gitDir = tryGit(["rev-parse", "--absolute-git-dir"], entry.path);
    const last = lastActivity(entry.path, gitDir.ok ? gitDir.out.trim() : undefined);
    item.recent = last === undefined || ctx.now - last < RECENT_MS;
    item.liveApps = recordedInstances(entry.path)
      .filter((instance) => stateIsLive(join(instance.state, `${instance.mode}.json`)))
      .map((instance) => `${instance.name} (${instance.mode})`);
  }
  // --no-optional-locks keeps status from rewriting the index, which would look like activity.
  const status = tryGit(["--no-optional-locks", "status", "--porcelain"], entry.path);
  if (!status.ok) {
    item.statusError = status.err.split("\n")[0] || "git status failed";
    return item;
  }
  item.dirty = status.out.trim() !== "";
  if (ctx.opts.merged || targeted) {
    const state = mergeState(entry.head, ctx);
    item.merged = state.merged;
    item.mergedVia = state.via;
    // A merged PR's head was on the remote even if its branch has since been deleted.
    const count = tryGit(
      ["rev-list", "--count", entry.head, "--not", "--remotes", ctx.base],
      ctx.root,
    );
    item.unpushed = state.via ? 0 : Number.parseInt(count.out, 10) || 0;
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

/**
 * Everything to decide on: the folders named by slug (see slugPath), or
 * every folder in both areas. `claudeKept` counts registered `.claude/worktrees/`
 * entries that are only reported.
 */
function collectItems(worktrees, ctx) {
  const registered = new Map(worktrees.map((entry) => [pathKey(entry.path), entry]));
  const items = [];
  let claudeKept = 0;
  if (ctx.opts.slugs.length) {
    for (const slug of ctx.opts.slugs) {
      const path = slugPath(ctx.root, slug);
      const entry = registered.get(pathKey(path));
      if (!existsSync(path)) items.push({ kind: "missing", path, registered: Boolean(entry) });
      else if (entry) items.push(inspectWorktree(entry, ctx, true));
      else items.push({ kind: "leftover", path, hasGit: existsSync(join(path, ".git")) });
    }
    return { items, claudeKept };
  }
  for (const area of [AGENT_DIR, CLAUDE_DIR]) {
    const dir = join(ctx.root, area);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const path = join(dir, name.name);
      const entry = registered.get(pathKey(path));
      const kind = classify(area, name.name, entry, ctx.opts);
      if (kind === "leftover") items.push({ kind, path, hasGit: existsSync(join(path, ".git")) });
      else if (kind === "agent") items.push(inspectWorktree(entry, ctx));
      else claudeKept++;
    }
  }
  return { items, claudeKept };
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
  const prs = opts.merged ? mergedPrs(root) : undefined;
  const prCommits = prs ? mergedPrCommits(prs, base, root) : undefined;
  const ctx = { opts, root, current, base, prCommits, now: Date.now() };

  const worktrees = parseWorktreeList(git(["worktree", "list", "--porcelain"], root));
  const { items, claudeKept } = collectItems(worktrees, ctx);
  const areas = [AGENT_DIR, CLAUDE_DIR].map((area) => `${pathKey(join(root, area))}/`);
  const named = opts.slugs.length > 0;
  const others = named
    ? []
    : worktrees.filter(
        (entry, index) =>
          index > 0 &&
          !entry.prunable &&
          !areas.some((area) => pathKey(entry.path).startsWith(area)),
      );
  const pruneRun = tryGit(["worktree", "prune", "--dry-run", "--verbose"], root);
  const prune = `${pruneRun.out}\n${pruneRun.err}`
    .split(/\r?\n/)
    .filter((line) => /^Removing /.test(line));

  console.log(
    `worktree:clean: ${opts.apply ? "removing" : "dry run, pass --yes to remove"} (main checkout ${root})`,
  );
  if (opts.merged && !prs)
    console.log("  note    gh is unavailable, so squash-merged branches are not detected");
  const show = (path) => relative(root, path).replace(/\\/g, "/") || path;
  let freed = 0;
  let failures = 0;
  for (const item of items) {
    const decision = decide(item, opts);
    const label = item.branch ? `${show(item.path)} [${item.branch}]` : show(item.path);
    if (decision.action !== "remove") {
      console.log(`  ${decision.action.padEnd(7)} ${label}: ${decision.reason}`);
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
  if (claudeKept) {
    const which = opts.merged ? "desktop session" : "registered";
    const hint = opts.merged ? "" : " (--merged also checks agent-<hex> ones)";
    console.log(
      `  report  ${CLAUDE_DIR}: ${claudeKept} ${which} worktree(s), managed by Claude Code; left alone${hint}`,
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
