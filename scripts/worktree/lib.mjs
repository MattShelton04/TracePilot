/** Shared helpers for `pnpm worktree:new` and `pnpm worktree:clean`. */
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** Same rule as `pnpm app:start -Instance`, so the slug doubles as the instance name. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Agent worktrees live here, relative to the main checkout. */
export const AGENT_DIR = ".agent/worktrees";
/** Claude Code manages these; they are reported, and only leftovers are removed. */
export const CLAUDE_DIR = ".claude/worktrees";

export function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function tryGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  const err = result.error?.message ?? result.stderr ?? "";
  return { ok: result.status === 0, out: result.stdout ?? "", err: err.trim() };
}

/** Parse `git worktree list --porcelain` into one record per worktree. */
export function parseWorktreeList(text) {
  const worktrees = [];
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    const entry = {};
    for (const line of block.split("\n")) {
      const [key, ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (key === "worktree") entry.path = value;
      else if (key === "HEAD") entry.head = value;
      else if (key === "branch") entry.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "detached" || key === "bare") entry[key] = true;
      else if (key === "locked" || key === "prunable") entry[key] = value || true;
    }
    if (entry.path) worktrees.push(entry);
  }
  return worktrees;
}

/** Compare paths the way the filesystem does (case-insensitive on Windows). */
export function pathKey(path) {
  const normal = resolve(path).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normal.toLowerCase() : normal;
}

/** The main checkout, which owns `.agent/worktrees/`. */
export function mainCheckout(cwd) {
  const [main] = parseWorktreeList(git(["worktree", "list", "--porcelain"], cwd));
  if (!main) throw new Error("Not inside a git repository.");
  return resolve(main.path);
}

export function refExists(ref, cwd) {
  return tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd).ok;
}

/** Bytes used by a folder, without following symlinks or junctions. */
export function folderSize(path) {
  let total = 0;
  const stack = [path];
  while (stack.length) {
    const current = stack.pop();
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (!stat.isDirectory()) {
      total += stat.size;
      continue;
    }
    try {
      for (const name of readdirSync(current)) stack.push(join(current, name));
    } catch {
      // Unreadable folders count as empty.
    }
  }
  return total;
}

export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** pnpm without a shell: reuse the running pnpm when invoked through it. */
export function pnpmCommand(args) {
  const execPath = process.env.npm_execpath;
  if (execPath && /pnpm/i.test(execPath) && /\.[cm]?js$/.test(execPath)) {
    return { cmd: process.execPath, args: [execPath, ...args], shell: false };
  }
  return {
    cmd: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
    shell: process.platform === "win32",
  };
}
