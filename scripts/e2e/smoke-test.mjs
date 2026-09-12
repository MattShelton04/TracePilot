#!/usr/bin/env node

/**
 * TracePilot E2E Smoke Test
 *
 * Connects to a running TracePilot instance via CDP and exercises key user flows,
 * collecting telemetry along the way. Outputs a structured diagnostic report.
 *
 * Usage:
 *   node scripts/e2e/smoke-test.mjs [--port 9222] [--screenshot-dir ./screenshots]
 *
 * Prerequisites:
 *   - TracePilot running with CDP enabled (use scripts/e2e/launch.ps1)
 *   - playwright-core installed
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectTelemetry,
  connect,
  navigateTo,
  startConsoleCapture,
  validateBudgets,
} from "./connect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : undefined;

const ssIdx = args.indexOf("--screenshot-dir");
const screenshotDir = ssIdx >= 0 ? resolve(args[ssIdx + 1]) : resolve(__dirname, "screenshots");

mkdirSync(screenshotDir, { recursive: true });

// ─── Test Runner ─────────────────────────────────────────────────────────────

const results = {
  timestamp: new Date().toISOString(),
  tests: [],
  telemetry: null,
  budgetValidation: null,
  consoleLogs: [],
  summary: { passed: 0, failed: 0, warnings: 0 },
};

function pass(name, details) {
  results.tests.push({ name, status: "pass", details });
  results.summary.passed++;
  console.log(`  ✅ ${name}${details ? ` — ${details}` : ""}`);
}

function fail(name, error) {
  results.tests.push({ name, status: "fail", error: String(error) });
  results.summary.failed++;
  console.error(`  ❌ ${name} — ${error}`);
}

function warn(name, details) {
  results.tests.push({ name, status: "warn", details });
  results.summary.warnings++;
  console.warn(`  ⚠️  ${name} — ${details}`);
}

async function checkDesktopSizes(page) {
  const original = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const wasCollapsed = await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .isVisible();
  const setCollapsed = async (collapsed) => {
    const toggle = page.getByRole("button", {
      name: collapsed ? "Collapse sidebar" : "Expand sidebar",
      exact: true,
    });
    if (await toggle.isVisible()) await toggle.click();
    await page.locator(".sidebar").evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
  };
  try {
    for (const [label, width, height] of [
      ["default", 1440, 960],
      ["minimum", 960, 640],
      ["large", 2560, 1440],
    ]) {
      await page.setViewportSize({ width, height });
      for (const collapsed of [false, true]) {
        const state = collapsed ? "collapsed" : "expanded";
        await setCollapsed(collapsed);
        // Keyboard focus must scroll the navigation, keeping the brand/footer in place.
        await page
          .getByRole("button", {
            name: collapsed ? "Expand sidebar" : "Collapse sidebar",
            exact: true,
          })
          .focus();
        await page.getByTestId("nav-settings").focus();
        await page.waitForFunction(
          () => {
            const bounds = (selector) => document.querySelector(selector)?.getBoundingClientRect();
            const brand = bounds(".sidebar-brand");
            const navigation = document.querySelector(".sidebar-nav");
            const nav = navigation?.getBoundingClientRect();
            const settings = bounds('[data-testid="nav-settings"]');
            const footer = bounds(".sidebar-footer-area");
            return (
              brand &&
              nav &&
              settings &&
              footer &&
              brand.top >= 0 &&
              footer.bottom <= innerHeight &&
              settings.top >= nav.top &&
              settings.bottom <= nav.bottom + 1 &&
              settings.left >= nav.left &&
              settings.right <= nav.left + navigation.clientWidth + 1 &&
              navigation.scrollWidth <= navigation.clientWidth &&
              document.documentElement.scrollWidth <= innerWidth
            );
          },
          undefined,
          { timeout: 5000 },
        );
        await page.screenshot({ path: resolve(screenshotDir, `settings-${label}-${state}.png`) });
        pass(
          `Desktop navigation: ${label}, ${state}`,
          `${width}x${height}; Settings reachable, brand/footer visible, no horizontal overflow`,
        );
      }
    }
  } catch (error) {
    fail("Desktop navigation at supported sizes", error.message);
  } finally {
    await page.setViewportSize(original);
    await setCollapsed(wasCollapsed);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  TracePilot E2E Smoke Test           ║");
  console.log("╚══════════════════════════════════════╝\n");

  let browser;
  try {
    // 1. Connect
    console.log("🔌 Connecting to TracePilot...");
    const conn = await connect({ port });
    browser = conn.browser;
    const { page, context } = conn;
    pass("CDP connection", `port ${conn.port}`);

    // Start console capture
    const consoleCapture = startConsoleCapture(page);
    await page.evaluate(() => window.__TRACEPILOT_IPC_PERF__?.clearIpcPerfLog());

    // 2. Session List
    console.log("\n📋 Testing Session List...");
    await navigateTo(page, "/");
    await page.waitForTimeout(2000);

    const sessionCards = await page.locator('[data-testid="session-card"], .session-card').count();
    if (sessionCards > 0) {
      pass("Session list loads", `${sessionCards} sessions found`);
    } else {
      fail("Session list loads", "No session cards found");
    }

    await page.screenshot({ path: resolve(screenshotDir, "01-session-list.png") });
    pass("Screenshot: session list");

    // 3. Session Detail
    console.log("\n🔍 Testing Session Detail...");
    const firstCard = page.locator('[data-testid="session-card"], .session-card').first();
    if ((await firstCard.count()) > 0) {
      await firstCard.click();
      await page.waitForTimeout(2000);

      const url = page.url();
      if (url.includes("/session/")) {
        pass("Session detail navigation", url.split("#")[1]);
      } else {
        fail("Session detail navigation", `Expected /session/ in URL, got: ${url}`);
      }

      await page.screenshot({ path: resolve(screenshotDir, "02-session-detail.png") });
      pass("Screenshot: session detail");

      // Check for session detail tabs
      const hasTabs = await page.locator('[data-testid="session-tab"], [role="tab"]').count();
      if (hasTabs > 0) {
        pass("Session detail tabs visible", `${hasTabs} tabs`);
      } else {
        warn("Session detail tabs", "No tab elements found with expected selectors");
      }
    }

    // 4. Search
    console.log("\n🔎 Testing Search...");
    await navigateTo(page, "/search");
    await page.waitForTimeout(1500);

    const searchUrl = page.url();
    if (searchUrl.includes("/search")) {
      pass("Search page loads");
    } else {
      fail("Search page loads", `URL: ${searchUrl}`);
    }

    await page.screenshot({ path: resolve(screenshotDir, "03-search.png") });
    pass("Screenshot: search");

    // 5. Analytics
    console.log("\n📊 Testing Analytics...");
    await navigateTo(page, "/analytics");
    await page.waitForTimeout(2000);

    const analyticsUrl = page.url();
    if (analyticsUrl.includes("/analytics")) {
      pass("Analytics page loads");
    } else {
      fail("Analytics page loads", `URL: ${analyticsUrl}`);
    }

    await page.screenshot({ path: resolve(screenshotDir, "04-analytics.png") });
    pass("Screenshot: analytics");

    // 6. Tools
    console.log("\n🔧 Testing Tools...");
    await navigateTo(page, "/tools");
    await page.waitForTimeout(1500);
    if (page.url().includes("/tools")) {
      pass("Tools page loads");
    } else {
      fail("Tools page loads", `URL: ${page.url()}`);
    }

    // 7. Settings
    console.log("\n⚙️  Testing Settings...");
    await navigateTo(page, "/settings");
    await page.waitForTimeout(1000);
    if (page.url().includes("/settings")) {
      pass("Settings page loads");
    } else {
      fail("Settings page loads", `URL: ${page.url()}`);
    }

    await page.screenshot({ path: resolve(screenshotDir, "05-settings.png") });
    pass("Screenshot: settings");
    await checkDesktopSizes(page);

    // 8. Orchestration
    console.log("\n🎯 Testing Orchestration...");
    await navigateTo(page, "/orchestration");
    await page.waitForTimeout(1500);
    if (page.url().includes("/orchestration")) {
      pass("Orchestration page loads");
    } else {
      fail("Orchestration page loads", `URL: ${page.url()}`);
    }

    // 9. Return to home and collect telemetry
    console.log("\n📈 Collecting telemetry...");
    await navigateTo(page, "/");
    await page.waitForTimeout(1000);

    results.telemetry = await collectTelemetry(page, context);
    pass("Telemetry collection", `${results.telemetry.perf.mountTimings.length} mount entries`);

    // 10. Validate budgets
    const budgetPath = resolve(__dirname, "..", "..", "perf-budget.json");
    results.budgetValidation = validateBudgets(results.telemetry, budgetPath);
    if (results.budgetValidation.passed) {
      pass("Performance budgets", "All within limits");
    } else {
      for (const v of results.budgetValidation.violations) {
        warn(
          `Budget exceeded: ${v.command || v.metric}`,
          `${v.actual}${v.unit} > ${v.budget}${v.unit}`,
        );
      }
    }

    // Collect console logs
    consoleCapture.stop();
    results.consoleLogs = consoleCapture.getLogs();
    const errors = results.consoleLogs.filter((l) => l.type === "error");
    const warnings = results.consoleLogs.filter((l) => l.type === "warning");
    if (errors.length > 0) {
      warn("Console errors detected", `${errors.length} error(s)`);
    }
    if (warnings.length > 0) {
      pass("Console warnings", `${warnings.length} warning(s) captured for analysis`);
    }

    // ─── Report ────────────────────────────────────────────────────────────

    console.log("\n╔══════════════════════════════════════╗");
    console.log("║  Results                             ║");
    console.log("╚══════════════════════════════════════╝");
    console.log(`  Passed:   ${results.summary.passed}`);
    console.log(`  Failed:   ${results.summary.failed}`);
    console.log(`  Warnings: ${results.summary.warnings}`);

    if (results.telemetry?.perf?.mountTimings?.length > 0) {
      console.log("\n  Mount Timings:");
      for (const e of results.telemetry.perf.mountTimings) {
        const flag = e.duration > 50 ? " ⚠️" : "";
        console.log(`    ${e.name}: ${e.duration.toFixed(1)}ms${flag}`);
      }
    }

    if (results.telemetry?.cdp?.metrics) {
      const m = results.telemetry.cdp.metrics;
      console.log("\n  CDP Metrics:");
      console.log(
        `    Heap:  ${(m.JSHeapUsedSize / 1024 / 1024).toFixed(1)}MB / ${(m.JSHeapTotalSize / 1024 / 1024).toFixed(1)}MB`,
      );
      console.log(`    Nodes: ${m.Nodes}`);
    }

    if (results.consoleLogs.length > 0) {
      console.log("\n  Console Highlights:");
      const important = results.consoleLogs.filter(
        (l) => l.text.includes("[ipc:") || l.text.includes("[perf]") || l.type === "error",
      );
      for (const l of important.slice(0, 10)) {
        console.log(`    [${l.type}] ${l.text}`);
      }
    }

    // Write full report to file
    const reportPath = resolve(screenshotDir, "smoke-test-report.json");
    writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\n  Full report: ${reportPath}`);
    console.log(`  Screenshots: ${screenshotDir}\n`);

    await browser.close();
    process.exit(results.summary.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error(`\n💥 Fatal error: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    process.exit(2);
  }
}

main();
