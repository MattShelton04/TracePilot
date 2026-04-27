#!/usr/bin/env node

/**
 * TracePilot Copilot SDK usability harness.
 *
 * Default mode is diagnostic/non-mutating: it connects to a running TracePilot
 * instance over CDP, screenshots the SDK settings surface, hydrates bridge state,
 * and verifies that the live/session monitor UI is present.
 *
 * Use --real-sdk to create real SDK sessions. Any real SDK create/send/launch
 * path in this script uses gpt-5-mini by design.
 *
 * Usage:
 *   node scripts/e2e/sdk-usability-test.mjs
 *   node scripts/e2e/sdk-usability-test.mjs --real-sdk --repo-path C:\git\TracePilot
 *   node scripts/e2e/sdk-usability-test.mjs --real-sdk --headless-launch --keep-sessions
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectTelemetry, connect, ipc, navigateTo, startConsoleCapture } from "./connect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_TEST_MODEL = "gpt-5-mini";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const screenshotDir = resolve(args.screenshotDir ?? resolve(__dirname, "screenshots", "sdk"));
mkdirSync(screenshotDir, { recursive: true });

const results = {
  timestamp: new Date().toISOString(),
  model: SDK_TEST_MODEL,
  realSdk: args.realSdk,
  tests: [],
  createdSessions: [],
  consoleLogs: [],
  telemetry: null,
  summary: { passed: 0, failed: 0, warnings: 0 },
};

function parseArgs(argv) {
  const parsed = {
    help: false,
    port: undefined,
    screenshotDir: undefined,
    repoPath: process.cwd(),
    realSdk: false,
    headlessLaunch: false,
    keepSessions: false,
    cliUrl: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--real-sdk") parsed.realSdk = true;
    else if (arg === "--headless-launch") parsed.headlessLaunch = true;
    else if (arg === "--keep-sessions") parsed.keepSessions = true;
    else if (arg === "--port") parsed.port = Number.parseInt(argv[++i], 10);
    else if (arg === "--screenshot-dir") parsed.screenshotDir = argv[++i];
    else if (arg === "--repo-path") parsed.repoPath = argv[++i];
    else if (arg === "--cli-url") parsed.cliUrl = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`TracePilot SDK usability test

Options:
  --real-sdk            Create real SDK sessions and send a short test prompt.
  --headless-launch     Also exercise launch_session with launchMode=sdk/headless.
  --repo-path <path>    Working repo for real SDK/headless tests. Default: cwd.
  --cli-url <host:port> Connect via a running copilot --ui-server instead of stdio.
  --keep-sessions       Do not destroy sessions created by this script.
  --port <port>         CDP port. Auto-discovered by default.
  --screenshot-dir <p>  Screenshot/report output directory.
`);
}

function pass(name, details = "") {
  results.tests.push({ name, status: "pass", details });
  results.summary.passed++;
  console.log(`  ✅ ${name}${details ? ` — ${details}` : ""}`);
}

function warn(name, details = "") {
  results.tests.push({ name, status: "warn", details });
  results.summary.warnings++;
  console.warn(`  ⚠️  ${name}${details ? ` — ${details}` : ""}`);
}

function fail(name, error) {
  results.tests.push({ name, status: "fail", error: formatError(error) });
  results.summary.failed++;
  console.error(`  ❌ ${name} — ${formatError(error)}`);
}

function formatError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function test(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (error) {
    fail(name, error);
  }
}

async function waitForSessionState(page, sessionId, predicate, timeoutMs = 45000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await ipc(page, "sdk_get_session_state", { sessionId }).catch(() => null);
    if (last && predicate(last)) return last;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting for SDK state for ${sessionId}; last=${JSON.stringify(last)}`);
}

async function createSdkSession(page, workingDirectory) {
  const session = await ipc(page, "sdk_create_session", {
    config: {
      model: SDK_TEST_MODEL,
      workingDirectory,
      reasoningEffort: "low",
      systemMessage: null,
      agent: null,
    },
  });
  results.createdSessions.push(session.sessionId);
  return session;
}

async function cleanupSessions(page) {
  if (args.keepSessions || results.createdSessions.length === 0) return;

  for (const sessionId of results.createdSessions.toReversed()) {
    try {
      await ipc(page, "sdk_destroy_session", { sessionId });
      pass("Cleanup destroyed SDK session", sessionId);
    } catch (error) {
      warn("Cleanup could not destroy SDK session", `${sessionId}: ${error.message ?? error}`);
    }
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  TracePilot SDK Usability Test       ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`Model for real SDK actions: ${SDK_TEST_MODEL}`);
  if (!args.realSdk) {
    console.log("Running in diagnostic mode. Add --real-sdk to create/send real SDK sessions.");
  }

  let browser;
  let consoleCapture;

  try {
    const conn = await connect({ port: args.port });
    browser = conn.browser;
    const { page, context } = conn;
    consoleCapture = startConsoleCapture(page);

    await page.evaluate(() => window.__TRACEPILOT_IPC_PERF__?.clearIpcPerfLog?.());

    await test("Settings SDK monitor renders", async () => {
      await navigateTo(page, "/settings");
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(screenshotDir, "01-settings-sdk.png") });
      const text = await page.locator("body").textContent();
      if (!text?.includes("Copilot SDK Bridge")) throw new Error("SDK settings panel not visible");
      if (!text.includes("SDK Sessions & Processes"))
        throw new Error("SDK session monitor missing");
      return "settings surface visible";
    });

    let hydration = null;
    await test("SDK hydration IPC responds", async () => {
      hydration = await ipc(page, "sdk_hydrate");
      return `${hydration.status.state}, ${hydration.sessions.length} runtime sessions, ${hydration.registrySessions.length} registry rows`;
    });

    await test("SDK session list UI has an explicit state", async () => {
      const list = page.locator('[data-testid="sdk-session-list"]');
      const empty = page.locator('[data-testid="sdk-session-list-empty"]');
      if ((await list.count()) === 0 && (await empty.count()) === 0) {
        throw new Error("No SDK session list or empty state found");
      }
      return (await list.count()) > 0 ? "session rows visible" : "empty state visible";
    });

    if (args.realSdk) {
      await test("Connect SDK bridge", async () => {
        if (hydration?.status?.state === "connected") {
          const status = hydration.status;
          return `already connected: ${status.connectionMode ?? "unknown"}${status.cliVersion ? ` · CLI ${status.cliVersion}` : ""}`;
        }
        const status = await ipc(page, "sdk_connect", {
          config: {
            cliUrl: args.cliUrl ?? null,
            cwd: args.repoPath,
            logLevel: "info",
            githubToken: null,
          },
        });
        if (status.state !== "connected") throw new Error(`Bridge state is ${status.state}`);
        return `${status.connectionMode ?? "unknown"}${status.cliVersion ? ` · CLI ${status.cliVersion}` : ""}`;
      });

      await test("gpt-5-mini is available or accepted", async () => {
        const models = await ipc(page, "sdk_list_models").catch(() => []);
        if (Array.isArray(models) && models.length > 0) {
          const found = models.some((model) => model.id === SDK_TEST_MODEL);
          if (!found)
            warn("Model not listed by SDK", `${SDK_TEST_MODEL}; create/send will still request it`);
          return `${models.length} models reported`;
        }
        return "model list unavailable; continuing with explicit model id";
      });

      let firstSession = null;
      let secondSession = null;

      await test("Create two concurrent SDK sessions", async () => {
        firstSession = await createSdkSession(page, args.repoPath);
        secondSession = await createSdkSession(page, args.repoPath);
        if (firstSession.sessionId === secondSession.sessionId) {
          throw new Error("SDK returned duplicate session ids");
        }
        await ipc(page, "sdk_set_foreground_session", { sessionId: firstSession.sessionId });
        return `${firstSession.sessionId.slice(0, 8)}… and ${secondSession.sessionId.slice(0, 8)}…`;
      });

      await test("Send real prompt to first SDK session", async () => {
        const turnId = await ipc(page, "sdk_send_message", {
          sessionId: firstSession.sessionId,
          payload: {
            prompt:
              "TracePilot SDK usability test: reply with one short sentence confirming the session is responsive.",
          },
        });
        await waitForSessionState(
          page,
          firstSession.sessionId,
          (state) => Boolean(state.lastEventType) || state.status === "idle",
        );
        return `turn ${turnId}`;
      });

      await test("Live state remains isolated per session", async () => {
        const states = await ipc(page, "sdk_list_session_states");
        const first = states.find((state) => state.sessionId === firstSession.sessionId);
        const second = states.find((state) => state.sessionId === secondSession.sessionId);
        if (!first) throw new Error("First session has no live state");
        if (second && first.assistantText && second.assistantText === first.assistantText) {
          throw new Error("Second session appears to have copied first session assistant text");
        }
        return `${states.length} compact live states`;
      });

      if (args.headlessLaunch) {
        await test("Headless launcher creates SDK session with gpt-5-mini", async () => {
          const launched = await ipc(page, "launch_session", {
            config: {
              repoPath: args.repoPath,
              branch: null,
              baseBranch: null,
              model: SDK_TEST_MODEL,
              prompt:
                "TracePilot headless launcher usability test: reply with one short confirmation sentence.",
              customInstructions: null,
              reasoningEffort: "low",
              headless: true,
              createWorktree: false,
              autoApprove: false,
              envVars: {},
              cliCommand: "copilot",
              launchMode: "sdk",
            },
          });
          if (launched.launchMode !== "sdk" || !launched.sdkSessionId) {
            throw new Error(`Unexpected launcher result: ${JSON.stringify(launched)}`);
          }
          results.createdSessions.push(launched.sdkSessionId);
          await navigateTo(page, `/session/${launched.sdkSessionId}/overview`);
          await page.waitForTimeout(1500);
          await page.screenshot({ path: resolve(screenshotDir, "02-headless-overview.png") });
          return launched.sdkSessionId;
        });
      }
    }

    results.telemetry = await collectTelemetry(page, context);
    results.consoleLogs = consoleCapture.getLogs();
    const consoleErrors = results.consoleLogs.filter((entry) => entry.type === "error");
    if (consoleErrors.length > 0) {
      warn("Console errors captured", `${consoleErrors.length} error log(s)`);
    } else {
      pass("No console errors captured");
    }

    await cleanupSessions(page);
  } finally {
    consoleCapture?.stop?.();
    const reportPath = resolve(screenshotDir, "sdk-usability-report.json");
    writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\nReport written: ${reportPath}`);
    console.log(
      `Summary: ${results.summary.passed} passed, ${results.summary.warnings} warnings, ${results.summary.failed} failed`,
    );
    await browser?.close?.().catch(() => {});
  }

  if (results.summary.failed > 0) process.exit(1);
}

main().catch((error) => {
  fail("Fatal harness error", error);
  console.error(error);
  process.exit(1);
});
