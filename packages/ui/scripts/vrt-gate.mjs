#!/usr/bin/env node
/**
 * vrt-gate.mjs — opt-in runner for the @tracepilot/ui VRT harness.
 *
 * This is intentionally NOT wired into the default `pnpm test` pipeline or any
 * existing CI workflow. VRT baselines are platform-sensitive (font rendering
 * differs between Windows and Linux) and must be refreshed together on a
 * single OS. See src/__vrt__/README.md for details.
 *
 * Usage:
 *   node scripts/vrt-gate.mjs              # run VRT against committed baselines
 *   node scripts/vrt-gate.mjs --update     # refresh baselines
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const update = process.argv.includes("--update");
const args = [
  "playwright",
  "test",
  "--config=playwright-ct.config.ts",
  ...(update ? ["--update-snapshots"] : []),
];

const result = spawnSync("pnpm", ["exec", ...args], {
  cwd: pkgRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
