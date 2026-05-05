#!/usr/bin/env node
/**
 * GitHub Actions pinning guard.
 *
 * Ensures workflow `uses:` references are pinned to full 40-character SHAs.
 * With `--verify-remote`, each pin is also checked against GitHub's commit API
 * so annotated tag object SHAs are rejected in favor of commit SHAs.
 *
 * Usage:
 *   node scripts/check-workflow-actions.mjs
 *   node scripts/check-workflow-actions.mjs --verify-remote
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { request } from "node:https";
import { basename, join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
const FULL_SHA = /^[0-9a-f]{40}$/;
const USES_LINE_RX = /^\s*(?:-\s*)?uses:\s*(\S+)(?:\s+#\s*(.+))?\s*$/;
const THIRD_PARTY_RX = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@(.+)$/;
const WANT_SELF_TEST = process.argv.includes("--self-test");
const WANT_REMOTE = process.argv.includes("--verify-remote");

function workflowFiles(root = WORKFLOWS_DIR) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(root, name))
    .sort();
}

function parseUsesLine(line, rel, lineNumber) {
  const match = line.match(USES_LINE_RX);
  if (!match) return { ref: null, error: null };

  const [, target, comment] = match;
  if (target.startsWith("./") || target.startsWith("docker://")) return { ref: null, error: null };

  const thirdParty = target.match(THIRD_PARTY_RX);
  if (!thirdParty) {
    return { ref: null, error: `${rel}:${lineNumber}: unsupported uses reference ${target}` };
  }

  const ownerRepo = target.slice(0, target.lastIndexOf("@"));
  const ref = thirdParty[1];
  if (!FULL_SHA.test(ref)) {
    return {
      ref: null,
      error: `${rel}:${lineNumber}: ${ownerRepo}@${ref} is not pinned to a full commit SHA`,
    };
  }

  if (!comment || comment.trim().length === 0) {
    return {
      ref: null,
      error: `${rel}:${lineNumber}: ${ownerRepo}@${ref} is missing an informational version comment`,
    };
  }

  return { ref: { file: rel, line: lineNumber, ownerRepo, ref }, error: null };
}

function collectUses(files = workflowFiles()) {
  const refs = [];
  const errors = [];

  for (const file of files) {
    const rel = `.github/workflows/${basename(file)}`;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    for (const [idx, line] of lines.entries()) {
      const result = parseUsesLine(line, rel, idx + 1);
      if (result.error) errors.push(result.error);
      if (result.ref) refs.push(result.ref);
    }
  }

  return { refs, errors };
}

function selfTest() {
  const cases = [
    ["uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2", 1, 0],
    ["uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683", 0, 1],
    ["uses: actions/checkout@v4", 0, 1],
    ["uses: ./.github/actions/setup-foo", 0, 0],
    ["uses: ./.github/workflows/reusable.yml", 0, 0],
    ["uses: docker://alpine", 0, 0],
    ["# uses: actions/checkout@v4", 0, 0],
    ["run: echo uses: actions/checkout@v4", 0, 0],
  ];

  let failed = false;
  for (const [line, expectedRefs, expectedErrors] of cases) {
    const result = parseUsesLine(line, "self-test.yml", 1);
    const refCount = result.ref ? 1 : 0;
    const errorCount = result.error ? 1 : 0;
    if (refCount !== expectedRefs || errorCount !== expectedErrors) {
      console.error(
        `self-test failed for ${JSON.stringify(line)}: expected ${expectedRefs}/${expectedErrors}, got ${refCount}/${errorCount}`,
      );
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log("✓ workflow action pin guard self-test passed");
}

if (WANT_SELF_TEST) {
  selfTest();
  process.exit(0);
}

function githubJson(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "TracePilot workflow action pin guard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    const req = request({ hostname: "api.github.com", path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`);
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`invalid GitHub API JSON: ${err.message}`));
        }
      });
    });
    req.setTimeout(15_000, () => {
      req.destroy(new Error("GitHub API request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function verifyRemote(refs) {
  const unique = new Map();
  for (const ref of refs) unique.set(`${ref.ownerRepo}@${ref.ref}`, ref);

  const errors = [];
  for (const item of unique.values()) {
    try {
      const commit = await githubJson(`/repos/${item.ownerRepo}/commits/${item.ref}`);
      if (commit.sha !== item.ref) {
        errors.push(
          `${item.file}:${item.line}: ${item.ownerRepo}@${item.ref} did not resolve as that commit`,
        );
      }
    } catch (err) {
      if (err.statusCode === 403 && !process.env.GITHUB_TOKEN) {
        errors.push(
          `${item.file}:${item.line}: could not verify ${item.ownerRepo}@${item.ref}; set GITHUB_TOKEN to avoid GitHub API rate limits (${err.message})`,
        );
        continue;
      }
      errors.push(
        `${item.file}:${item.line}: ${item.ownerRepo}@${item.ref} is not a commit SHA (${err.message})`,
      );
    }
  }
  return errors;
}

const { refs, errors } = collectUses();
if (WANT_REMOTE) errors.push(...(await verifyRemote(refs)));

if (errors.length > 0) {
  console.error("✗ workflow action pin guard failed:");
  for (const err of errors) console.error(`  - ${err}`);
  console.error(
    "\nPin actions to commit SHAs and keep a version comment, e.g. `uses: owner/action@<40-char-sha> # vX.Y.Z`.",
  );
  process.exit(1);
}

const remoteSuffix = WANT_REMOTE ? " with remote commit verification" : "";
console.log(`✓ workflow action pins passed (${refs.length} use(s)${remoteSuffix})`);
