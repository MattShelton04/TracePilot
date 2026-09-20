/** Real Windows desktop measurements. Start the isolated release app first. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connectDesktop } from "../automation/ready.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    assert(arg.startsWith("--") && arg.includes("="), `Expected --key=value: ${arg}`);
    const at = arg.indexOf("=");
    return [arg.slice(2, at), arg.slice(at + 1)];
  }),
);
assert(options.manifest && options.out, "Supply --manifest=... --out=...");
const manifestText = readFileSync(resolve(options.manifest), "utf8");
const manifest = JSON.parse(manifestText);
const state = JSON.parse(readFileSync(".tracepilot/automation/desktop.json", "utf8"));
assert.equal(state.runtime, "production", "Measurements require -Runtime production");
assert.equal(state.build?.frontend, "built", "Measurements require built frontend assets");
assert.equal(state.build?.rustProfile, "release", "Measurements require the release Rust profile");
assert.equal(resolve(state.dataRoot).toLowerCase(), resolve(manifest.root).toLowerCase());
const out = resolve(options.out);
mkdirSync(out, { recursive: true });
const repeats = Number(options.samples ?? 3);
assert(Number.isInteger(repeats) && repeats > 0 && repeats <= 30);
const viewport = { width: Number(options.width ?? 1440), height: Number(options.height ?? 960) };
const cpuThrottleRate = Number(options["cpu-rate"] ?? 1);
assert(cpuThrottleRate >= 1 && cpuThrottleRate <= 8);
const report = {
  harnessVersion: 2,
  fixtureVersion: manifest.fixtureVersion,
  fixtureHash: createHash("sha256").update(manifestText).digest("hex"),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  platform: process.platform,
  node: process.version,
  viewport,
  cpuThrottleRate,
  launch: state,
  startedAt: new Date().toISOString(),
  status: "running",
  cacheState: "Existing process; first route visit then warm revisits. OS cache uncontrolled.",
  instrumentation:
    "CDP metrics, @tracepilot/client IPC perf hook, Long Tasks observer; CPU profile opt-in",
  ipcCoverage:
    "Calls issued through @tracepilot/client invokePlugin; direct __TAURI_INTERNALS__.invoke setup checks are excluded.",
  samples: [],
  errors: [],
};
let browser;
let page;
let cdp;
let profilerRunning = false;
const pageError = (error) => report.errors.push(String(error));
const invoke = (cmd, args = {}) =>
  page.evaluate(
    ([command, params]) =>
      window.__TAURI_INTERNALS__.invoke(`plugin:tracepilot|${command}`, params),
    [cmd, args],
  );
async function frames() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}
async function metrics() {
  const result = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
}
async function route(path) {
  await page.evaluate((value) => {
    location.hash = `#${value}`;
  }, path);
}
function validateIpcCalls(calls, sampleName, iteration) {
  assert(Array.isArray(calls), `${sampleName}[${iteration}] IPC log must be an array`);
  for (const [index, call] of calls.entries()) {
    const label = `${sampleName}[${iteration}] IPC call ${index}`;
    assert.equal(typeof call.cmd, "string", `${label} command`);
    assert(call.cmd.length > 0, `${label} command must not be empty`);
    assert(Number.isFinite(call.duration) && call.duration >= 0, `${label} duration`);
    assert(Number.isFinite(call.timestamp) && call.timestamp > 0, `${label} timestamp`);
    assert.equal(typeof call.failed, "boolean", `${label} failed status`);
  }
}
async function sample(name, run, iteration) {
  await page.evaluate(() => {
    const hook = window.__TRACEPILOT_IPC_PERF__;
    if (
      !hook ||
      typeof hook.getIpcPerfLog !== "function" ||
      typeof hook.clearIpcPerfLog !== "function"
    ) {
      throw new Error("TracePilot IPC performance hook is unavailable");
    }
    hook.clearIpcPerfLog();
    window.__TP_MEASURE__.longTasks = [];
  });
  const before = await metrics();
  const started = performance.now();
  await run();
  await frames();
  const durationMs = performance.now() - started;
  const after = await metrics();
  const instrumentation = await page.evaluate(() => {
    const hook = window.__TRACEPILOT_IPC_PERF__;
    if (!hook || typeof hook.getIpcPerfLog !== "function") {
      throw new Error("TracePilot IPC performance hook disappeared during measurement");
    }
    return {
      calls: [...hook.getIpcPerfLog()],
      longTasks: window.__TP_MEASURE__.longTasks,
      navigation: performance.getEntriesByType("navigation").map((entry) => entry.toJSON()),
    };
  });
  validateIpcCalls(instrumentation.calls, name, iteration);
  const entry = { name, iteration, durationMs, before, after, ...instrumentation };
  report.samples.push(entry);
  writeFileSync(join(out, "desktop.json"), JSON.stringify(report, null, 2));
  console.log(
    `${name}[${iteration}]: ${durationMs.toFixed(1)} ms; ${entry.calls.length} IPC calls; heap ${(after.JSHeapUsedSize / 1048576).toFixed(1)} MiB`,
  );
}
async function sessionsReady() {
  await page.locator('[data-testid="session-card"]').first().waitFor({ timeout: 60_000 });
}
async function conversationReady(session) {
  await page
    .locator(".detail-title")
    .filter({ hasText: session.title })
    .waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll(".cv-turn-block").length === count,
    session.turnCount,
    { timeout: 90_000 },
  );
  await page.locator(".cv-user-body").first().waitFor();
}
try {
  const connected = await connectDesktop(state.endpoint, 60_000);
  browser = connected.browser;
  page = connected.page;
  cdp = await connected.context.newCDPSession(page);
  page.on("pageerror", pageError);
  await page.setViewportSize(viewport);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottleRate });
  await cdp.send("Performance.enable");
  await page.evaluate(() => {
    const hook = window.__TRACEPILOT_IPC_PERF__;
    if (
      !hook ||
      typeof hook.getIpcPerfLog !== "function" ||
      typeof hook.clearIpcPerfLog !== "function"
    ) {
      throw new Error("TracePilot IPC performance hook is unavailable");
    }
    window.__TP_MEASURE__ = { longTasks: [] };
    window.__TP_MEASURE__.observer = new PerformanceObserver((list) => {
      window.__TP_MEASURE__.longTasks.push(
        ...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })),
      );
    });
    window.__TP_MEASURE__.observer.observe({ type: "longtask" });
  });

  const config = await invoke("get_config");
  const expectedRoot = resolve(manifest.root).toLowerCase();
  for (const key of ["copilotHome", "tracepilotHome", "sessionStateDir", "indexDbPath"]) {
    assert(
      resolve(config.paths[key]).toLowerCase().startsWith(`${expectedRoot}\\`),
      `Isolation mismatch: ${key}`,
    );
  }
  report.resolvedPaths = config.paths;
  const sessions = await invoke("list_sessions", { hideEmpty: false });
  assert.equal(sessions.length, manifest.totals.sessionCount, "Indexed fixture session count");
  assert.deepEqual(sessions.map((s) => s.id).sort(), manifest.sessions.map((s) => s.id).sort());
  report.webview = await cdp.send("Browser.getVersion");
  const detailed =
    manifest.sessions.find((s) => s.turnCount === 200) ??
    manifest.sessions.reduce((a, b) => (a.turnCount > b.turnCount ? a : b));
  const selected = options.session
    ? manifest.sessions.find((s) => s.id === options.session)
    : detailed;
  assert(selected, "Selected fixture session missing");
  report.selectedSession = selected;
  for (let iteration = 0; iteration < repeats; iteration++) {
    await route("/settings");
    await page.locator(".settings-root").waitFor();
    await sample(
      "session-list",
      async () => {
        await route("/");
        await sessionsReady();
      },
      iteration,
    );
    if (iteration === 0) await page.screenshot({ path: join(out, "session-list.png") });
    if (options.profile === "true" && iteration === 0) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
      profilerRunning = true;
    }
    await sample(
      "conversation",
      async () => {
        await route(`/session/${selected.id}/conversation`);
        await conversationReady(selected);
      },
      iteration,
    );
    if (options.profile === "true" && iteration === 0) {
      const { profile } = await cdp.send("Profiler.stop");
      profilerRunning = false;
      writeFileSync(join(out, "conversation.cpuprofile"), JSON.stringify(profile));
    }
    if (iteration === 0) await page.screenshot({ path: join(out, "conversation.png") });
    await sample(
      "analytics",
      async () => {
        await route("/analytics");
        await page
          .getByText(`Aggregate metrics across all ${manifest.totals.sessionCount} sessions`, {
            exact: true,
          })
          .waitFor({ timeout: 60_000 });
        await page.getByText("Total Sessions", { exact: true }).waitFor();
      },
      iteration,
    );
    if (iteration === 0) await page.screenshot({ path: join(out, "analytics.png") });
    await sample(
      "search",
      async () => {
        await route(`/search?q=${manifest.stableSentinels.searchTerm}`);
        await page.locator(".result-card:not(.skeleton-card)").first().waitFor({ timeout: 60_000 });
        assert(
          (await page.locator(".result-card:not(.skeleton-card)").first().innerText())
            .toLowerCase()
            .includes(manifest.stableSentinels.searchTerm),
        );
      },
      iteration,
    );
    if (iteration === 0) await page.screenshot({ path: join(out, "search.png") });
  }
  const ipcCalls = report.samples.flatMap((entry) => entry.calls);
  report.ipcSummary = {
    callCount: ipcCalls.length,
    failedCount: ipcCalls.filter((call) => call.failed).length,
  };
  assert(ipcCalls.length > 0, "Measured app routes produced no client IPC calls");
  assert.equal(report.ipcSummary.failedCount, 0, "Measured app routes included failed IPC calls");
  assert.equal(report.errors.length, 0, "Uncaught app errors");
  report.status = "complete";
} catch (error) {
  report.status = "failed";
  report.errors.push(String(error.stack ?? error));
  if (profilerRunning) {
    await cdp?.send("Profiler.stop").catch(() => {});
    profilerRunning = false;
  }
  await page?.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(out, "desktop.json"), JSON.stringify(report, null, 2));
  await page
    ?.evaluate(() => {
      if (window.__TP_MEASURE__) {
        window.__TP_MEASURE__.observer.disconnect();
        delete window.__TP_MEASURE__;
      }
    })
    .catch(() => {});
  await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => {});
  await cdp?.detach().catch(() => {});
  await browser?.close().catch(() => {});
}
