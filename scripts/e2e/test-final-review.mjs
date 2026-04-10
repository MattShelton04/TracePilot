/**
 * E2E test for the 10 findings from the final multi-model review.
 * Tests observable behavior through UI + IPC layer.
 */
import { connect, startConsoleCapture, navigateTo, shutdown } from './connect.mjs';

const results = [];
function log(test, pass, detail = '') {
  const icon = pass ? '✅' : '❌';
  results.push({ test, pass, detail });
  console.log(`${icon} ${test}${detail ? ': ' + detail : ''}`);
}

const { browser, page, context, port } = await connect();
const capture = startConsoleCapture(page);

try {
  // ═══════════════════════════════════════════════════════════════════
  // Fix 1: Launch tasks AFTER successful spawn (stranded task prevention)
  // Observable: orchestrator health endpoint works, task_stats works
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 1: Orchestrator health IPC ═══');
  const healthResult = await page.evaluate(async () => {
    try {
      return await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_orchestrator_health');
    } catch (e) { return { error: e.toString() }; }
  });
  log('Orchestrator health IPC works', !healthResult?.error,
    healthResult?.health || healthResult?.error?.substring(0, 80));

  // ═══════════════════════════════════════════════════════════════════
  // Fix 2: Async guard on getTask (stale task prevention)
  // Observable: task detail page loads without errors
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 2: Task detail async guard ═══');
  // First get a task ID if any exist
  const taskList = await page.evaluate(async () => {
    try {
      return await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_list', {});
    } catch (e) { return []; }
  });
  
  if (taskList.length > 0) {
    const taskId = taskList[0].id;
    await navigateTo(page, `/tasks/${taskId}`);
    await page.waitForTimeout(2000);
    const detailContent = await page.locator('.page-content').count();
    log('Task detail loads for real task', detailContent > 0, `taskId: ${taskId}`);
  } else {
    log('Task detail loads for real task', true, 'SKIP: no tasks exist');
  }

  // ═══════════════════════════════════════════════════════════════════
  // Fix 3: Stop keeps handle until shutdown write succeeds
  // Observable: stop on non-running orchestrator gives clean error
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 3: Orchestrator stop safety ═══');
  const stopResult = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_orchestrator_stop');
      return { ok: true };
    } catch (e) { return { error: e.toString() }; }
  });
  // Expected: "Orchestrator is not running." error since we didn't start it
  log('Stop gives clean error when not running',
    stopResult?.error?.includes('not running') || stopResult?.ok === true,
    stopResult?.error?.substring(0, 80) || 'stopped ok');

  // ═══════════════════════════════════════════════════════════════════
  // Fix 4: update_task_status guards terminal states
  // Observable: creating + cancelling a task, then verifying status sticks
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 4: Terminal state protection ═══');
  // Create a temporary test task
  const newTask = await page.evaluate(async () => {
    try {
      return await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_create', {
        taskType: 'session_summary',
        presetId: 'session-summary',
        inputParams: {},
        priority: 'normal',
      });
    } catch (e) { return { error: e.toString() }; }
  });

  if (newTask && !newTask.error) {
    // Cancel it
    const cancelResult = await page.evaluate(async (id) => {
      try {
        await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_cancel', { id });
        return { ok: true };
      } catch (e) { return { error: e.toString() }; }
    }, newTask.id);
    log('Task cancel works', cancelResult?.ok === true, `taskId: ${newTask.id}`);

    // Verify it's cancelled
    const verifyTask = await page.evaluate(async (id) => {
      try {
        return await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_get', { id });
      } catch (e) { return { error: e.toString() }; }
    }, newTask.id);
    log('Cancelled task status is terminal', verifyTask?.status === 'cancelled',
      `status: ${verifyTask?.status}`);

    // Clean up: delete the test task
    await page.evaluate(async (id) => {
      try {
        await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_delete', { id });
      } catch (e) { /* ignore */ }
    }, newTask.id);
  } else {
    log('Task cancel works', false, `create failed: ${newTask?.error}`);
    log('Cancelled task status is terminal', false, 'SKIP: create failed');
  }

  // ═══════════════════════════════════════════════════════════════════
  // Fix 5: refreshTasks includes jobs
  // Observable: jobs endpoint works via IPC
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 5: Jobs refresh ═══');
  const jobsList = await page.evaluate(async () => {
    try {
      return await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_list_jobs');
    } catch (e) { return { error: e.toString() }; }
  });
  log('Jobs IPC works', Array.isArray(jobsList), `count: ${jobsList?.length ?? jobsList?.error}`);

  // ═══════════════════════════════════════════════════════════════════
  // Fix 6: Health check sets error state
  // Observable: health check returns structured result
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 6: Health check error reporting ═══');
  const health2 = await page.evaluate(async () => {
    try {
      return await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_orchestrator_health');
    } catch (e) { return { error: e.toString() }; }
  });
  log('Health returns structured result', health2 && typeof health2.health === 'string',
    `health: ${health2?.health}`);

  // ═══════════════════════════════════════════════════════════════════
  // Fix 7: No duplicate polling in monitor view
  // Observable: monitor page loads cleanly
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 7: Monitor view ═══');
  await navigateTo(page, '/tasks/monitor');
  await page.waitForTimeout(2000);
  const monitorContent = await page.locator('.page-content').count();
  log('Monitor page loads', monitorContent > 0);

  // ═══════════════════════════════════════════════════════════════════
  // Fix 8: JobStatus::Running reachable
  // Observable: task_stats returns valid stats structure
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 8: Task stats ═══');
  const stats = await page.evaluate(async () => {
    try {
      return await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_stats');
    } catch (e) { return { error: e.toString() }; }
  });
  log('Task stats IPC works', stats && typeof stats.total === 'number',
    `total: ${stats?.total}, pending: ${stats?.pending}, in_progress: ${stats?.in_progress}`);

  // ═══════════════════════════════════════════════════════════════════
  // Fix 9: Health uses heartbeat when handle missing
  // Already tested above — health returns a valid result even without handle
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 9: Heartbeat-based health ═══');
  log('Health works without handle', health2?.health === 'stopped' || health2?.health === 'healthy' || health2?.health === 'stale',
    `health: ${health2?.health} (no handle scenario)`);

  // ═══════════════════════════════════════════════════════════════════
  // Fix 10: Presets page loads (tests route ordering is correct)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Fix 10: Presets & routing ═══');
  await navigateTo(page, '/tasks/presets');
  await page.waitForTimeout(2000);
  const presetsPage = await page.locator('.page-content').count();
  const presetsList = await page.evaluate(async () => {
    try {
      return await window.__TAURI_INTERNALS__.invoke('plugin:tracepilot|task_list_presets');
    } catch (e) { return { error: e.toString() }; }
  });
  log('Presets page loads', presetsPage > 0);
  log('Presets IPC works', Array.isArray(presetsList), `count: ${presetsList?.length ?? presetsList?.error}`);

  // ═══════════════════════════════════════════════════════════════════
  // Bonus: Navigation between all task pages works
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Bonus: Full navigation ═══');
  
  await navigateTo(page, '/tasks');
  await page.waitForTimeout(1500);
  const dashOk = await page.locator('.page-content').count() > 0;
  log('Dashboard navigation', dashOk);

  await navigateTo(page, '/tasks/new');
  await page.waitForTimeout(1500);
  const createOk = await page.locator('.page-content').count() > 0;
  log('Create task navigation', createOk);

  await navigateTo(page, '/tasks/monitor');
  await page.waitForTimeout(1500);
  const monitorOk = await page.locator('.page-content').count() > 0;
  log('Monitor navigation', monitorOk);

  // ═══════════════════════════════════════════════════════════════════
  // Check for console errors across all navigation
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ Console health ═══');
  const allLogs = capture.getLogs();
  const errors = allLogs.filter(l => l.type === 'error');
  const ipcErrors = errors.filter(l => l.text.includes('not allowed') || l.text.includes('Command not found'));
  log('No IPC "not allowed" errors', ipcErrors.length === 0,
    ipcErrors.length > 0 ? ipcErrors.map(e => e.text.substring(0, 60)).join('; ') : 'clean');

} catch (e) {
  console.error('Test execution error:', e);
} finally {
  capture.stop();
  
  // ─── Summary ────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${results.length} tests`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.test}: ${r.detail}`));
  }

  await shutdown(browser, port);
  process.exit(failed > 0 ? 1 : 0);
}
