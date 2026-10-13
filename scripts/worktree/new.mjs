#!/usr/bin/env node
/**
 * Create an agent worktree with dependencies installed.
 *
 * Usage: pnpm worktree:new <slug> [--base origin/main] [--branch <type>/<slug>] [--no-install]
 *
 * Creates `.agent/worktrees/<slug>` in the main checkout on a new branch
 * (default `agent/<slug>`; an existing local branch is checked out instead),
 * runs `pnpm install --frozen-lockfile --prefer-offline` there, and prints the
 * matching app instance command. The slug is also the app instance name.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_DIR, mainCheckout, pnpmCommand, refExists, SLUG, tryGit } from "./lib.mjs";

const USAGE =
  "Usage: pnpm worktree:new <slug> [--base origin/main] [--branch <type>/<slug>] [--no-install]";

export function parseArgs(argv) {
  const opts = { slug: undefined, base: undefined, branch: undefined, install: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--base") opts.base = value();
    else if (arg === "--branch") opts.branch = value();
    else if (arg === "--no-install") opts.install = false;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
    else if (opts.slug) throw new Error(`Unexpected argument: ${arg}`);
    else opts.slug = arg;
  }
  if (opts.help) return opts;
  if (!opts.slug) throw new Error(USAGE);
  if (!SLUG.test(opts.slug)) {
    throw new Error(
      "The slug must be 1-32 lowercase letters, digits or hyphens, starting with a letter or digit.",
    );
  }
  opts.branch ??= `agent/${opts.slug}`;
  return opts;
}

/** Pick the base ref, fetching origin first; fall back to what exists locally. */
function resolveBase(requested, root) {
  const base = requested ?? "origin/main";
  const remote = /^origin\/(.+)$/.exec(base);
  if (remote) {
    const fetched = tryGit(["fetch", "--quiet", "origin", remote[1]], root);
    if (!fetched.ok) {
      console.warn(
        `warning: git fetch origin ${remote[1]} failed; using the last fetched ${base}.`,
      );
      if (!refExists(base, root) && refExists(remote[1], root)) {
        console.warn(`warning: ${base} is unknown; branching from local ${remote[1]} instead.`);
        return remote[1];
      }
    }
  }
  if (!refExists(base, root)) throw new Error(`Base ref not found: ${base}`);
  return base;
}

function install(path) {
  const { cmd, args, shell } = pnpmCommand(["install", "--frozen-lockfile", "--prefer-offline"]);
  console.log(`Installing dependencies in ${path} ...`);
  const result = spawnSync(cmd, args, { cwd: path, stdio: "inherit", shell, windowsHide: true });
  return result.status === 0;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const root = mainCheckout(process.cwd());
  const path = join(root, AGENT_DIR, opts.slug);
  if (existsSync(path)) {
    throw new Error(
      `${path} already exists. Reuse it, or pick another slug (pnpm worktree:clean lists leftovers).`,
    );
  }
  if (!tryGit(["check-ref-format", "--branch", opts.branch], root).ok) {
    throw new Error(`Invalid branch name: ${opts.branch}`);
  }
  mkdirSync(join(root, AGENT_DIR), { recursive: true });

  const branchExists = refExists(`refs/heads/${opts.branch}`, root);
  const base = branchExists ? undefined : resolveBase(opts.base, root);
  const add = branchExists
    ? ["worktree", "add", path, opts.branch]
    : ["worktree", "add", "-b", opts.branch, path, base];
  const added = tryGit(add, root);
  if (!added.ok) throw new Error(`git ${add.join(" ")} failed:\n${added.err}`);
  const head = tryGit(["rev-parse", "--short", "HEAD"], path).out.trim();
  console.log(
    branchExists
      ? `Checked out existing branch ${opts.branch} @ ${head} in ${path}`
      : `Created ${opts.branch} from ${base} @ ${head} in ${path}`,
  );

  if (opts.install && !install(path)) {
    console.error(
      [
        "",
        "pnpm install failed. The worktree exists, but Biome, Vitest and hooks won't run until it succeeds.",
        "--prefer-offline only reuses packages already in the pnpm store. If you are offline or in a",
        "sandbox without network access, retry where the network is available:",
        `  cd ${path}`,
        "  pnpm install --frozen-lockfile",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    [
      "",
      `Worktree ready: ${path}`,
      `  cd ${path}`,
      `  pnpm app:start -Instance ${opts.slug} -Fixtures   # isolated app instance on synthetic data`,
      `  pnpm app:stop -Instance ${opts.slug}              # before removing the worktree`,
      "  pnpm check:changed                               # checks for what you changed",
      "  pnpm worktree:clean --merged                     # later, from any checkout: list merged worktrees",
      "",
      "Build notes: this worktree has its own Rust target/, so its first build compiles every",
      "dependency (sccache turns most of that into cache hits). Don't share CARGO_TARGET_DIR",
      "between worktrees. See docs/local-builds.md.",
    ].join("\n"),
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`worktree:new: ${error.message}`);
    process.exitCode = 1;
  }
}
