#!/usr/bin/env node
/**
 * Lightweight public-API growth guard for `tracepilot-orchestrator` (FU-10).
 *
 * Minimal alternative to a full `cargo public-api --diff` gate. We count
 * the top-level `pub mod`, `pub use`, `pub fn`, `pub struct`, `pub enum`,
 * `pub trait`, `pub type`, `pub const` and `pub static` items exposed
 * directly from `crates/tracepilot-orchestrator/src/lib.rs` and compare
 * the sorted item names against a checked-in baseline.
 *
 * Adding to the crate root requires a baseline regeneration (see
 * `--update` below) and should be reviewed deliberately, per
 * w124's public-surface tightening.
 *
 * This is intentionally shallow (top-of-`lib.rs` only): it catches
 * accidental re-exports and new public modules, without the heavy
 * dependency on `cargo-public-api`. Graduate to `cargo-public-api` if
 * the crate's API ever needs stability guarantees.
 *
 * Usage:
 *   node scripts/check-public-api.mjs           # verify (CI)
 *   node scripts/check-public-api.mjs --update  # regenerate baseline
 *
 * See:
 *   crates/tracepilot-orchestrator/public-api-baseline.txt
 *   crates/tracepilot-orchestrator/README.md § Public API
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const CRATE_DIR = join(REPO_ROOT, "crates", "tracepilot-orchestrator");
const LIB_RS = join(CRATE_DIR, "src", "lib.rs");
const BASELINE = join(CRATE_DIR, "public-api-baseline.txt");

// Extracts the "name" of each public item at the root of lib.rs.
//   pub mod foo;                 -> "mod foo"
//   pub use error::{A, B};       -> "use error::A", "use error::B"
//   pub use types::*;            -> "use types::*"
//   pub fn bar(...)              -> "fn bar"
//   pub struct Baz               -> "struct Baz"
// Only fully-public items (reject `pub(crate)`, `pub(super)`, etc).
const PUB_PREFIX = /^pub\s+/;
const ITEM_RX = /^pub\s+(mod|fn|struct|enum|trait|type|const|static)\s+(.+?)[;{(]/;
const USE_RX = /^pub\s+use\s+([^;]+);/;

function extractPublicItems(src) {
  const items = new Set();
  // Strip block comments (very small lib.rs; regex is safe here).
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // Walk line-by-line to stay at the top level (lib.rs in this crate has
  // no inline `mod {}` blocks — see `src/lib.rs`).
  const lines = clean.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    // Only fully-public: reject `pub(crate)` / `pub(super)` / `pub(in ...)`.
    if (!PUB_PREFIX.test(line)) continue;
    const useMatch = line.match(USE_RX);
    if (useMatch) {
      for (const name of expandUse(useMatch[1])) items.add(`use ${name}`);
      continue;
    }
    const m = line.match(ITEM_RX);
    if (!m) continue;
    const [, kind, rest] = m;
    const name = rest.split(/[\s<:]/)[0];
    items.add(`${kind} ${name}`);
  }
  return [...items].sort();
}

function expandUse(path) {
  // "error::{OrchestratorError, Result}" -> ["error::OrchestratorError", "error::Result"]
  // "types::*" -> ["types::*"]
  // "foo::bar" -> ["foo::bar"]
  const trimmed = path.trim();
  const braceStart = trimmed.indexOf("{");
  if (braceStart === -1) return [trimmed];
  const prefix = trimmed.slice(0, braceStart).trim();
  const inner = trimmed.slice(braceStart + 1, trimmed.lastIndexOf("}"));
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${prefix}${s}`);
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return null;
  return readFileSync(BASELINE, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

const src = readFileSync(LIB_RS, "utf8");
const current = extractPublicItems(src);

if (process.argv.includes("--update")) {
  const header =
    "# Public API baseline for tracepilot-orchestrator (FU-10 guard).\n" +
    "# Regenerated via `node scripts/check-public-api.mjs --update`.\n" +
    "# Any diff against this file should be reviewed; prefer narrower\n" +
    "# visibility (`pub(crate)` / `pub(super)`) unless the item must be\n" +
    "# consumed from outside the crate.\n";
  writeFileSync(BASELINE, `${header}${current.join("\n")}\n`);
  console.log(`✓ public-api baseline updated (${current.length} items)`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(`✗ baseline not found: ${BASELINE}`);
  console.error("  generate with: node scripts/check-public-api.mjs --update");
  process.exit(2);
}

const bset = new Set(baseline);
const cset = new Set(current);
const added = current.filter((x) => !bset.has(x));
const removed = baseline.filter((x) => !cset.has(x));

if (added.length === 0 && removed.length === 0) {
  console.log(`✓ public-api baseline match (${current.length} items)`);
  process.exit(0);
}

console.error("✗ public-api drift detected in tracepilot-orchestrator:");
for (const a of added) console.error(`  + ${a}`);
for (const r of removed) console.error(`  - ${r}`);
console.error(
  "\nIf intentional, regenerate the baseline with:" +
    "\n  node scripts/check-public-api.mjs --update",
);
process.exit(1);
