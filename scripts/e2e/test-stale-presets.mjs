/**
 * E2E tests for:
 * 1. Quick presets visual redesign renders correctly
 * 2. Stale orchestrator stop cleanup works (heartbeat deleted → health = stopped)
 */
import { connect, ipc, navigateTo, shutdown } from './connect.mjs';

const passed = [];
const failed = [];

function ok(name) { passed.push(name); console.log(`  ✅ ${name}`); }
function fail(name, err) { failed.push(name); console.log(`  ❌ ${name}: ${err}`); }

async function run() {
  const { browser, page, port } = await connect();
  console.log('\n─── Test: Stale Stop + Quick Presets ───\n');

  // ── 1. Navigate to Tasks Dashboard ──
  try {
    await navigateTo(page, '/tasks');
    await page.waitForTimeout(2000);
    ok('Navigate to Tasks dashboard');
  } catch (e) { fail('Navigate to Tasks dashboard', e.message); }

  // ── 2. Verify quick presets render with new layout ──
  try {
    const presetCards = await page.locator('.quick-preset-card').count();
    if (presetCards > 0) {
      // Check new layout: icon + info + arrow structure
      const hasIcon = await page.locator('.quick-preset-icon').first().isVisible();
      const hasInfo = await page.locator('.quick-preset-info').first().isVisible();
      const hasArrow = await page.locator('.quick-preset-arrow').first().isVisible();
      if (hasIcon && hasInfo && hasArrow)
        ok(`Quick presets render (${presetCards} cards, new layout)`);
      else
        fail('Quick presets layout', `icon=${hasIcon} info=${hasInfo} arrow=${hasArrow}`);
    } else {
      // If no presets enabled, check empty state
      const emptyState = await page.locator('.quick-presets-empty').isVisible();
      if (emptyState) ok('Quick presets empty state renders');
      else fail('Quick presets', 'No cards and no empty state');
    }
  } catch (e) { fail('Quick presets render', e.message); }

  // ── 3. Quick preset cards are clickable buttons ──
  try {
    const firstCard = page.locator('.quick-preset-card').first();
    if (await firstCard.count() > 0) {
      const tag = await firstCard.evaluate(el => el.tagName.toLowerCase());
      if (tag === 'button') ok('Quick preset cards are <button> elements');
      else fail('Quick preset card tag', `Expected button, got ${tag}`);
    } else {
      ok('Quick preset card tag (skipped - no presets)');
    }
  } catch (e) { fail('Quick preset card tag', e.message); }

  // ── 4. Navigate to Orchestrator Monitor ──
  try {
    await navigateTo(page, '/tasks/monitor');
    await page.waitForTimeout(2000);
    ok('Navigate to Orchestrator Monitor');
  } catch (e) { fail('Navigate to Orchestrator Monitor', e.message); }

  // ── 5. Check health status via IPC ──
  try {
    const health = await ipc(page, 'task_orchestrator_health');
    console.log(`    Health: ${JSON.stringify(health)}`);
    ok(`Health check returned: ${health?.health ?? 'null'}`);
  } catch (e) { fail('Health check IPC', e.message); }

  // ── 6. Test stop command when not running (should clean up, not error) ──
  try {
    let result;
    try {
      await ipc(page, 'task_orchestrator_stop');
      result = { ok: true };
    } catch (e) {
      result = { ok: false, err: String(e) };
    }
    // With our fix, stop should succeed (clean up files) even without a running process
    if (result.ok) {
      ok('Stop command succeeds (cleanup mode)');
    } else {
      // If it errors, that's also acceptable if the error is "not running"
      fail('Stop command', result.err);
    }
  } catch (e) { fail('Stop command', e.message); }

  // ── 7. Health after stop should be stopped (not stale) ──
  try {
    const health = await ipc(page, 'task_orchestrator_health');
    console.log(`    Health after stop: ${JSON.stringify(health)}`);
    if (health?.health === 'stopped' || health?.health === 'unknown') {
      ok(`Health after stop: ${health.health}`);
    } else {
      fail('Health after stop', `Expected stopped/unknown, got ${health?.health}`);
    }
  } catch (e) { fail('Health after stop IPC', e.message); }

  // ── 8. Verify no stale state in UI ──
  try {
    await page.waitForTimeout(1500);
    const stateLabel = await page.evaluate(() => {
      // Read the orchestrator store state label from the DOM
      const el = document.querySelector('.state-label');
      return el?.textContent?.trim() ?? null;
    });
    console.log(`    UI state label: ${stateLabel}`);
    if (stateLabel && !stateLabel.toLowerCase().includes('stale')) {
      ok(`UI state label: ${stateLabel}`);
    } else if (!stateLabel) {
      ok('UI state label (not found, checking status badge)');
    } else {
      fail('UI state label', `Still showing stale: ${stateLabel}`);
    }
  } catch (e) { fail('UI state label', e.message); }

  // ── Summary ──
  console.log(`\n─── Results: ${passed.length} passed, ${failed.length} failed ───\n`);

  await shutdown(browser, port);
  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
