#!/usr/bin/env node
/**
 * Run only the checks that match the files you changed.
 *
 * Usage: pnpm check:changed [--base <ref>] [--dry-run] [--max-workers <n>]
 *
 * Changed files are the diff against the merge-base with origin/main (falling
 * back to main), plus staged, unstaged and untracked files. Each path is mapped
 * to the rows of the "Verify proportionately" table in docs/agents/protocol.md
 * by RULES below. Every step prints one PASS/FAIL line; a failing step also
 * prints the tail of its output. Exits 1 when any step fails. Advisory HINT
 * lines (check-changed-hints.mjs) name slower checks a change likely affects.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectHints, NOTES } from "./check-changed-hints.mjs";

export { NOTES };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAIL_LINES = 40;

const BIOME_EXT = /\.(?:[cm]?js|jsx|ts|tsx|vue|css|json|jsonc)$/;
const SIZE_EXT = /\.(?:rs|vue|ts|tsx|js|mjs)$/;
const NOT_DOCS = (path) => !path.endsWith(".md");
// Workspace packages whose vitest suite runs in full when they change. The
// desktop app instead runs only the tests related to the changed files.
const PACKAGE_TESTS = {
  "packages/ui/": "@tracepilot/ui",
  "packages/client/": "@tracepilot/client",
  "packages/types/": "@tracepilot/types",
  "apps/cli/": "@tracepilot/cli",
};
// Workspace packages (and their dependents) whose typecheck a change affects.
const TYPECHECK_PACKAGES = {
  "apps/desktop/": "@tracepilot/desktop",
  "apps/cli/": "@tracepilot/cli",
  "packages/ui/": "@tracepilot/ui",
  "packages/client/": "@tracepilot/client",
  "packages/types/": "@tracepilot/types",
  "packages/config/": "@tracepilot/config",
  "packages/test-utils/": "@tracepilot/test-utils",
};
// Desktop files whose change can affect any test, so vitest runs in full.
const DESKTOP_CONFIG =
  /^apps\/desktop\/(?:package\.json|vite(?:st)?\.config\.\w+|tsconfig[\w.]*\.json)$/;
// Cheap read-only policy checks, keyed by the paths that can break them.
const POLICY_CHECKS = [
  { name: "check-adr", match: /^docs\/adr\//, script: ["scripts/check-adr.mjs"] },
  {
    name: "check-workflow-actions",
    match: /^\.github\/(?:workflows|actions)\//,
    script: ["scripts/check-workflow-actions.mjs"],
  },
  {
    name: "check-public-api",
    match: /^crates\/tracepilot-orchestrator\/src\//,
    script: ["scripts/check-public-api.mjs"],
  },
  {
    name: "check-csp",
    match: /^apps\/desktop\/src-tauri\/(?:tauri\.conf\.json|capabilities\/)/,
    script: ["scripts/check-csp.mjs"],
  },
  {
    name: "check-catalog-drift",
    match: /(?:^|\/)package\.json$|^pnpm-workspace\.yaml$/,
    script: ["scripts/check-catalog-drift.mjs"],
  },
  {
    name: "changelog fragments",
    match: /^changelog\.d\//,
    script: ["scripts/release/collect-changelog.mjs", "--check"],
  },
  {
    name: "check-scripts-index",
    match: /^scripts\/|^package\.json$/,
    script: ["scripts/check-scripts-index.mjs"],
  },
];
// Script groups whose tests need something the plain run doesn't provide.
const NODE_TEST_GROUPS = {
  automation: { args: ["--test-concurrency=1"] },
  cli: {
    skip: "needs a built CLI: pnpm build:cli, then node --test scripts/cli/cli-smoke.test.mjs",
  },
  visual: {
    needs: "scripts/visual/node_modules",
    hint: "npm ci --prefix scripts/visual --ignore-scripts",
  },
};
// The CI change classifier's tests read crate sources and the shared frontend
// files crates embed (`include_str!`), so they run when either changes.
const CI_TEST_INPUTS = /^(?:crates|packages\/types)\//;

const node = (...args) => ({ cmd: "node", args });
const pnpm = (...args) => ({ cmd: "pnpm", args });
const cargo = (...args) => ({ cmd: "cargo", args });
const under = (prefixes, path) => Object.keys(prefixes).find((prefix) => path.startsWith(prefix));

/**
 * Each rule selects the changed files it cares about and turns them into
 * steps. Rules run in this order, cheapest first.
 */
