// E2E test for all task views — verifies rendering, no console errors, layout
import { connect, navigateTo, shutdown, startConsoleCapture } from "./connect.mjs";

const ROUTES = [
  { path: "/tasks", name: "Dashboard", wait: 2000 },
  { path: "/tasks/monitor", name: "Monitor", wait: 2000 },
  { path: "/tasks/presets", name: "Presets", wait: 2000 },
  { path: "/tasks/create", name: "Create Task", wait: 2000 },
];

async function run() {
  console.log("Connecting to TracePilot...");
  const { browser, page, port } = await connect();
  const capture = startConsoleCapture(page);
  const results = [];

  for (const route of ROUTES) {
    console.log(`\nNavigating to ${route.name} (${route.path})...`);
    await navigateTo(page, route.path);
    await page.waitForTimeout(route.wait);

    // Check for overflow
    const overflow = await page.evaluate(() => {
      const body = document.body;
      return {
        hasHorizontalOverflow: body.scrollWidth > body.clientWidth,
        scrollWidth: body.scrollWidth,
        clientWidth: body.clientWidth,
      };
    });

    // Take screenshot
    const screenshotPath = `scripts/e2e/screenshots/task-${route.name.toLowerCase().replace(/\s+/g, "-")}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const errors = capture.getLogs().filter((l) => l.type === "error");
    const warnings = capture
      .getLogs()
      .filter((l) => l.text.includes("[ipc:SLOW]") || l.text.includes("not allowed"));

    results.push({
      route: route.path,
      name: route.name,
      overflow: overflow.hasHorizontalOverflow,
      scrollWidth: overflow.scrollWidth,
      clientWidth: overflow.clientWidth,
      errors: errors.length,
      warnings: warnings.map((w) => w.text),
      screenshot: screenshotPath,
    });

    console.log(
      `  Overflow: ${overflow.hasHorizontalOverflow ? "YES ❌" : "No ✅"} (${overflow.scrollWidth}/${overflow.clientWidth})`,
    );
    console.log(`  Errors: ${errors.length}`);
    if (warnings.length > 0) {
      console.log(`  Warnings: ${warnings.map((w) => w.text).join(", ")}`);
    }
  }

  // Check dashboard specifically for quick presets rendering
  console.log("\n--- Dashboard Deep Check ---");
  await navigateTo(page, "/tasks");
  await page.waitForTimeout(2000);

  const dashboardInfo = await page.evaluate(() => {
    const stats = document.querySelectorAll(".stat-card-value");
    const orchCard = document.querySelector(".orch-card");
    const presetCards = document.querySelectorAll(".quick-preset-card");
    return {
      statCount: stats.length,
      hasOrchCard: !!orchCard,
      presetCardCount: presetCards.length,
    };
  });
  console.log(
    `  Stats: ${dashboardInfo.statCount}, Orch card: ${dashboardInfo.hasOrchCard}, Preset cards: ${dashboardInfo.presetCardCount}`,
  );

  // Check presets page for layout
  console.log("\n--- Presets Deep Check ---");
  await navigateTo(page, "/tasks/presets");
  await page.waitForTimeout(2000);

  const presetsInfo = await page.evaluate(() => {
    const grid = document.querySelector(".preset-grid");
    const cards = document.querySelectorAll(".preset-card");
    const gridStyles = grid ? window.getComputedStyle(grid) : null;
    return {
      cardCount: cards.length,
      gridGap: gridStyles?.gap,
      gridTemplateColumns: gridStyles?.gridTemplateColumns,
    };
  });
  console.log(
    `  Cards: ${presetsInfo.cardCount}, Gap: ${presetsInfo.gridGap}, Columns: ${presetsInfo.gridTemplateColumns}`,
  );

  // Summary
  console.log("\n=== E2E Test Summary ===");
  const allPassed = results.every((r) => !r.overflow && r.errors === 0);
  for (const r of results) {
    const status = !r.overflow && r.errors === 0 ? "✅" : "❌";
    console.log(`  ${status} ${r.name}: overflow=${r.overflow}, errors=${r.errors}`);
  }
  console.log(`\nOverall: ${allPassed ? "ALL PASSED ✅" : "SOME FAILED ❌"}`);

  capture.stop();
  await shutdown(browser, port);
  process.exit(allPassed ? 0 : 1);
}

run().catch((err) => {
  console.error("E2E test failed:", err.message);
  process.exit(1);
});
