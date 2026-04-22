/**
 * TracePilot Playwright CDP Connection Helper
 *
 * Reusable module for connecting Playwright to a running TracePilot instance
 * via Chrome DevTools Protocol. Handles port discovery, connection, readiness
 * polling, and provides a clean API for automation scripts and skills.
 *
 * Usage:
 *   import { connect, collectTelemetry } from './connect.mjs';
 *   const { browser, page } = await connect();
 *   // ... interact with the app ...
 *   const telemetry = await collectTelemetry(page);
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT_FILE = resolve(__dirname, ".tracepilot-cdp.port");

// ─── Port Discovery ──────────────────────────────────────────────────────────

/**
 * Discover the CDP port, checking in order:
 * 1. Explicit port argument
 * 2. .tracepilot-cdp.port file (written by launch.ps1)
 * 3. Scan ports 9222-9232 for an active CDP endpoint
 */
export async function discoverPort(explicitPort) {
  if (explicitPort) return explicitPort;

  // Check port file
  if (existsSync(PORT_FILE)) {
    const port = parseInt(readFileSync(PORT_FILE, "utf-8").trim(), 10);
    if (port && (await isPortActive(port))) return port;
  }

  // Scan range
  for (let p = 9222; p <= 9232; p++) {
    if (await isPortActive(p)) return p;
  }

  throw new Error(
    "No active TracePilot CDP endpoint found.\n" +
      "Start the app with: .\\scripts\\e2e\\launch.ps1",
  );
}

async function isPortActive(port) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Connection ──────────────────────────────────────────────────────────────

/**
 * Connect to a running TracePilot instance via CDP.
 *
 * @param {Object} options
 * @param {number} [options.port] - Explicit CDP port (auto-discovered if omitted)
 * @param {number} [options.readyTimeout=30000] - Max ms to wait for app readiness
 * @returns {{ browser, context, page, port }}
 */
export async function connect(options = {}) {
  const port = await discoverPort(options.port);
  console.log(`[connect] Connecting to CDP on 127.0.0.1:${port}...`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  if (!page) {
    throw new Error("No page found in the connected browser context.");
  }

  console.log(`[connect] Connected. Waiting for app readiness...`);
  await waitForReady(page, options.readyTimeout ?? 30000);

  // Validate this is actually TracePilot (not another Chromium CDP target)
  const isTracePilot = await page.evaluate(
    () => document.title === "TracePilot" || "__TRACEPILOT_PERF__" in window,
  );
  if (!isTracePilot) {
    await browser.close();
    throw new Error(
      "Connected CDP target is not TracePilot. " + "Another Chromium app may be using this port.",
    );
  }

  console.log(`[connect] TracePilot is ready.`);

  return { browser, context, page, port };
}

/**
 * Wait for the TracePilot app to be fully loaded.
 * Checks: Vue app mounted (#root), __TRACEPILOT_PERF__ available,
 * __TAURI_INTERNALS__ present, and optional __TRACEPILOT_READY__ flag.
 */
async function waitForReady(page, timeout) {
  const start = Date.now();
  const checks = {
    vueMount: false,
    perfMonitor: false,
    tauriInternals: false,
  };

  while (Date.now() - start < timeout) {
    try {
      const status = await page.evaluate(() => ({
        vueMount: !!document.querySelector("#root")?.children?.length,
        perfMonitor: typeof window.__TRACEPILOT_PERF__ !== "undefined",
        tauriInternals: "__TAURI_INTERNALS__" in window,
        appReady: window.__TRACEPILOT_READY__ === true,
      }));

      checks.vueMount = status.vueMount;
      checks.perfMonitor = status.perfMonitor;
      checks.tauriInternals = status.tauriInternals;

      // Ready when Vue is mounted AND either __TRACEPILOT_READY__ is set
      // or perf monitor + tauri internals are available (backward compat)
      if (status.vueMount && (status.appReady || (status.perfMonitor && status.tauriInternals))) {
        return;
      }
    } catch {
      // page.evaluate may fail during navigation
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`App not ready within ${timeout}ms. Status: ${JSON.stringify(checks)}`);
}

// ─── Telemetry Collection ────────────────────────────────────────────────────

/**
 * Collect comprehensive telemetry from the running app.
 *
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').BrowserContext} context
 * @returns {Object} Structured telemetry data
 */
export async function collectTelemetry(page, context) {
  const telemetry = {
    timestamp: new Date().toISOString(),
    url: page.url(),
    perf: {},
    ipc: {},
    cdp: {},
    console: [],
  };

  // Component mount timings from __TRACEPILOT_PERF__
  telemetry.perf.mountTimings = await page.evaluate(() => {
    return window.__TRACEPILOT_PERF__?.getPerfLog() ?? [];
  });

  telemetry.perf.slowEntries = await page.evaluate(() => {
    return window.__TRACEPILOT_PERF__?.getSlowEntries(50) ?? [];
  });

  // IPC performance log
  telemetry.ipc.perfLog = await page.evaluate(() => {
    return window.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog() ?? [];
  });

  // Performance API measures
  telemetry.perf.measures = await page.evaluate(() => {
    return performance.getEntriesByType("measure").map((m) => ({
      name: m.name,
      duration: m.duration,
      startTime: m.startTime,
    }));
  });

  // CDP Performance metrics
  if (context) {
    let cdpSession;
    try {
      cdpSession = await context.newCDPSession(page);
      await cdpSession.send("Performance.enable");
      const metrics = await cdpSession.send("Performance.getMetrics");
      telemetry.cdp.metrics = {};
      for (const m of metrics.metrics) {
        telemetry.cdp.metrics[m.name] = m.value;
      }
    } catch (e) {
      telemetry.cdp.error = e.message;
    } finally {
      if (cdpSession) await cdpSession.detach().catch(() => {});
    }
  }

  return telemetry;
}

/**
 * Start collecting console logs from the page.
 * Returns a function to retrieve collected logs.
 *
 * @param {import('playwright-core').Page} page
 * @returns {{ getLogs: () => Array, stop: () => void }}
 */
export function startConsoleCapture(page) {
  const logs = [];
  const handler = (msg) => {
    logs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now(),
    });
  };

  page.on("console", handler);

  return {
    getLogs: () => [...logs],
    stop: () => page.off("console", handler),
  };
}

