#!/usr/bin/env node
/** Conservative CI selection and required-check verification. */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DOC_ROOTS = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
]);
const JOB_GROUPS = {
  frontend: ["frontend_build", "frontend_test"],
  // Anything that ships in the app: desktop tests and the installed-app journeys.
  desktop: ["desktop_test", "automation_contracts", "desktop_e2e"],
  rust: ["rust"],
  dependencies: ["security"],
};
// Paths the Rust workspace never reads. Anything else (crates, workflows,
// scripts, unknown files) keeps the three-OS Rust matrix.
const RUST_FREE_PREFIXES = ["site/", "apps/desktop/", "apps/cli/", "packages/", "tests/e2e/"];
const RUST_FREE_FILES = new Set(["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"]);
// Crates embed or verify these frontend files (include_str!, generated bindings).
const RUST_INPUT_PREFIXES = [
  "apps/desktop/src-tauri/",
  "packages/types/data/",
  "packages/types/src/generated/",
  "packages/client/src/generated/",
];
const RUST_INPUT_FILES = new Set([
  "packages/types/src/pricing-data.json",
  "packages/types/src/claude-code-pricing-data.json",
  "packages/types/src/known-events.ts",
  "packages/types/src/defaults.ts",
]);
// Lockfiles and manifests the dependency audits read, plus the audit job itself.
const DEPENDENCY_INPUT =
  /(?:^|\/)(?:Cargo\.toml|Cargo\.lock|package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|deny\.toml|\.npmrc)$|^\.cargo\/audit\.toml$|^\.github\/workflows\/ci\.yml$/;

function isDocumentation(path) {
  return DOC_ROOTS.has(path) || /^docs\/.*\.(?:md|png|jpe?g|svg|gif|webp)$/i.test(path);
}

function isRustFree(path) {
  if (isDocumentation(path)) return true;
  if (RUST_INPUT_FILES.has(path) || RUST_INPUT_PREFIXES.some((prefix) => path.startsWith(prefix)))
    return false;
  return RUST_FREE_FILES.has(path) || RUST_FREE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function classifyChanges(paths, eventName) {
  // The daily schedule exists to catch new advisories; only the audits run.
  if (eventName === "schedule") {
    return { frontend: false, desktop: false, rust: false, dependencies: true };
  }
  // Main always exercises the full application. Empty/unknown diffs fail open.
  if (eventName !== "pull_request" || paths.length === 0) {
    return { frontend: true, desktop: true, rust: true, dependencies: true };
  }
  const docsOnly = paths.every(isDocumentation);
  const siteOrDocsOnly = paths.every((path) => isDocumentation(path) || path.startsWith("site/"));
  return {
    frontend: !docsOnly,
    desktop: !siteOrDocsOnly,
    rust: !paths.every(isRustFree),
    dependencies: paths.some((path) => DEPENDENCY_INPUT.test(path)),
  };
}

export function verifyRequired(needs) {
  const errors = [];
  for (const job of ["changes", "policy"]) {
    if (needs[job]?.result !== "success")
      errors.push(`${job}: expected success, got ${needs[job]?.result ?? "missing"}`);
  }
  for (const [group, jobs] of Object.entries(JOB_GROUPS)) {
    const selected = needs.changes?.outputs?.[group];
    if (selected !== "true" && selected !== "false") {
      errors.push(`${group}: missing or invalid change classification`);
      continue;
    }
    const expected = selected === "true" ? "success" : "skipped";
    for (const job of jobs) {
      if (needs[job]?.result !== expected)
        errors.push(`${job}: expected ${expected}, got ${needs[job]?.result ?? "missing"}`);
    }
  }
  return errors;
}

function main() {
  if (process.argv.includes("--verify-required")) {
    const errors = verifyRequired(JSON.parse(process.env.CI_NEEDS));
    for (const error of errors) console.error(`::error::${error}`);
    if (errors.length) process.exitCode = 1;
    else console.log("All selected CI jobs passed; only unselected jobs were skipped.");
    return;
  }
  let paths = [];
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const head = event.pull_request?.head?.sha;
    if (!/^[a-f0-9]{40}$/.test(head ?? "")) throw new Error("Missing pull request head SHA");
    const parents = execFileSync("git", ["show", "--format=%P", "--no-patch", "HEAD"], {
      encoding: "utf8",
    })
      .trim()
      .split(" ");
    if (parents.length !== 2 || parents[1] !== head || !/^[a-f0-9]{40}$/.test(parents[0])) {
      throw new Error("Checkout is not the expected pull request merge commit");
    }
    // The merge's first parent is the actual tested base (fetch-depth: 2).
    // event.base.sha can lag a main update and include unrelated base changes.
    // Disable rename detection so moves out of application paths cannot hide them.
    paths = execFileSync(
      "git",
      ["diff", "--no-renames", "--name-only", "-z", `${parents[0]}..HEAD`],
      {
        encoding: "utf8",
      },
    )
      .split("\0")
      .filter(Boolean);
  }
  const selection = classifyChanges(paths, process.env.GITHUB_EVENT_NAME);
  console.log(JSON.stringify({ changedFiles: paths.length, ...selection }));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(selection)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
