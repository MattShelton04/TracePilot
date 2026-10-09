#!/usr/bin/env node
// Claude Code format census: which record and attachment types TracePilot's
// parser has no mapping for, and which Claude Code versions wrote the
// sessions. The Markdown report holds counts, type names and versions only
// (no paths, ids or content), so it can be pasted into an issue.
//
//   node scripts/claude-census.mjs [claude-config-dir]
//
// The folder defaults to CLAUDE_CONFIG_DIR, else ~/.claude. Only
// `projects/**/*.jsonl` and their `subagents/` are read, never `sessions/`.
// It builds and runs the `claude_census` example of tracepilot-core with the
// same parser the app uses, so it needs the Rust toolchain.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help") || args.length > 1) {
  console.log("Usage: node scripts/claude-census.mjs [claude-config-dir]");
  console.log("Defaults to CLAUDE_CONFIG_DIR, else ~/.claude.");
  process.exit(args.length > 1 ? 1 : 0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargoArgs = ["run", "--quiet", "-p", "tracepilot-core", "--example", "claude_census"];
if (args.length === 1) cargoArgs.push("--", resolve(args[0]));
const result = spawnSync("cargo", cargoArgs, { cwd: root, stdio: "inherit" });
if (result.error) {
  console.error(`Could not run cargo: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
