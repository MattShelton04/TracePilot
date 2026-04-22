/**
 * TracePilot Hot-Path Performance Profiler
 *
 * Exercises all major hot paths and collects IPC timings, component mount
 * times, heap usage, and long-task counts at each step.
 *
 * Run:  node scripts/e2e/perf-profile.mjs
 */

import { connect, ipc, navigateTo, shutdown, startConsoleCapture } from "./connect.mjs";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(ms) {
  return ms != null ? `${Math.round(ms)}ms` : "n/a";
}
function fmtMB(bytes) {
  return bytes != null ? `${(bytes / 1048576).toFixed(1)} MB` : "n/a";
}

async function clearPerf(page) {
  await page.evaluate(() => {
    window.__TRACEPILOT_IPC_PERF__?.clearIpcPerfLog?.();
  });
}

async function heapSnapshot(cdpSession) {
  const { metrics } = await cdpSession.send("Performance.getMetrics");
  return {
    used: metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0,
    total: metrics.find((m) => m.name === "JSHeapTotalSize")?.value ?? 0,
    nodes: metrics.find((m) => m.name === "Nodes")?.value ?? 0,
    layoutCount: metrics.find((m) => m.name === "LayoutCount")?.value ?? 0,
    recalcStyle: metrics.find((m) => m.name === "RecalcStyleCount")?.value ?? 0,
    scriptDur: metrics.find((m) => m.name === "ScriptDuration")?.value ?? 0,
  };
}

async function measureStep(label, page, cdpSession, fn) {
  await clearPerf(page);
  const before = await heapSnapshot(cdpSession);
  const t0 = Date.now();
  await fn();
  const wallMs = Date.now() - t0;
  const after = await heapSnapshot(cdpSession);
  const ipcLog = await page.evaluate(() => window.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog?.() ?? []);
  const mounts = await page.evaluate(() => window.__TRACEPILOT_PERF__?.getPerfLog?.() ?? []);
  return { label, wallMs, before, after, ipcLog, mounts };
}

function summariseStep(r) {
  const lines = [`\n### ${r.label}  (wall: ${fmt(r.wallMs)})`];
  const heapD = r.after.used - r.before.used;
  const nodeD = r.after.nodes - r.before.nodes;
  const layoutD = r.after.layoutCount - r.before.layoutCount;
  const recalcD = r.after.recalcStyle - r.before.recalcStyle;
  const scriptD = ((r.after.scriptDur - r.before.scriptDur) * 1000).toFixed(0);
  lines.push(
    `  Heap: ${fmtMB(r.after.used)} [D${heapD >= 0 ? "+" : ""}${fmtMB(heapD)}]  DOM: ${r.after.nodes} [D${nodeD >= 0 ? "+" : ""}${nodeD}]  Layouts: ${layoutD}  Recalcs: ${recalcD}  Script: ${scriptD}ms`,
  );

  if (r.ipcLog.length) {
    const sorted = [...r.ipcLog].sort((a, b) => b.duration - a.duration);
    const total = r.ipcLog.reduce((s, c) => s + c.duration, 0);
    lines.push(`  IPC: ${r.ipcLog.length} calls, total ${fmt(total)}`);
    for (const c of sorted.slice(0, 8)) {
      const flag =
        c.duration > 500 ? " RED" : c.duration > 200 ? " YLW" : c.duration > 100 ? " SLW" : "";
      lines.push(`    ${fmt(c.duration).padStart(7)}  ${c.cmd}${flag}`);
    }
  } else {
    lines.push(`  IPC: none`);
  }

  const slow = (r.mounts ?? [])
    .filter((m) => m.duration > 20)
    .sort((a, b) => b.duration - a.duration);
  if (slow.length) {
    lines.push(`  Slow mounts (>20ms):`);
    for (const m of slow.slice(0, 5)) lines.push(`    ${fmt(m.duration).padStart(7)}  ${m.name}`);
  }
  return lines.join("\n");
}

// ─── main ────────────────────────────────────────────────────────────────────

const results = [];
console.log("=== TracePilot Hot-Path Performance Profile ===\n");

const { browser, page, context } = await connect();
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const consoleLogs = startConsoleCapture(page);
await page.waitForTimeout(2000);

// ── 1. Session list ──────────────────────────────────────────────────────────
results.push(
  await measureStep("Session List — navigate", page, cdp, async () => {
    await navigateTo(page, "/");
    await page.waitForTimeout(2000);
  }),
);

// ── 2. Get session IDs via IPC (uses correct window.__TAURI_INTERNALS__) ─────
const sessions = await ipc(page, "list_sessions", { limit: 100, hideEmpty: true });
const sorted = (sessions ?? []).sort((a, b) => (b.eventCount ?? 0) - (a.eventCount ?? 0));
console.log(`Sessions found: ${sorted.length}`);
if (sorted.length) {
  sorted.slice(0, 3).forEach((s) => {
    console.log(
      `  ${s.id.slice(0, 8)}  events:${s.eventCount ?? "?"}  ${(s.summary ?? "").slice(0, 50)}`,
    );
  });
}

