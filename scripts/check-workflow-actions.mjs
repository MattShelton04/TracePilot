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
const USES_RX = /^\s*(?:-\s*)?uses:\s*([^@\s]+)@([^\s#]+)(?:\s+#\s*(.+))?\s*$/;
const WANT_REMOTE = process.argv.includes("--verify-remote");

function workflowFiles() {
  if (!existsSync(WORKFLOWS_DIR)) return [];
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(WORKFLOWS_DIR, name))
    .sort();
}

function collectUses() {
  const refs = [];
  const errors = [];

  for (const file of workflowFiles()) {
    const rel = `.github/workflows/${basename(file)}`;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    for (const [idx, line] of lines.entries()) {
      if (!line.includes("uses:")) continue;
      const match = line.match(USES_RX);
      if (!match) {
        errors.push(`${rel}:${idx + 1}: unable to parse uses reference`);
        continue;
      }

      const [, ownerRepo, ref, comment] = match;
      if (!FULL_SHA.test(ref)) {
        errors.push(`${rel}:${idx + 1}: ${ownerRepo}@${ref} is not pinned to a full commit SHA`);
        continue;
      }

      if (!comment || comment.trim().length === 0) {
        errors.push(
          `${rel}:${idx + 1}: ${ownerRepo}@${ref} is missing an informational version comment`,
        );
      }

      refs.push({ file: rel, line: idx + 1, ownerRepo, ref });
    }
  }

  return { refs, errors };
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
          reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`));
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