export const RULES = [
  {
    id: "biome",
    match: (f) => !f.deleted && BIOME_EXT.test(f.path),
    steps: (files) => [
      {
        name: "biome",
        ...pnpm(
          "exec",
          "biome",
          "check",
          "--error-on-warnings",
          "--no-errors-on-unmatched",
          "--files-ignore-unknown=true",
          ...files.map((f) => f.path),
        ),
      },
    ],
  },
  {
    id: "file-sizes",
    match: (f) => SIZE_EXT.test(f.path),
    steps: () => [{ name: "file sizes", ...node("scripts/check-file-sizes.mjs") }],
  },
  {
    id: "doc-links",
    match: (f) => f.path.endsWith(".md"),
    steps: (files) => {
      // A deleted or renamed page can break links anywhere, so check them all.
      const all = files.some((f) => f.deleted);
      const paths = all ? [] : files.map((f) => f.path);
      return [
        {
          name: all ? "doc links (all)" : "doc links",
          ...node("scripts/check-doc-links.mjs", ...paths),
        },
      ];
    },
  },
  {
    id: "design-system",
    match: (f) => /^(?:apps|packages)\//.test(f.path) && /\.(?:vue|css|scss)$/.test(f.path),
    steps: () => [{ name: "design system", ...pnpm("check:design-system") }],
  },
  {
    id: "policy",
    match: (f) => POLICY_CHECKS.some((check) => check.match.test(f.path)),
    steps: (files) =>
      POLICY_CHECKS.filter((check) => files.some((f) => check.match.test(f.path))).map((check) => ({
        name: check.name,
        ...node(...check.script),
      })),
  },
  {
    id: "node-tests",
    match: (f) =>
      NOT_DOCS(f.path) &&
      (/^scripts\//.test(f.path) ||
        /^packages\/ui\/src\/components\/renderers\//.test(f.path) ||
        CI_TEST_INPUTS.test(f.path)),
    steps: (files, ctx) => nodeTestSteps(files, ctx),
  },
  {
    id: "typecheck",
    match: (f) => NOT_DOCS(f.path) && under(TYPECHECK_PACKAGES, f.path) !== undefined,
    steps: (files) => {
      const pkgs = [
        ...new Set(files.map((f) => TYPECHECK_PACKAGES[under(TYPECHECK_PACKAGES, f.path)])),
      ];
      // `...pkg` selects the package and every workspace package that depends on it.
      const filters = pkgs.sort().flatMap((pkg) => ["--filter", `...${pkg}`]);
      return [{ name: "typecheck", ...pnpm("--workspace-concurrency=2", ...filters, "typecheck") }];
    },
  },
  {
    id: "package-tests",
    match: (f) =>
      NOT_DOCS(f.path) &&
      (under(PACKAGE_TESTS, f.path) !== undefined || f.path.startsWith("site/")),
    steps: (files, ctx) => {
      const steps = [];
      for (const [prefix, pkg] of Object.entries(PACKAGE_TESTS)) {
        if (!files.some((f) => f.path.startsWith(prefix))) continue;
        const workers = `--maxWorkers=${ctx.maxWorkers}`;
        steps.push({
          name: `${pkg} tests`,
          ...pnpm("--filter", pkg, "exec", "vitest", "run", workers),
        });
      }
      if (files.some((f) => f.path.startsWith("site/"))) {
        steps.push({
          name: "@tracepilot/site tests",
          ...pnpm("--filter", "@tracepilot/site", "test"),
        });
      }
      return steps;
    },
  },
  {
    id: "desktop-tests",
    match: (f) =>
      f.path.startsWith("apps/desktop/") &&
      !f.path.startsWith("apps/desktop/src-tauri/") &&
      NOT_DOCS(f.path),
    steps: (files, ctx) => {
      const workers = `--maxWorkers=${ctx.maxWorkers}`;
      const filter = ["--filter", "@tracepilot/desktop", "exec", "vitest"];
      if (files.some((f) => DESKTOP_CONFIG.test(f.path))) {
        return [{ name: "desktop tests (all)", ...pnpm(...filter, "run", workers) }];
      }
      const paths = files
        .filter((f) => !f.deleted && f.path.startsWith("apps/desktop/src/"))
        .map((f) => f.path.slice("apps/desktop/".length));
      if (paths.length === 0) return [];
      return [
        {
          name: "desktop tests (related)",
          ...pnpm(...filter, "related", "--run", workers, ...paths),
        },
      ];
    },
  },
  {
    id: "rust",
    match: (f) => NOT_DOCS(f.path) && crateFor(f.path, {}) !== undefined,
    steps: (files, ctx) => {
      const crates = [
        ...new Set(files.map((f) => crateFor(f.path, ctx.crates)).filter(Boolean)),
      ].sort();
      const steps = [];
      if (files.some((f) => f.path.endsWith(".rs"))) {
        steps.push({ name: "cargo fmt", ...cargo("fmt", "--all", "--", "--check") });
      }
      if (crates.length === 0) return steps;
      const select = crates.flatMap((crate) => ["-p", crate]);
      steps.push({
        name: `cargo clippy ${crates.join(" ")}`,
        ...cargo("clippy", ...select, "--all-targets", "-j", "6", "--", "-D", "warnings"),
      });
      steps.push({
        name: `cargo test ${crates.join(" ")}`,
        ...cargo("test", ...select, "-j", "6"),
      });
      return steps;
    },
  },
];

