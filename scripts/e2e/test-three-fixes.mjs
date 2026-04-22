/**
 * E2E test for three fixes:
 * 1. Preset edit button works from detail slidein
 * 2. Context source schema is visible in edit modal
 * 3. Stale orchestrator stop fallback works
 */
import { connect, ipc, shutdown } from "./connect.mjs";

const { browser, page, port } = await connect();
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

console.log("\n🧪 Testing three fixes...\n");

// Navigate to presets page
await page.evaluate(() => {
  window.location.hash = "#/tasks/presets";
});
await page.waitForTimeout(2000);

// --- Fix 1: Preset edit button from detail slidein ---
await test("Fix 1: Click preset to open detail slideover", async () => {
  const cards = await page.locator(".preset-card").all();
  assert(cards.length > 0, "No preset cards found");
  await cards[0].click();
  await page.waitForTimeout(600);
  const slideover = page.locator(".preset-slideover");
  assert((await slideover.count()) > 0, "Detail slideover did not open");
});

await test("Fix 1: Edit button in slideover opens edit modal", async () => {
  // The edit button is inside .detail-panel__footer in the slideover
  const editBtn = page.locator(".detail-panel__footer .btn--secondary").filter({ hasText: "Edit" });
  assert((await editBtn.count()) > 0, "Edit button not found in detail footer");
  await editBtn.click();
  await page.waitForTimeout(600);

  // The edit modal should be visible (slideover should be closed)
  const editModal = page.locator('[aria-label="Edit preset"]');
  assert((await editModal.count()) > 0, "Edit modal did not open — fix not working");

  // Close the modal
  await page.locator(".modal__close").first().click();
  await page.waitForTimeout(300);
});

// --- Fix 2: Context source schema in edit modal ---
await test("Fix 2: Open edit modal from card action", async () => {
  // Click edit button directly on a card (not via detail panel)
  const editBtn = page.locator('[title="Edit preset"]').first();
  assert((await editBtn.count()) > 0, "No card edit button found");
  await editBtn.click({ force: true });
  await page.waitForTimeout(600);

  const editModal = page.locator('[aria-label="Edit preset"]');
  assert((await editModal.count()) > 0, "Edit modal not visible");
});

await test("Fix 2: Add source shows schema-driven fields", async () => {
  // Click "+ Add Source" button
  const addBtn = page
    .locator("button")
    .filter({ hasText: /Add Source/ })
    .first();
  assert((await addBtn.count()) > 0, "Add Source button not found");
  await addBtn.click();
  await page.waitForTimeout(300);

  // session_export is default — should show description and schema fields
  const info = await page.evaluate(() => {
    return {
      descs: document.querySelectorAll(".ctx-source-desc").length,
      hints: document.querySelectorAll(".ctx-schema-hint").length,
      fields: document.querySelectorAll(".ctx-schema-field").length,
      warnings: document.querySelectorAll(".ctx-source-hint").length,
    };
  });
  assert(info.descs > 0, `Expected source description, got ${info.descs}`);
  assert(info.fields > 0, `Expected schema fields, got ${info.fields}`);
});

await test("Fix 2: Changing type to multi_session_digest shows its config", async () => {
  const select = page.locator(".ctx-source-top select").first();
  await select.selectOption("multi_session_digest");
  await page.waitForTimeout(300);

  const fieldCount = await page.locator(".ctx-schema-field").count();
  // multi_session_digest has 3 schema fields: window_hours, max_sessions, include_exports
  assert(fieldCount >= 3, `Expected >=3 schema fields, got ${fieldCount}`);

  // Check that the description updated
  const desc = await page.locator(".ctx-source-desc").first().textContent();
  assert(
    desc.includes("time window") || desc.includes("digest"),
    `Description doesn't match: ${desc}`,
  );
});

// Close edit modal
await page.locator(".modal__close").first().click();
await page.waitForTimeout(300);

// --- Fix 3: Stale orchestrator force-stop ---
await test("Fix 3: Stop without handle gives clean error", async () => {
  let result;
  try {
    await ipc(page, "task_orchestrator_stop");
    result = { ok: true };
  } catch (e) {
    result = { ok: false, error: String(e) };
  }
  // Should either succeed (manifest exists) or give a clear error (no manifest)
  if (!result.ok) {
    assert(
      result.error.includes("not running") || result.error.includes("manifest"),
      `Unexpected error: ${result.error}`,
    );
  }
});

await test("Fix 3: Health check returns valid state", async () => {
  let result;
  try {
    result = await ipc(page, "task_orchestrator_health");
  } catch (e) {
    result = { error: String(e) };
  }
  assert(!result.error, `Health check failed: ${result.error}`);
  assert(
    ["healthy", "stale", "stopped", "unknown"].includes(result.health),
    `Invalid health: ${result.health}`,
  );
});

console.log(`\n📊 Results: ${passed}/${passed + failed} passed\n`);

await shutdown(browser, port);
process.exit(failed > 0 ? 1 : 0);
