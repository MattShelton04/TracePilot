/** Optional repeatable diagnostics. Interactive exploration uses playwright-cli. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectDesktop } from "../automation/ready.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

/** `--instance <name>`, `--instance=<name>`, or TRACEPILOT_INSTANCE selects a named app instance. */
export function instanceFromArgs(argv = process.argv.slice(2), env = process.env) {
  const index = argv.findIndex((arg) => arg === "--instance" || arg.startsWith("--instance="));
  const name =
    index < 0
      ? env.TRACEPILOT_INSTANCE || ""
      : argv[index].includes("=")
        ? argv[index].slice("--instance=".length)
        : (argv[index + 1] ?? "");
  if (index >= 0 && !name) throw new Error("--instance needs a name.");
  if (name && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) {
    throw new Error(`Invalid instance name "${name}".`);
  }
  return name;
}

export function stateFile(instance = "") {
  return instance
    ? resolve(REPO_ROOT, ".tracepilot/instances", instance, "desktop.json")
    : resolve(REPO_ROOT, ".tracepilot/automation/desktop.json");
}

/** Use an explicit endpoint or this checkout's recorded one; never scan browsers. */
export async function discoverDesktop(explicitPort, instance = "") {
  if (explicitPort !== undefined) {
    if (!Number.isInteger(explicitPort) || explicitPort < 1 || explicitPort > 65535) {
      throw new Error("CDP port must be an integer between 1 and 65535.");
    }
    // Explicit ports can attach to untracked apps. A selected, recorded instance
    // must still match so a typo cannot attach to another tracked app.
    if (!existsSync(stateFile(instance))) {
      return { port: explicitPort, instanceId: "" };
    }
  }
  const file = stateFile(instance);
  if (!existsSync(file)) {
    throw new Error(
      instance
        ? `No tracked desktop for instance ${instance}. Run pnpm app:start -Instance ${instance}.`
        : "No tracked desktop. Run pnpm app:start.",
    );
  }
  const state = JSON.parse(readFileSync(file, "utf8"));
  const endpoint = new URL(state.endpoint);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port) {
    throw new Error("Invalid recorded CDP endpoint. Run pnpm app:stop, then pnpm app:start.");
  }
  if (explicitPort !== undefined && Number(endpoint.port) !== explicitPort) {
    if (instance) {
      throw new Error(`CDP port ${explicitPort} does not belong to instance ${instance}.`);
    }
    return { port: explicitPort, instanceId: "" };
  }
  // The recorded nonce proves the endpoint still belongs to the instance that wrote this state.
  return { port: Number(endpoint.port), instanceId: state.instanceId ?? "" };
}

export async function connect(options = {}) {
  const instance = options.instance ?? instanceFromArgs();
  const { port, instanceId } = await discoverDesktop(options.port, instance);
  const connection = await connectDesktop(
    `http://127.0.0.1:${port}`,
    options.readyTimeout,
    instanceId,
  );
  console.log(
    `[connect] Real TracePilot backend verified on port ${port}${instance ? ` (instance ${instance})` : ""}.`,
  );
  return { ...connection, port, instance, instanceId };
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
 * Disconnects Playwright, then stops the selected tracked processes.
 *
 * @param {import('playwright-core').Browser} browser
 * @param {number | { port?: number, instance?: string, instanceId?: string }} [target]
 *   Captured connection identity, or a legacy explicit port in the default state.
 */
export async function shutdown(browser, target = {}) {
  console.log("[shutdown] Disconnecting Playwright...");
  await browser.close().catch(() => {});

  console.log("[shutdown] Stopping TracePilot process...");
  const { execFileSync } = await import("node:child_process");
  const stopScript = resolve(__dirname, "stop.ps1");
  const { port, instance, instanceId } = typeof target === "number" ? { port: target } : target;
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", stopScript];
  if (port !== undefined) args.push("-Port", String(port));
  if (instance) args.push("-Instance", instance);
  if (instanceId) args.push("-InstanceId", instanceId);
  try {
    execFileSync("powershell.exe", args, {
      stdio: "inherit",
      timeout: 15000,
      windowsHide: true,
    });
  } catch {
    console.warn("[shutdown] stop.ps1 failed — process may need manual cleanup.");
  }
}