/**
 * Validate telemetry against performance budgets.
 *
 * @param {Object} telemetry - From collectTelemetry()
 * @param {string} budgetPath - Path to perf-budget.json
 * @returns {{ passed: boolean, violations: Array }}
 */
export function validateBudgets(telemetry, budgetPath) {
  let budgets;
  try {
    budgets = JSON.parse(readFileSync(budgetPath, "utf-8"));
  } catch {
    return { passed: false, violations: [{ type: "config", error: "Could not read budget file" }] };
  }

  const violations = [];

  // Check IPC budgets
  if (budgets.ipc && telemetry.ipc?.perfLog) {
    const ipcBudgets = budgets.ipc;
    for (const entry of telemetry.ipc.perfLog) {
      const budgetKey = `${camelCase(entry.cmd)}Ms`;
      if (ipcBudgets[budgetKey] && entry.duration > ipcBudgets[budgetKey]) {
        violations.push({
          type: "ipc",
          command: entry.cmd,
          actual: Math.round(entry.duration),
          budget: ipcBudgets[budgetKey],
          unit: "ms",
        });
      }
    }
  }

  // Check CDP metrics against configured budgets
  if (telemetry.cdp?.metrics) {
    const heapBudgetMb = budgets.frontend?.jsHeapMb ?? 200;
    const heap = telemetry.cdp.metrics.JSHeapUsedSize;
    if (heap && heap > heapBudgetMb * 1024 * 1024) {
      violations.push({
        type: "memory",
        metric: "JSHeapUsedSize",
        actual: Math.round(heap / 1024 / 1024),
        budget: heapBudgetMb,
        unit: "MB",
      });
    }
  }

  return { passed: violations.length === 0, violations };
}

function camelCase(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ─── Navigation Helpers ──────────────────────────────────────────────────────

/**
 * Navigate to a TracePilot route by hash.
 * @param {import('playwright-core').Page} page
 * @param {string} route - e.g. '/', '/search', '/analytics', '/session/:id/overview'
 */
export async function navigateTo(page, route) {
  await page.evaluate((r) => {
    window.location.hash = `#${r}`;
  }, route);
  await page.waitForTimeout(1000);
}

// ─── IPC Helper ──────────────────────────────────────────────────────────────

/**
 * Invoke a TracePilot IPC command via the running app's Tauri internals.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} cmd - Command name, e.g. 'task_list', 'task_create'
 * @param {Record<string, unknown>} [args={}]
 * @returns {Promise<unknown>}
 */
export async function ipc(page, cmd, args = {}) {
  return page.evaluate(
    async ([c, a]) => window.__TAURI_INTERNALS__.invoke(`plugin:tracepilot|${c}`, a),
    [cmd, args],
  );
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Shut down the TracePilot app and clean up.
 * Disconnects Playwright, then runs the stop script to kill the process.
 *
 * @param {import('playwright-core').Browser} browser
 * @param {number} [port] - CDP port to stop (reads from port file if omitted)
 */
export async function shutdown(browser, port) {
  console.log("[shutdown] Disconnecting Playwright...");
  await browser.close().catch(() => {});

  console.log("[shutdown] Stopping TracePilot process...");
  const { execSync } = await import("node:child_process");
  const stopScript = resolve(__dirname, "stop.ps1");
  const portArg = port ? `-Port ${port}` : "";
  try {
    execSync(`powershell -ExecutionPolicy Bypass -File "${stopScript}" ${portArg}`, {
      stdio: "inherit",
      timeout: 15000,
    });
  } catch {
    console.warn("[shutdown] stop.ps1 failed — process may need manual cleanup.");
  }
}
