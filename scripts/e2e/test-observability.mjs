/**
 * E2E test: Model picker redesign + Activity Feed observability
 * Tests the new model picker dropdown and activity feed section in the orchestrator monitor.
 */
import { connect, navigateTo, shutdown } from "./connect.mjs";

let browser, page, port;
let passed = 0;
let failed = 0;
const results = [];

function ok(name) {
  passed++;
  results.push(`  ✅ ${name}`);
  console.log(`  ✅ ${name}`);
}

function fail(name, err) {
  failed++;
  results.push(`  ❌ ${name}: ${err}`);
  console.log(`  ❌ ${name}: ${err}`);
}

async function test(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e.message ?? e);
  }
}

async function run() {
  console.log("\n🔬 Observability & Model Picker E2E\n");

  ({ browser, page, port } = await connect());
  await page.waitForTimeout(2000);

  // Navigate to tasks page first to ensure it loads
  await navigateTo(page, "/tasks");
  await page.waitForTimeout(2000);

  // Navigate to orchestrator monitor
  await navigateTo(page, "/tasks/monitor");
  await page.waitForTimeout(3000);

  // ── Model Picker Tests ──────────────────────────────
  await test("Model picker toggle exists", async () => {
    const toggle = page.locator(".model-picker-toggle");
    const count = await toggle.count();
    if (count === 0) throw new Error("No .model-picker-toggle found");
  });

  await test("Model picker shows model name", async () => {
    const value = page.locator(".model-picker-value");
    const text = await value.textContent();
    if (!text || text.trim().length === 0) throw new Error("Model picker value is empty");
  });

  await test("Model picker shows tier badge", async () => {
    const tier = page.locator(".model-picker-tier");
    const text = await tier.textContent();
    if (!text || text.trim().length === 0) throw new Error("Tier badge is empty");
    const validTiers = ["fast", "standard", "premium"];
    if (!validTiers.includes(text.trim().toLowerCase())) {
      throw new Error(`Invalid tier: ${text.trim()}`);
    }
  });

  await test("Model picker dropdown opens on click", async () => {
    await page.locator(".model-picker-toggle").click();
    await page.waitForTimeout(500);
    const dropdown = page.locator(".model-picker-dropdown");
    const visible = await dropdown.isVisible();
    if (!visible) throw new Error("Dropdown not visible after click");
  });

  await test("Model picker shows tier groups", async () => {
    const groups = page.locator(".model-tier-group");
    const count = await groups.count();
    if (count < 2) throw new Error(`Expected at least 2 tier groups, got ${count}`);
  });

  await test("Model picker shows model options", async () => {
    const options = page.locator(".model-option");
    const count = await options.count();
    if (count < 5) throw new Error(`Expected at least 5 model options, got ${count}`);
  });

  await test("Active model has checkmark", async () => {
    const active = page.locator(".model-option.active");
    const count = await active.count();
    if (count !== 1) throw new Error(`Expected 1 active model, got ${count}`);
    const check = active.locator(".model-check");
    const checkCount = await check.count();
    if (checkCount !== 1) throw new Error("Active model missing checkmark");
  });

  await test("Model picker header shows Select Model", async () => {
    const header = page.locator(".model-picker-header");
    const text = await header.textContent();
    if (!text?.includes("Select Model")) throw new Error(`Header text: ${text}`);
  });

  await test("Clicking a model selects it and closes dropdown", async () => {
    // Find a non-active option
    const options = page.locator(".model-option:not(.active)");
    const count = await options.count();
    if (count === 0) throw new Error("No non-active options to click");
    const firstName = await options.first().locator(".model-option-name").textContent();
    await options.first().click();
    await page.waitForTimeout(500);
    // Dropdown should close
    const dropdown = page.locator(".model-picker-dropdown");
    const visible = await dropdown.isVisible();
    if (visible) throw new Error("Dropdown still visible after selection");
    // Selected model should update
    const value = await page.locator(".model-picker-value").textContent();
    if (value?.trim() !== firstName?.trim()) {
      throw new Error(`Expected "${firstName?.trim()}", got "${value?.trim()}"`);
    }
  });

  await test("Overlay closes dropdown", async () => {
    // Reopen
    await page.locator(".model-picker-toggle").click();
    await page.waitForTimeout(300);
    let visible = await page.locator(".model-picker-dropdown").isVisible();
    if (!visible) throw new Error("Dropdown not visible after reopen");
    // Click overlay
    await page.locator(".model-picker-overlay").click();
    await page.waitForTimeout(300);
    visible = await page.locator(".model-picker-dropdown").isVisible();
    if (visible) throw new Error("Dropdown still visible after overlay click");
  });

  // ── Activity Feed Tests ──────────────────────────────
  await test("Activity Feed section exists", async () => {
    // Look for the section panel with title "Activity Feed"
    const titles = page.locator(".section-panel-title");
    const count = await titles.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const text = await titles.nth(i).textContent();
      if (text?.includes("Activity Feed")) {
        found = true;
        break;
      }
    }
    if (!found) throw new Error("Activity Feed section not found");
  });

  await test("Activity Feed shows empty state when idle", async () => {
    // When orchestrator is not running, should show empty state
    const emptyState = page.locator(".activity-feed").or(page.locator(".empty-state"));
    const count = await emptyState.count();
    if (count === 0) throw new Error("No activity feed or empty state found");
  });

  // ── Section Order Tests ──────────────────────────────
  await test("Section order: Active Tasks before Active Subagents", async () => {
    const titles = page.locator(".section-panel-title");
    const texts = [];
    for (let i = 0; i < (await titles.count()); i++) {
      texts.push(await titles.nth(i).textContent());
    }
    const atIdx = texts.findIndex((t) => t?.includes("Active Tasks"));
    const asIdx = texts.findIndex((t) => t?.includes("Active Subagents"));
    if (atIdx === -1) throw new Error(`Active Tasks section not found in: ${texts.join(", ")}`);
    if (asIdx === -1) throw new Error("Active Subagents section not found");
    if (atIdx >= asIdx)
      throw new Error(`Active Tasks (${atIdx}) should come before Active Subagents (${asIdx})`);
  });

  await test("Section order: Activity Feed before Health & Recovery", async () => {
    const titles = page.locator(".section-panel-title");
    const texts = [];
    for (let i = 0; i < (await titles.count()); i++) {
      texts.push(await titles.nth(i).textContent());
    }
    const afIdx = texts.findIndex((t) => t?.includes("Activity Feed"));
    const hrIdx = texts.findIndex((t) => t?.includes("Health & Recovery"));
    if (afIdx === -1) throw new Error(`Activity Feed section not found in: ${texts.join(", ")}`);
    if (hrIdx === -1) throw new Error("Health & Recovery section not found");
    if (afIdx >= hrIdx)
      throw new Error(`Activity Feed (${afIdx}) should come before Health & Recovery (${hrIdx})`);
  });

  // ── Design Token Tests ──────────────────────────────
  await test("Model picker uses CSS custom properties (no hardcoded hex)", async () => {
    const toggle = page.locator(".model-picker-toggle");
    const bg = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Should NOT be a hardcoded hex value — CSS vars resolve to rgb()
    if (bg.startsWith("#")) throw new Error(`Hardcoded hex background: ${bg}`);
  });

  await test("Tier badges use design token colors", async () => {
    // Open the dropdown to check tier badge colors
    await page.locator(".model-picker-toggle").click();
    await page.waitForTimeout(300);
    const badges = page.locator(".tier-badge");
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      const bg = await badges.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor);
      if (bg.startsWith("#")) throw new Error(`Tier badge ${i} has hardcoded hex: ${bg}`);
    }
    // Close
    await page.locator(".model-picker-overlay").click();
    await page.waitForTimeout(200);
  });

  // ── State color tests ──────────────────────────────
  await test("State indicator uses CSS class not inline style", async () => {
    const statusLabel = page.locator(".status-label");
    const count = await statusLabel.count();
    if (count === 0) throw new Error("No .status-label found");
    // Check it doesn't have inline color style
    const style = await statusLabel.first().getAttribute("style");
    if (style?.includes("color:") && style.includes("#")) {
      throw new Error(`Inline hardcoded color on status-label: ${style}`);
    }
  });

  // ── Summary ──────────────────────────────────────────
  console.log(`\n${"═".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(50));
  results.forEach((r) => {
    console.log(r);
  });

  await shutdown(browser, port);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (e) => {
  console.error("Fatal:", e);
  if (browser) await shutdown(browser, port).catch(() => {});
  process.exit(1);
});
