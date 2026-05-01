#!/usr/bin/env node
/**
 * pnpm catalog drift gate for TracePilot.
 *
 * Two checks:
 *   1. HARD FAIL — every dep that is catalogued in `pnpm-workspace.yaml`
 *      (`catalog:` block) must be referenced as `"catalog:"` in every
 *      workspace `package.json` that depends on it. A direct version
 *      string for a catalogued dep is a regression.
 *   2. WARN ONLY — flag deps that appear in ≥2 package.json files at the
 *      same version and are NOT yet catalogued. These are candidates for
 *      hoisting into `pnpm-workspace.yaml`.
 *
 * Exits:
 *   0 on clean
 *   0 when only warnings are produced (warnings printed to stderr)
 *   1 on any hard failure.
 *
 * Scope: walks `package.json` under `apps/`, `packages/`, plus the root.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

function gitFiles() {
  const out = execSync("git ls-files", { encoding: "utf8", cwd: REPO_ROOT });
  return out.split(/\r?\n/).filter(Boolean);
}

// Tiny YAML subset parser for the `catalog:` block in pnpm-workspace.yaml.
function parseCatalog(yamlPath) {
  const catalog = new Map();
  let inCatalog = false;
  for (const raw of readFileSync(yamlPath, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*#/.test(line)) continue;
    if (/^catalog:\s*$/.test(line)) {
      inCatalog = true;
      continue;
    }
    if (!inCatalog) continue;
    if (/^\S/.test(line) && line.trim() !== "") {
      inCatalog = false;
      continue;
    }
    const m = line.match(
      /^\s{2,4}(?:"([^"]+)"|'([^']+)'|([^\s:]+)):\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/,
    );
    if (m) catalog.set(m[1] ?? m[2] ?? m[3], m[4] ?? m[5] ?? m[6]);
  }
  return catalog;
}

const catalog = parseCatalog(join(REPO_ROOT, "pnpm-workspace.yaml"));

const pkgFiles = gitFiles()
  .filter((f) => f.endsWith("/package.json") || f === "package.json")
  .filter(
    (f) =>
      !f.includes("/node_modules/") &&
      (f === "package.json" || f.startsWith("apps/") || f.startsWith("packages/")),
  );

const HARD_FIELDS = ["dependencies", "devDependencies"];
const SOFT_FIELDS = ["peerDependencies", "optionalDependencies"];
const DEP_FIELDS = [...HARD_FIELDS, ...SOFT_FIELDS];

const hardFailures = [];
const softWarnings = [];
const usageByDep = new Map(); // depName -> Map<version, Set<pkgFile>>

for (const rel of pkgFiles) {
  const abs = join(REPO_ROOT, rel);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    console.error(`! failed to parse ${rel}: ${err.message}`);
    continue;
  }
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, spec] of Object.entries(deps)) {
      const specStr = String(spec);
      // Hard fail only on runtime/dev deps — peerDependencies have different
      // resolution semantics and are tracked separately.
      if (catalog.has(name) && !specStr.startsWith("catalog:")) {
        const record = { file: rel, field, dep: name, spec: specStr };
        if (HARD_FIELDS.includes(field)) {
          hardFailures.push(record);
        } else {
          softWarnings.push(record);
        }
      }
      if (!specStr.startsWith("catalog:") && !specStr.startsWith("workspace:")) {
        if (!usageByDep.has(name)) usageByDep.set(name, new Map());
        const byVer = usageByDep.get(name);
        if (!byVer.has(specStr)) byVer.set(specStr, new Set());
        byVer.get(specStr).add(rel);
      }
    }
  }
}

if (hardFailures.length > 0) {
  console.error(`✗ catalog-drift: ${hardFailures.length} catalogued dep(s) pinned directly:\n`);
  for (const h of hardFailures) {
    console.error(`  ${h.file} [${h.field}]: "${h.dep}": "${h.spec}"  →  should be "catalog:"`);
  }
  console.error('\nFix: replace the direct version with `"catalog:"`.');
  process.exit(1);
}

if (softWarnings.length > 0) {
  console.error(
    `⚠ catalog-drift: ${softWarnings.length} catalogued dep(s) pinned in peer/optional deps:`,
  );
  for (const h of softWarnings) {
    console.error(`  ${h.file} [${h.field}]: "${h.dep}": "${h.spec}"`);
  }
  console.error("  (peerDeps have distinct resolution semantics — see docs §w104; warning only)");
}

const warnCandidates = [];
for (const [name, byVer] of usageByDep) {
  for (const [ver, pkgs] of byVer) {
    if (pkgs.size >= 2 && !catalog.has(name)) {
      warnCandidates.push({ name, ver, pkgs: [...pkgs] });
    }
  }
}

if (warnCandidates.length > 0) {
  console.error(`⚠ catalog-drift: ${warnCandidates.length} hoist candidate(s):`);
  for (const c of warnCandidates) {
    console.error(`  "${c.name}": "${c.ver}"  — used by: ${c.pkgs.join(", ")}`);
  }
}

console.log(
  `✓ catalog-drift check passed (${catalog.size} catalogued dep(s), ${warnCandidates.length} hoist candidate(s))`,
);
process.exit(0);