/** `crates/<dir>/...` and the desktop crate map to a Cargo package name. */
export function crateFor(path, crates) {
  const match = /^(crates\/[^/]+|apps\/desktop\/src-tauri)\//.exec(path);
  if (!match) return undefined;
  return crates[match[1]] ?? match[1];
}

function nodeTestSteps(files, ctx) {
  const groups = new Set();
  const topLevel = new Set();
  for (const { path } of files) {
    if (CI_TEST_INPUTS.test(path)) {
      groups.add("ci");
      continue;
    }
    if (
      path.startsWith("packages/ui/src/components/renderers/") ||
      path.startsWith("scripts/fixtures/")
    ) {
      groups.add("fixtures");
      groups.add("visual");
      continue;
    }
    const parts = path.split("/");
    if (parts.length > 2) groups.add(parts[1]);
    else if (/\.m?js$/.test(path)) topLevel.add(path.replace(/(?:\.test)?\.mjs$/, ".test.mjs"));
  }
  const steps = [];
  for (const group of [...groups].sort()) {
    const tests = ctx.testFiles(`scripts/${group}`);
    if (tests.length === 0) continue;
    const config = NODE_TEST_GROUPS[group] ?? {};
    const step = {
      name: `node --test scripts/${group}`,
      ...node("--test", ...(config.args ?? []), ...tests),
    };
    if (config.skip) step.skip = config.skip;
    else if (config.needs && !ctx.exists(config.needs)) step.skip = `run \`${config.hint}\` first`;
    steps.push(step);
  }
  const tests = [...topLevel].filter((path) => ctx.exists(path)).sort();
  if (tests.length)
    steps.push({ name: "node --test scripts/*.test.mjs", ...node("--test", ...tests) });
  return steps;
}

/** Map changed files to an ordered list of steps plus advisory notes. */
export function planChecks(paths, ctx) {
  const files = paths.map((path) => ({ path, deleted: !ctx.exists(path) }));
  const steps = [];
  for (const rule of RULES) {
    const matched = files.filter(rule.match);
    if (matched.length) steps.push(...rule.steps(matched, ctx));
  }
  const notes = NOTES.filter((note) => files.some(note.match)).map((note) => note.text);
  return { steps, notes };
}

