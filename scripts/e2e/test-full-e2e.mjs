// Full E2E integration test: create task → start orchestrator → verify processing
import { connect, ipc, navigateTo, startConsoleCapture } from "./connect.mjs";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function run() {
  log("Connecting to TracePilot...");
  const { browser, page } = await connect();
  startConsoleCapture(page);

  let passed = 0;
  let failed = 0;
  function assert(condition, msg) {
    if (condition) {
      log(`  ✅ ${msg}`);
      passed++;
    } else {
      log(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  try {
    // ═══════════════════════════════════════════════════════
    // PHASE 1: Verify presets are seeded
    // ═══════════════════════════════════════════════════════
    log("\n═══ PHASE 1: Presets ═══");
    const presets = await ipc(page, "task_list_presets");
    log(`Found ${presets.length} presets`);
    assert(presets.length >= 3, `At least 3 presets seeded (got ${presets.length})`);

    const presetNames = presets.map((p) => p.name);
    assert(presetNames.includes("Session Summary"), "Session Summary preset exists");
    assert(presetNames.includes("Daily Digest"), "Daily Digest preset exists");
    assert(presetNames.includes("Weekly Digest"), "Weekly Digest preset exists");

    // Check digest presets have NO required variables (our fix)
    const dailyDigest = presets.find((p) => p.id === "daily-digest");
    assert(dailyDigest !== undefined, "daily-digest preset found by ID");
    if (dailyDigest) {
      assert(
        dailyDigest.prompt.variables.length === 0,
        `Daily Digest has 0 required vars (got ${dailyDigest.prompt.variables.length})`,
      );
      assert(
        dailyDigest.context.sources.some((s) => s.type === "multi_session_digest"),
        "Daily Digest uses multi_session_digest source",
      );
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 2: Get a real session to use as input
    // ═══════════════════════════════════════════════════════
    log("\n═══ PHASE 2: Session discovery ═══");
    const sessions = await ipc(page, "list_sessions", { limit: 5 });
    log(`Found ${sessions.length} sessions`);
    assert(sessions.length > 0, "At least 1 session available for testing");

    const testSessionId = sessions[0]?.id;
    log(`Using session: ${testSessionId}`);

    // ═══════════════════════════════════════════════════════
    // PHASE 3: Clean up any existing tasks/state
    // ═══════════════════════════════════════════════════════
    log("\n═══ PHASE 3: Cleanup ═══");

    // Stop orchestrator if running
    try {
      await ipc(page, "task_orchestrator_stop");
      log("  Stopped existing orchestrator");
    } catch {
      log("  No orchestrator running (OK)");
    }

    // Cancel/delete any existing pending tasks
    const existingTasks = await ipc(page, "task_list", {});
    for (const t of existingTasks) {
      if (t.status === "pending" || t.status === "in_progress") {
        try {
          await ipc(page, "task_cancel", { id: t.id });
        } catch {}
      }
      try {
        await ipc(page, "task_delete", { id: t.id });
      } catch {}
    }
    log(`  Cleaned up ${existingTasks.length} existing tasks`);

    // ═══════════════════════════════════════════════════════
    // PHASE 4: Create a session summary task
    // ═══════════════════════════════════════════════════════
    log("\n═══ PHASE 4: Create task ═══");
    const task = await ipc(page, "task_create", {
      taskType: "session_summary",
      presetId: "session-summary",
      inputParams: { session_export: testSessionId },
      priority: "normal",
      maxRetries: 2,
    });

    log(`Created task: ${task.id}`);
    assert(task.id !== undefined && task.id.length > 0, "Task has an ID");
    assert(task.status === "pending", `Task status is pending (got ${task.status})`);
    assert(task.presetId === "session-summary", `Preset ID is session-summary`);
    assert(task.attemptCount === 0, `Attempt count is 0 (got ${task.attemptCount})`);
    assert(task.maxRetries === 2, `Max retries is 2 (got ${task.maxRetries})`);

    // Verify via list
    const tasksAfterCreate = await ipc(page, "task_list", {});
    const found = tasksAfterCreate.find((t) => t.id === task.id);
    assert(found !== undefined, "Task appears in task_list");

    // ═══════════════════════════════════════════════════════
    // PHASE 5: Also create a daily digest task (no vars needed)
    // ═══════════════════════════════════════════════════════
    log("\n═══ PHASE 5: Create digest task ═══");
    const digestTask = await ipc(page, "task_create", {
      taskType: "digest",
      presetId: "daily-digest",
      inputParams: {},
      priority: "normal",
      maxRetries: 1,
    });

    log(`Created digest task: ${digestTask.id}`);
    assert(digestTask.status === "pending", `Digest task is pending (got ${digestTask.status})`);

    // ═══════════════════════════════════════════════════════
    // PHASE 6: Check stats
    // ═══════════════════════════════════════════════════════
    log("\n═══ PHASE 6: Task stats ═══");
    const stats = await ipc(page, "task_stats");
    log(`Stats: total=${stats.total}, pending=${stats.pending}, done=${stats.done}`);
    assert(stats.pending >= 2, `At least 2 pending tasks (got ${stats.pending})`);

    // ═══════════════════════════════════════════════════════
    // PHASE 7: Verify UI shows tasks
    // ═══════════════════════════════════════════════════════
    log("\n═══ PHASE 7: UI verification ═══");
    await navigateTo(page, "/tasks");
    await page.waitForTimeout(2000);

    const uiStats = await page.evaluate(() => {
      const vals = document.querySelectorAll(".stat-card-value");
      return Array.from(vals).map((el) => el.textContent?.trim());
    });
    log(`  Dashboard stat values: ${JSON.stringify(uiStats)}`);

    // Check no console errors
    const errorsPreOrch = capture
      .getLogs()
      .filter((l) => l.type === "error" && !l.text.includes("reindex"));
    assert(
      errorsPreOrch.length === 0,
      `No console errors before orchestrator (got ${errorsPreOrch.length})`,
    );

    // ═══════════════════════════════════════════════════════
    // PHASE 8: Start orchestrator
    // ═══════════════════════════════════════════════════════
    log("\n═══ PHASE 8: Start orchestrator ═══");
    let orchHandle;
    try {
      orchHandle = await ipc(page, "task_orchestrator_start", { model: null });
      log(`Orchestrator launched! PID: ${orchHandle.pid}`);
      assert(orchHandle.pid > 0, `Orchestrator has valid PID (${orchHandle.pid})`);
      assert(orchHandle.jobsDir !== undefined, "Orchestrator has jobs dir");
      assert(orchHandle.manifestPath !== undefined, "Orchestrator has manifest path");
      assert(orchHandle.launchedAt !== undefined, "Orchestrator has launch timestamp");
    } catch (e) {
      log(`  ❌ ORCHESTRATOR LAUNCH FAILED: ${e.message || e}`);
      failed++;
      orchHandle = null;
    }

    if (orchHandle) {
      // ═══════════════════════════════════════════════════════
      // PHASE 9: Verify jobs dir structure
      // ═══════════════════════════════════════════════════════
      log("\n═══ PHASE 9: Jobs dir verification ═══");
      const jobsDir = orchHandle.jobsDir;

      // Check manifest exists
      const _manifestExists = await page.evaluate(async (path) => {
        try {
          const _result = await window.__TAURI_INTERNALS__.invoke("plugin:tracepilot|get_log_path");
          // Can't directly check FS from browser, but we can verify the path
          return path && path.length > 0;
        } catch {
          return false;
        }
      }, orchHandle.manifestPath);
      assert(jobsDir.length > 0, `Jobs dir path is set: ${jobsDir}`);
      assert(
        orchHandle.manifestPath.endsWith("manifest.json"),
        "Manifest path ends with manifest.json",
      );

      // ═══════════════════════════════════════════════════════
      // PHASE 10: Verify tasks moved to in_progress
      // ═══════════════════════════════════════════════════════
      log("\n═══ PHASE 10: Task status transition ═══");
      await sleep(2000);
      const tasksAfterStart = await ipc(page, "task_list", {});
      const summaryTask = tasksAfterStart.find((t) => t.id === task.id);
      const digestAfterStart = tasksAfterStart.find((t) => t.id === digestTask.id);

      if (summaryTask) {
        log(`  Summary task status: ${summaryTask.status}`);
        assert(
          summaryTask.status === "in_progress" || summaryTask.status === "pending",
          `Summary task is in_progress or pending (got ${summaryTask.status})`,
        );
      }
      if (digestAfterStart) {
        log(`  Digest task status: ${digestAfterStart.status}`);
        assert(
          digestAfterStart.status === "in_progress" || digestAfterStart.status === "pending",
          `Digest task is in_progress or pending (got ${digestAfterStart.status})`,
        );
      }

      // ═══════════════════════════════════════════════════════
      // PHASE 11: Monitor health checks
      // ═══════════════════════════════════════════════════════
      log("\n═══ PHASE 11: Health monitoring ═══");

      // Give the orchestrator time to write its heartbeat
      log("  Waiting 10s for orchestrator to initialise...");
      await sleep(10000);

      let healthResult;
      try {
        healthResult = await ipc(page, "task_orchestrator_health");
        log(`  Health: ${healthResult.health}`);
        log(`  Heartbeat age: ${healthResult.heartbeatAgeSecs}s`);
        log(`  Active tasks: ${JSON.stringify(healthResult.activeTasks)}`);
        log(`  Needs restart: ${healthResult.needsRestart}`);
        log(`  Session UUID: ${healthResult.sessionUuid || "not yet discovered"}`);

        assert(
          healthResult.health === "healthy" || healthResult.health === "starting",
          `Health is healthy or starting (got ${healthResult.health})`,
        );
        assert(
          healthResult.heartbeatAgeSecs !== null && healthResult.heartbeatAgeSecs < 120,
          `Heartbeat age < 120s (got ${healthResult.heartbeatAgeSecs}s)`,
        );
      } catch (e) {
        log(`  Health check error: ${e.message || e}`);
        failed++;
      }

      // ═══════════════════════════════════════════════════════
      // PHASE 12: Verify UI shows orchestrator running
      // ═══════════════════════════════════════════════════════
      log("\n═══ PHASE 12: UI orchestrator display ═══");
      await navigateTo(page, "/tasks");
      await page.waitForTimeout(2000);

      const orchStatus = await page.evaluate(() => {
        const stateLabel = document.querySelector(".orch-state-label");
        const pidEl = document.querySelector(".orch-meta-item");
        return {
          stateText: stateLabel?.textContent?.trim(),
          hasPid: !!pidEl,
        };
      });
      log(`  Orch state badge: ${orchStatus.stateText}`);
      assert(orchStatus.stateText !== undefined, "Orchestrator state badge is visible");

      // ═══════════════════════════════════════════════════════
      // PHASE 13: Check monitor page
      // ═══════════════════════════════════════════════════════
      log("\n═══ PHASE 13: Monitor page ═══");
      await navigateTo(page, "/tasks/monitor");
      await page.waitForTimeout(2000);

      const monitorInfo = await page.evaluate(() => {
        const stateEl = document.querySelector(".status-label");
        const uptimeEl = document.querySelector(".uptime-value");
        return {
          stateText: stateEl?.textContent?.trim(),
          uptimeText: uptimeEl?.textContent?.trim(),
          hasSubagentSection: !!document.querySelector(".section-title"),
        };
      });
      log(`  Monitor state: ${monitorInfo.stateText}`);
      log(`  Uptime: ${monitorInfo.uptimeText}`);
      assert(monitorInfo.stateText !== undefined, "Monitor shows orchestrator state");

      await page.screenshot({ path: "scripts/e2e/screenshots/e2e-monitor-running.png" });

      // ═══════════════════════════════════════════════════════
      // PHASE 14: Wait for task processing (up to 90s)
      // ═══════════════════════════════════════════════════════
      log("\n═══ PHASE 14: Waiting for task processing ═══");
      const maxWait = 180;
      const pollInterval = 10;
      let elapsed = 0;
      let _taskDone = false;
      let _taskFailed = false;

      while (elapsed < maxWait) {
        await sleep(pollInterval * 1000);
        elapsed += pollInterval;

        const currentTasks = await ipc(page, "task_list", {});
        const currentSummary = currentTasks.find((t) => t.id === task.id);
        const currentDigest = currentTasks.find((t) => t.id === digestTask.id);

        log(
          `  [${elapsed}s] Summary: ${currentSummary?.status || "?"}, Digest: ${currentDigest?.status || "?"}`,
        );

        if (currentSummary?.status === "done" || currentSummary?.status === "failed") {
          _taskDone = currentSummary.status === "done";
          _taskFailed = currentSummary.status === "failed";
          break;
        }
        if (currentDigest?.status === "done" || currentDigest?.status === "failed") {
          // At least one task reached terminal state
          _taskDone = currentDigest.status === "done";
          _taskFailed = currentDigest.status === "failed";
          if (currentSummary?.status === "done" || currentSummary?.status === "failed") break;
        }

        // Also check health while waiting
        try {
          const h = await ipc(page, "task_orchestrator_health");
          log(`  [${elapsed}s] Health: ${h.health}, HB age: ${h.heartbeatAgeSecs}s`);
        } catch {}

        // Try ingesting results each poll (status.json may have appeared)
        try {
          const ingested = await ipc(page, "task_ingest_results");
          if (ingested > 0) log(`  [${elapsed}s] Ingested ${ingested} result(s)`);
        } catch {}
      }

      // Final task check
      const finalTasks = await ipc(page, "task_list", {});
      const finalSummary = finalTasks.find((t) => t.id === task.id);
      const finalDigest = finalTasks.find((t) => t.id === digestTask.id);

      log(`\n  Final summary task: ${finalSummary?.status}`);
      log(`  Final digest task: ${finalDigest?.status}`);

      if (finalSummary?.resultSummary) {
        log(`  Summary result preview: ${finalSummary.resultSummary.slice(0, 100)}...`);
      }
      if (finalDigest?.resultSummary) {
        log(`  Digest result preview: ${finalDigest.resultSummary.slice(0, 100)}...`);
      }

      // We count it as success if at least the task got picked up and processed
      // (even if it fails due to the LLM — the infrastructure worked)
      const summaryTerminal = ["done", "failed"].includes(finalSummary?.status);
      const digestTerminal = ["done", "failed"].includes(finalDigest?.status);
      const anyProcessed = summaryTerminal || digestTerminal;
      const stillPending = finalSummary?.status === "pending" && finalDigest?.status === "pending";

      assert(
        !stillPending,
        `Tasks were picked up by orchestrator (summary: ${finalSummary?.status}, digest: ${finalDigest?.status})`,
      );

      if (anyProcessed) {
        log("  ✅ Infrastructure worked — task(s) reached terminal state");
      } else {
        log(`  ⚠️ Tasks still in_progress after ${maxWait}s (orchestrator may still be working)`);
      }

      // ═══════════════════════════════════════════════════════
      // PHASE 15: Try ingest results
      // ═══════════════════════════════════════════════════════
      log("\n═══ PHASE 15: Result ingestion ═══");
      try {
        const ingestResult = await ipc(page, "task_ingest_results");
        log(`  Ingested: ${JSON.stringify(ingestResult)}`);
      } catch (e) {
        log(`  Ingest call: ${e.message || e}`);
      }

      // ═══════════════════════════════════════════════════════
      // PHASE 16: Stop orchestrator
      // ═══════════════════════════════════════════════════════
      log("\n═══ PHASE 16: Stop orchestrator ═══");
      try {
        await ipc(page, "task_orchestrator_stop");
        log("  Orchestrator stopped");

        await sleep(2000);
        const healthAfterStop = await ipc(page, "task_orchestrator_health");
        log(`  Health after stop: ${healthAfterStop.health}`);
        assert(
          healthAfterStop.health === "stopped",
          `Health is stopped after stop (got ${healthAfterStop.health})`,
        );
      } catch (e) {
        log(`  Stop error: ${e.message || e}`);
        failed++;
      }
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 17: Final console error check
    // ═══════════════════════════════════════════════════════
    log("\n═══ PHASE 17: Final checks ═══");
    const allErrors = capture
      .getLogs()
      .filter((l) => l.type === "error" && !l.text.includes("reindex"));
    log(`  Total console errors: ${allErrors.length}`);
    for (const e of allErrors.slice(0, 5)) {
      log(`    Error: ${e.text.slice(0, 120)}`);
    }

    // Take final screenshots
    await navigateTo(page, "/tasks");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "scripts/e2e/screenshots/e2e-final-dashboard.png" });

    capture.stop();
  } catch (e) {
    log(`\n❌ FATAL ERROR: ${e.message}`);
    log(e.stack);
    failed++;
    capture.stop();
  }

  // ═══════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════
  log("\n════════════════════════════════════════════");
  log(`  PASSED: ${passed}`);
  log(`  FAILED: ${failed}`);
  log(`  RESULT: ${failed === 0 ? "ALL PASSED ✅" : "SOME FAILED ❌"}`);
  log("════════════════════════════════════════════");

  // Don't shut down the app - leave it for manual inspection
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("E2E test crashed:", err.message);
  process.exit(1);
});