const largeSession = sorted[0];
const medSession = sorted.find((s) => (s.eventCount ?? 0) > 100 && s.id !== largeSession?.id);

// ── 3–9. Session detail flows ────────────────────────────────────────────────
if (largeSession) {
  const sid = largeSession.id;
  const evts = largeSession.eventCount;

  results.push(
    await measureStep(`Large session overview cold  (${evts} events)`, page, cdp, async () => {
      await navigateTo(page, `/session/${sid}/overview`);
      await page.waitForTimeout(3500);
    }),
  );

  await navigateTo(page, "/");
  await page.waitForTimeout(500);

  results.push(
    await measureStep(`Large session overview warm  (${evts} events)`, page, cdp, async () => {
      await navigateTo(page, `/session/${sid}/overview`);
      await page.waitForTimeout(2500);
    }),
  );

  for (const tab of ["conversation", "events", "todos", "metrics", "timeline", "token-flow"]) {
    results.push(
      await measureStep(`  Tab: ${tab}  (large ${evts})`, page, cdp, async () => {
        await navigateTo(page, `/session/${sid}/${tab}`);
        await page.waitForTimeout(2000);
      }),
    );
  }
}

if (medSession) {
  const mid = medSession.id;
  results.push(
    await measureStep(
      `Med session cold  (${medSession.eventCount} events)`,
      page,
      cdp,
      async () => {
        await navigateTo(page, `/session/${mid}/overview`);
        await page.waitForTimeout(2500);
      },
    ),
  );
  results.push(
    await measureStep(`  Tab: conversation  (med)`, page, cdp, async () => {
      await navigateTo(page, `/session/${mid}/conversation`);
      await page.waitForTimeout(2000);
    }),
  );
}

// ── 10. Deep search ───────────────────────────────────────────────────────────
results.push(
  await measureStep("Deep Search navigate", page, cdp, async () => {
    await navigateTo(page, "/search");
    await page.waitForTimeout(2500);
  }),
);

const searchInput = page.locator('[data-testid="search-input-field"]').first();
const searchVisible = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
if (searchVisible) {
  results.push(
    await measureStep('Deep Search query "async"', page, cdp, async () => {
      await searchInput.fill("async");
      await page.waitForTimeout(3000);
    }),
  );
  results.push(
    await measureStep('Deep Search query "refactor"', page, cdp, async () => {
      await searchInput.fill("refactor");
      await page.waitForTimeout(3000);
    }),
  );
} else {
  console.log("  (search input not found — skipping query steps)");
}

// ── 11. Aggregates ───────────────────────────────────────────────────────────
for (const [label, route, wait] of [
  ["Analytics page", "/analytics", 3500],
  ["Tool Analysis page", "/tools", 3000],
  ["Code Impact page", "/code", 3000],
  ["Model Comparison page", "/models", 2500],
]) {
  results.push(
    await measureStep(label, page, cdp, async () => {
      await navigateTo(page, route);
      await page.waitForTimeout(wait);
    }),
  );
}

// ── 12. Print results ─────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(72)}`);
console.log("PROFILING RESULTS");
console.log("=".repeat(72));
for (const r of results) console.log(summariseStep(r));

// ── 13. Ranked slow IPC ────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(72)}`);
console.log("SLOW IPC CALLS > 100ms (ranked)");
console.log("=".repeat(72));
const allIpc = results.flatMap((r) => r.ipcLog.map((c) => ({ ...c, step: r.label })));
const slowIpc = allIpc.filter((c) => c.duration > 100).sort((a, b) => b.duration - a.duration);
if (slowIpc.length) {
  for (const c of slowIpc)
    console.log(`  ${fmt(c.duration).padStart(8)}  ${c.cmd.padEnd(40)} [${c.step.slice(0, 35)}]`);
} else {
  console.log("  None!");
}

// ── 14. Slow mounts ────────────────────────────────────────────────────────────
const allMounts = results.flatMap((r) => (r.mounts ?? []).map((m) => ({ ...m, step: r.label })));
const slowMounts = allMounts.filter((m) => m.duration > 20).sort((a, b) => b.duration - a.duration);
if (slowMounts.length) {
  console.log(`\n${"=".repeat(72)}`);
  console.log("SLOW COMPONENT MOUNTS > 20ms");
  console.log("=".repeat(72));
  for (const m of slowMounts.slice(0, 25))
    console.log(
      `  ${fmt(m.duration).padStart(8)}  ${(m.name ?? "?").padEnd(45)} [${m.step.slice(0, 28)}]`,
    );
}

// ── 15. Console perf warnings / errors ────────────────────────────────────────
consoleLogs.stop();
const noteworthy = consoleLogs
  .getLogs()
  .filter(
    (l) => l.text?.includes("[ipc:SLOW]") || l.text?.includes("[perf]") || l.type === "error",
  );
if (noteworthy.length) {
  console.log(`\n${"=".repeat(72)}`);
  console.log("CONSOLE WARNINGS / ERRORS");
  console.log("=".repeat(72));
  for (const l of noteworthy.slice(0, 30)) console.log(`  [${l.type}] ${l.text?.slice(0, 130)}`);
}

await shutdown(browser, 9222);
console.log("\nProfile complete.");
