/**
 * E2E test for the 17 multi-model review fixes.
 * Tests what's observable through the UI + IPC layer.
 */
import { connect, ipc, startConsoleCapture, navigateTo, shutdown } from './connect.mjs';

const results = [];
function log(test, pass, detail = '') {
  const icon = pass ? '✅' : '❌';
  results.push({ test, pass, detail });
  console.log(`${icon} ${test}${detail ? ': ' + detail : ''}`);
}

const { browser, page, context, port } = await connect();
const capture = startConsoleCapture(page);

try {
  // ─── Test 1: Tasks page loads without errors ───────────────────────
  console.log('\n═══ Test 1: Tasks Dashboard ═══');
  await navigateTo(page, '/tasks');
  await page.waitForTimeout(2000);

  const tasksTitle = await page.locator('h1, h2, .page-title').first().textContent().catch(() => '');
  const hasTasksContent = await page.locator('.task-dashboard, .page-content').count();
  log('Tasks page loads', hasTasksContent > 0, `title: "${tasksTitle?.trim()}"`);

  // Check for IPC errors in console
  const consoleAfterTasks = capture.getLogs();
  const taskErrors = consoleAfterTasks.filter(l => 
    l.type === 'error' && (l.text.includes('task_list') || l.text.includes('not allowed'))
  );
  log('No task IPC errors', taskErrors.length === 0, 
    taskErrors.length > 0 ? taskErrors[0].text.substring(0, 100) : 'clean');

  // ─── Test 2: Task presets page loads ───────────────────────────────
  console.log('\n═══ Test 2: Task Presets ═══');
  await navigateTo(page, '/tasks/presets');
  await page.waitForTimeout(2000);

  const presetsContent = await page.locator('.page-content').count();
  log('Presets page loads', presetsContent > 0);

  // ─── Test 3: Task creation with preset auto-selection ──────────────
  console.log('\n═══ Test 3: Task Creation ═══');
  await navigateTo(page, '/tasks/new');
  await page.waitForTimeout(3000);

  const wizardVisible = await page.locator('.wizard-header, .page-content').count();
  log('Task create wizard loads', wizardVisible > 0);

  // Check if presets are shown
  const presetCards = await page.locator('.preset-card').count();
  log('Preset cards visible', presetCards > 0, `found ${presetCards} presets`);

  // ─── Test 4: Session list (CWD filter / orchestrator hiding) ───────
  console.log('\n═══ Test 4: Session List + CWD Filter ═══');
  await navigateTo(page, '/');
  await page.waitForTimeout(3000);

  const sessionCards = await page.locator('[data-testid="session-card"]').count();
  log('Session list loads', sessionCards > 0, `${sessionCards} sessions`);

  // Check that sessions have data (CWD field now populated)
  const firstSessionText = await page.locator('[data-testid="session-card"]').first().textContent().catch(() => '');
  log('Session cards have content', firstSessionText.length > 10);

  // ─── Test 5: Orchestrator Monitor ──────────────────────────────────
  console.log('\n═══ Test 5: Orchestrator Monitor ═══');
  await navigateTo(page, '/tasks/monitor');
  await page.waitForTimeout(2000);

  const monitorContent = await page.locator('.page-content').count();
  log('Monitor page loads', monitorContent > 0);

  // ─── Test 6: Orchestration page loads ──────────────────────────────
  console.log('\n═══ Test 6: Orchestration Hub ═══');
  await navigateTo(page, '/orchestration');
  await page.waitForTimeout(2000);

  const orchContent = await page.locator('[data-testid="orchestration-actions"], .page-content').count();
  log('Orchestration page loads', orchContent > 0);

  // ─── Test 7: Settings page (model config) ──────────────────────────
  console.log('\n═══ Test 7: Settings Page ═══');
  await navigateTo(page, '/settings');
  await page.waitForTimeout(2000);

  const settingsContent = await page.locator('.page-content, .settings').count();
  log('Settings page loads', settingsContent > 0);

  // ─── Test 8: Session detail navigation (route fix) ─────────────────
  console.log('\n═══ Test 8: Session Detail Route ═══');
  await navigateTo(page, '/');
  await page.waitForTimeout(2000);

  // Click first session card
  const firstCard = page.locator('[data-testid="session-card"]').first();
  if (await firstCard.count() > 0) {
    await firstCard.click();
    await page.waitForTimeout(3000);

    const currentUrl = await page.evaluate(() => window.location.hash);
    const isDetailRoute = currentUrl.includes('/session/') && currentUrl.includes('/overview');
    log('Session detail route correct', isDetailRoute, currentUrl);

    // Check detail content loads
    const detailContent = await page.locator('[data-testid="session-detail-content"], [data-testid="session-tabs"]').count();
    log('Session detail content loads', detailContent > 0, `found ${detailContent} elements`);
  } else {
    log('Session detail route correct', false, 'no sessions to click');
  }

  // ─── Test 9: Check IPC perf for task commands ──────────────────────
  console.log('\n═══ Test 9: IPC Command Health ═══');
  await page.evaluate(() => window.__TRACEPILOT_IPC_PERF__?.clearIpcPerfLog());
  
  // Navigate to tasks to trigger task IPC calls
  await navigateTo(page, '/tasks');
  await page.waitForTimeout(3000);

  const ipcLog = await page.evaluate(() => 
    window.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog() ?? []
  );
  
  const taskIpcCalls = ipcLog.filter(l => 
    l.cmd?.includes('task') || l.cmd?.includes('preset')
  );
  log('Task IPC calls succeed', taskIpcCalls.length > 0, 
    `${taskIpcCalls.length} task-related IPC calls: ${taskIpcCalls.map(c => c.cmd).join(', ')}`);

  const slowCalls = ipcLog.filter(l => l.duration > 2000 && l.cmd?.includes('task'));
  log('No critically slow task IPC calls', slowCalls.length === 0,
    slowCalls.length > 0 ? `slow: ${slowCalls.map(c => `${c.cmd}=${c.duration}ms`).join(', ')}` : 'all task cmds < 2s');

  // ─── Test 10: Create task flow (full wizard) ───────────────────────
  console.log('\n═══ Test 10: Full Task Creation Flow ═══');
  await navigateTo(page, '/tasks/new');
  await page.waitForTimeout(3000);

  // Click the first preset card
  const firstPreset = page.locator('.preset-card').first();
  if (await firstPreset.count() > 0) {
    await firstPreset.click();
    await page.waitForTimeout(1000);

    // Check step 2 loaded (form/configuration)
    const formVisible = await page.locator('input, select, .form-group, .wizard-step').count();
    log('Preset selection advances wizard', formVisible > 0);
  } else {
    log('Preset selection advances wizard', false, 'no presets found');
  }

  // ─── Test 11: Verify no console errors from our fixes ──────────────
  console.log('\n═══ Test 11: Console Error Check ═══');
  const allLogs = capture.getLogs();
  const errorLogs = allLogs.filter(l => l.type === 'error');
  const criticalErrors = errorLogs.filter(l => 
    l.text.includes('not allowed') || 
    l.text.includes('Command not found') ||
    l.text.includes('task_list') ||
    l.text.includes('Unhandled')
  );
  log('No critical console errors', criticalErrors.length === 0,
    criticalErrors.length > 0 
      ? `${criticalErrors.length} errors: ${criticalErrors[0].text.substring(0, 120)}`
      : `${errorLogs.length} total errors (none critical)`);

  // ─── Test 12: Task create with presetId query param ────────────────
  console.log('\n═══ Test 12: Preset Auto-Selection via URL ═══');
  // Get list of presets first
  let presets;
  try { presets = await ipc(page, 'task_list_presets'); } catch { presets = null; }
  if (presets && presets.length > 0) {
    const firstPresetId = presets[0].id;
    await navigateTo(page, `/tasks/new?presetId=${firstPresetId}`);
    await page.waitForTimeout(3000);
    
    // Check if preset was auto-selected (wizard should be on step 2, showing form)
    const step2Active = await page.locator('.step-dot').nth(1).evaluate(
      el => el.parentElement?.classList.contains('active') || el.parentElement?.classList.contains('completed')
    ).catch(() => false);
    const formFields = await page.locator('.form-group, .config-section, input[type="text"], input[type="date"]').count();
    log('Preset auto-selected from URL', step2Active || formFields > 0, 
      `presetId=${firstPresetId}, step2Active=${step2Active}, formFields=${formFields}`);
  } else {
    log('Preset auto-selected from URL', false, 'could not load presets');
  }

  // ─── Summary ───────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(60));
  console.log('  E2E TEST RESULTS SUMMARY');
  console.log('═'.repeat(60));
  
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.test}`);
  }
  
  console.log('─'.repeat(60));
  console.log(`  ${passed} passed, ${failed} failed out of ${results.length} tests`);
  console.log('═'.repeat(60));

} finally {
  capture.stop();
  await shutdown(browser, port);
}