export function parseArgs(argv) {
  const opts = {
    base: undefined,
    dryRun: false,
    maxWorkers: process.env.CHECK_CHANGED_MAX_WORKERS ?? "2",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--base") opts.base = argv[++i];
    else if (arg.startsWith("--base=")) opts.base = arg.slice("--base=".length);
    else if (arg === "--max-workers") opts.maxWorkers = argv[++i];
    else if (arg.startsWith("--max-workers=")) opts.maxWorkers = arg.slice("--max-workers=".length);
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (opts.base === undefined && argv.includes("--base")) throw new Error("--base needs a ref");
  if (!/^[1-9]\d*$/.test(String(opts.maxWorkers)))
    throw new Error("--max-workers must be a positive integer");
  return opts;
}

/** The last `count` non-empty-trailing lines of some output. */
export function tail(text, count = TAIL_LINES) {
  const lines = text.replace(/\s+$/, "").split(/\r?\n/);
  return lines.slice(-count);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function refExists(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export function changedFiles(base) {
  const ref = base ?? (refExists("origin/main") ? "origin/main" : "main");
  if (!refExists(ref)) throw new Error(`Base ref not found: ${ref}`);
  const mergeBase = git(["merge-base", "HEAD", ref]).trim();
  const split = (out) => out.split("\0").filter(Boolean);
  const paths = new Set([
    ...split(git(["diff", "--name-only", "--no-renames", "-z", mergeBase])),
    ...split(git(["ls-files", "--others", "--exclude-standard", "-z"])),
  ]);
  // Nested worktrees and agent scratch space are never part of the change.
  const files = [...paths].filter((path) => !/^\.(?:agent|claude\/worktrees)\//.test(path)).sort();
  return { ref, mergeBase, files };
}

function workspaceCrates() {
  const crates = {};
  const dirs = readdirSync(join(ROOT, "crates")).map((dir) => `crates/${dir}`);
  for (const dir of [...dirs, "apps/desktop/src-tauri"]) {
    try {
      const toml = readFileSync(join(ROOT, dir, "Cargo.toml"), "utf8");
      const name = /^\[package\][^[]*?^name\s*=\s*"([^"]+)"/ms.exec(toml)?.[1];
      if (name) crates[dir] = name;
    } catch {
      // Not a crate.
    }
  }
  return crates;
}

function testFiles(dir) {
  try {
    return readdirSync(join(ROOT, dir))
      .filter((name) => name.endsWith(".test.mjs"))
      .sort()
      .map((name) => `${dir}/${name}`);
  } catch {
    return [];
  }
}

/** Resolve a step to a spawnable command without going through a shell. */
function resolveCommand(step) {
  if (step.cmd === "node") return [process.execPath, step.args];
  const execPath = process.env.npm_execpath;
  if (step.cmd === "pnpm" && execPath && /pnpm/i.test(execPath) && /\.[cm]?js$/.test(execPath)) {
    return [process.execPath, [execPath, ...step.args]];
  }
  if (step.cmd === "pnpm" && process.platform === "win32") return ["pnpm.cmd", step.args];
  return [step.cmd, step.args];
}

function display(step) {
  return [step.cmd, ...step.args].map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ");
}

function runStep(step) {
  const [cmd, args] = resolveCommand(step);
  const started = Date.now();
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: cmd.endsWith(".cmd"),
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) =>
      resolve({ ok: false, output: `${output}${error.message}\n`, started }),
    );
    child.on("close", (code) => resolve({ ok: code === 0, output, started }));
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: pnpm check:changed [--base <ref>] [--dry-run] [--max-workers <n>]");
    return;
  }
  const { ref, mergeBase, files } = changedFiles(opts.base);
  const ctx = {
    crates: workspaceCrates(),
    exists: (path) => existsSync(join(ROOT, path)),
    maxWorkers: opts.maxWorkers,
    testFiles,
  };
  const { steps, notes } = planChecks(files, ctx);
  console.log(
    `check:changed: ${files.length} changed file(s) vs ${ref} (merge-base ${mergeBase.slice(0, 8)}), ${steps.length} step(s)`,
  );
  if (opts.dryRun) {
    for (const step of steps) console.log(`  ${step.skip ? "skip" : "run "}  ${display(step)}`);
    for (const step of steps.filter((s) => s.skip))
      console.log(`  note  ${step.name}: ${step.skip}`);
  }
  for (const note of notes) console.log(`  note  ${note}`);
  // Advisory only: hints never fail the run. Printed last so they stay visible.
  const hints = await collectHints({ root: ROOT, mergeBase, files });
  const printHints = () => {
    for (const hint of hints) console.log(`HINT  ${hint}`);
  };
  if (opts.dryRun) return printHints();

  let failed = 0;
  for (const step of steps) {
    if (step.skip) {
      console.log(`SKIP  ${step.name}: ${step.skip}`);
      continue;
    }
    const { ok, output, started } = await runStep(step);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${ok ? "PASS" : "FAIL"}  ${step.name} (${seconds}s)`);
    if (!ok) {
      failed++;
      console.log(`      $ ${display(step)}`);
      for (const line of tail(output)) console.log(`      ${line}`);
    }
  }
  if (failed) {
    console.log(`${failed} of ${steps.length} step(s) failed.`);
    process.exitCode = 1;
  } else if (steps.length === 0) {
    console.log("Nothing to check.");
  }
  printHints();
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`check:changed: ${error.message}`);
    process.exitCode = 2;
  });
}
