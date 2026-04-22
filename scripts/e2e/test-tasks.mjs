import { connect, navigateTo, startConsoleCapture } from "./connect.mjs";

const { browser, page } = await connect();
const capture = startConsoleCapture(page);

console.log("=== Testing AI Task System Pages ===\n");

// 1. Navigate to Tasks Dashboard
console.log("1. Tasks Dashboard...");
await navigateTo(page, "/tasks");
await page.waitForTimeout(2000);
await page.screenshot({ path: "scripts/e2e/screenshots/tasks-dashboard.png", fullPage: true });
console.log("   Screenshot saved.");

// Check for errors
const dashboardErrors = capture.getLogs().filter((l) => l.type === "error");
if (dashboardErrors.length > 0) {
  console.log("   ERRORS:", dashboardErrors.map((e) => e.text).join("\n   "));
}

// 2. Test "Open Monitor" link
console.log('\n2. Testing "Open Monitor" button...');
const monitorBtn = page.locator('button:has-text("Open Monitor")');
if ((await monitorBtn.count()) > 0) {
  await monitorBtn.first().click();
  await page.waitForTimeout(2000);
  const url = page.url();
  console.log("   Navigated to:", url);
  await page.screenshot({ path: "scripts/e2e/screenshots/tasks-monitor.png", fullPage: true });
  console.log("   Screenshot saved.");
} else {
  console.log('   "Open Monitor" button not found');
}

// 3. Back to dashboard, test "Manage" link
console.log('\n3. Testing "Manage" presets button...');
await navigateTo(page, "/tasks");
await page.waitForTimeout(1500);
const manageBtn = page.locator('button:has-text("Manage")');
if ((await manageBtn.count()) > 0) {
  await manageBtn.first().click();
  await page.waitForTimeout(2000);
  const url = page.url();
  console.log("   Navigated to:", url);
  await page.screenshot({ path: "scripts/e2e/screenshots/tasks-presets.png", fullPage: true });
  console.log("   Screenshot saved.");
} else {
  console.log('   "Manage" button not found');
}

// 4. Navigate to Create Task
console.log("\n4. Create Task page...");
await navigateTo(page, "/tasks/new");
await page.waitForTimeout(2000);
await page.screenshot({ path: "scripts/e2e/screenshots/tasks-create.png", fullPage: true });
console.log("   Screenshot saved.");

// 5. Navigate to Monitor directly
console.log("\n5. Monitor page (direct)...");
await navigateTo(page, "/tasks/monitor");
await page.waitForTimeout(2000);
await page.screenshot({ path: "scripts/e2e/screenshots/tasks-monitor-direct.png", fullPage: true });
console.log("   Screenshot saved.");

// 6. Navigate to Presets directly
console.log("\n6. Presets page (direct)...");
await navigateTo(page, "/tasks/presets");
await page.waitForTimeout(2000);
await page.screenshot({ path: "scripts/e2e/screenshots/tasks-presets-direct.png", fullPage: true });
console.log("   Screenshot saved.");

// 7. Check sidebar navigation
console.log("\n7. Checking sidebar nav...");
const sidebar = await page.locator('[data-testid="app-sidebar"]');
const sidebarHTML = await sidebar.innerHTML();
const hasTasksNav = sidebarHTML.includes("Tasks") || sidebarHTML.includes("tasks");
console.log("   Has Tasks nav:", hasTasksNav);

// 8. Collect all console errors
const allErrors = capture.getLogs().filter((l) => l.type === "error");
console.log("\n=== Console Errors ===");
if (allErrors.length === 0) {
  console.log("None!");
} else {
  for (const err of allErrors) {
    console.log(`  [${err.type}] ${err.text.substring(0, 200)}`);
  }
}

// 9. Check IPC timing
const ipcLog = await page.evaluate(() => window.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog() ?? []);
const taskIpc = ipcLog.filter((l) => l.cmd?.startsWith("task_"));
console.log("\n=== Task IPC Calls ===");
for (const call of taskIpc) {
  console.log(`  ${call.cmd}: ${call.duration}ms`);
}

capture.stop();
console.log("\nDone! Check screenshots in scripts/e2e/screenshots/");

// Don't shutdown - leave app running for inspection
await browser.close();
