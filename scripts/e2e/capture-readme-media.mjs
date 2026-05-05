#!/usr/bin/env node

/**
 * Capture README media from a running TracePilot desktop app.
 *
 * Prerequisites:
 *   1. .\scripts\e2e\launch.ps1
 *   2. node scripts\e2e\capture-readme-media.mjs
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, startConsoleCapture } from "./connect.mjs";
import {
  DEFAULT_FINAL_VIEWPORT,
  DEFAULT_VIEWPORTS,
  parseArgs,
  parseViewports,
} from "./readme-media/cli.mjs";
import {
  listSessionCandidates,
  printCandidates,
  selectRichSession,
} from "./readme-media/sessions.mjs";
import { writeStoryboard } from "./readme-media/storyboard.mjs";
import { buildCaptureConfig, buildTargets, captureTarget } from "./readme-media/targets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const args = parseArgs(process.argv.slice(2));

const port = args.port ? Number(args.port) : undefined;
const candidateRoot = resolve(
  args.outDir ?? resolve(__dirname, "screenshots", "readme-candidates"),
);
const docsImagesDir = resolve(args.docsImagesDir ?? resolve(repoRoot, "docs", "images"));
const finalViewport = args.finalViewport ?? DEFAULT_FINAL_VIEWPORT;
const viewports = args.viewport?.length ? parseViewports(args.viewport) : DEFAULT_VIEWPORTS;
const candidateLimit = args.candidateLimit ? Number(args.candidateLimit) : 12;

mkdirSync(candidateRoot, { recursive: true });
mkdirSync(docsImagesDir, { recursive: true });

const manifest = {
  timestamp: new Date().toISOString(),
  candidateRoot,
  docsImagesDir,
  finalViewport,
  selectedSession: null,
  targets: [],
  warnings: [],
  console: [],
};

function warn(message, extra = undefined) {
  const entry = { message, ...(extra ? { extra } : {}) };
  manifest.warnings.push(entry);
  console.warn(`[warn] ${message}`);
}

function writeManifest(paths) {
  manifest.storyboardPath = paths.storyboardPath;
  manifest.ffmpegScriptPath = paths.ffmpegPath;
  const manifestPath = resolve(candidateRoot, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

async function listCandidates(page, consoleCapture, browser) {
  console.log("[candidates] Scoring sessions...");
  const candidates = await listSessionCandidates(page, candidateLimit, warn);
  printCandidates(candidates, candidateRoot);
  consoleCapture.stop();
  await browser.close();
}

async function captureReadmeMedia(page, context, consoleCapture) {
  console.log("[capture] Selecting a rich session for detail screenshots...");
  const selectedSession = await selectRichSession(page, candidateLimit, warn);
  manifest.selectedSession = selectedSession;
  console.log(
    `[capture] Selected ${selectedSession.id} (${selectedSession.score.toFixed(1)} score, ` +
      `${selectedSession.subagentCount} subagents, ${selectedSession.todoCount} todos, ` +
      `${selectedSession.todoDepCount} deps)`,
  );

  const captureConfig = buildCaptureConfig(args, selectedSession.id);
  manifest.captureConfig = captureConfig;
  const targets = buildTargets(captureConfig, selectedSession.searchTerm);
  const captureOptions = { candidateRoot, docsImagesDir, finalViewport, warn };

  for (const viewport of viewports) {
    console.log(`[capture] Viewport ${viewport.label}`);
    for (const target of targets) {
      console.log(`  - ${target.key}`);
      const record = await captureTarget(page, context, target, viewport, captureOptions);
      manifest.targets.push(record);
    }
  }

  manifest.console = consoleCapture.getLogs();
  const paths = writeStoryboard(targets, candidateRoot, docsImagesDir);
  const manifestPath = writeManifest(paths);
  const finalCount = manifest.targets.filter((target) => target.finalPath).length;

  console.log(`[capture] Wrote ${manifest.targets.length} candidates.`);
  console.log(`[capture] Copied ${finalCount} final-viewport images to ${docsImagesDir}.`);
  console.log(`[capture] Manifest: ${manifestPath}`);
  console.log(`[capture] Storyboard: ${paths.storyboardPath}`);
  console.log(`[capture] Optional video helper: ${paths.ffmpegPath}`);
}

async function main() {
  let browser;
  try {
    console.log("[capture] Connecting to TracePilot...");
    const connection = await connect({ port, readyTimeout: 45000 });
    browser = connection.browser;
    const { context, page } = connection;
    const consoleCapture = startConsoleCapture(page);

    if (args.listCandidates) {
      await listCandidates(page, consoleCapture, browser);
      return;
    }

    await captureReadmeMedia(page, context, consoleCapture);
    consoleCapture.stop();
    await browser.close();
  } catch (error) {
    console.error(`[capture] ${error.message}`);
    if (!existsSync(resolve(__dirname, ".tracepilot-cdp.port"))) {
      console.error("[capture] Start the app first with: .\\scripts\\e2e\\launch.ps1");
    }
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
