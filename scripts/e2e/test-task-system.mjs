/**
 * E2E test: AI Task System — end-to-end validation
 *
 * Tests:
 * 1. Tasks page loads and displays presets
 * 2. Task creation flow works (select preset → configure → submit)
 * 3. Task list shows created tasks
 * 4. Task detail view shows task info
 * 5. Orchestrator monitor page loads
 * 6. Task deletion works
 */

import { connect, ipc, navigateTo, shutdown } from "./connect.mjs";

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, name, detail = "") {
  if (condition) {
    passed++;
    results.push(`  ✅ ${name}`);
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    results.push(`  ❌ ${name}${detail ? `: ${detail}` : ""}`);
    console.log(`  ❌ ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function safeEval(page, fn, fallback = null) {
  try {
    return await page.evaluate(fn);
  } catch {
    return fallback;
  }
}

const { browser, page, port } = await connect();
console.log("\n=== AI Task System E2E Tests ===\n");

try {
  // ─── Test 1: Navigate to Tasks page ───
  console.log("--- Tasks Page ---");
  await navigateTo(page, "/tasks");
  await page.waitForTimeout(2000);

  const tasksPageLoaded = await safeEval(
    page,
    () => {
      return (
        document.querySelector('.tasks-view, .task-list, [class*="task"]') !== null ||
        document.body.innerText.includes("Task")
      );
    },
    false,
  );
  assert(tasksPageLoaded, "Tasks page loads");

  // ─── Test 2: Check for quick presets ───
  const hasPresets = await safeEval(
    page,
    () => {
      const text = document.body.innerText;
      return (
        text.includes("Session Summary") ||
        text.includes("Daily Digest") ||
        text.includes("Weekly Digest")
      );
    },
    false,
  );
  assert(hasPresets, "Quick presets are visible");

  // ─── Test 3: Navigate to task creation ───
  console.log("\n--- Task Creation ---");
  await navigateTo(page, "/tasks/new");
  await page.waitForTimeout(2000);

  const createPageLoaded = await safeEval(
    page,
    () => {
      const text = document.body.innerText;
      return text.includes("Create") || text.includes("New Task") || text.includes("Select");
    },
    false,
  );
  assert(createPageLoaded, "Task creation page loads");

  // ─── Test 4: Try creating a session summary task via preset URL ───
  await navigateTo(page, "/tasks/new?presetId=session-summary");
  await page.waitForTimeout(2000);

  const presetAutoSelected = await safeEval(
    page,
    () => {
      const text = document.body.innerText;
      return (
        text.includes("Session Summary") || text.includes("Configure") || text.includes("session")
      );
    },
    false,
  );
  assert(presetAutoSelected, "Preset auto-selects from URL param");

  // ─── Test 5: Navigate to task presets page ───
  console.log("\n--- Task Presets ---");
  await navigateTo(page, "/tasks/presets");
  await page.waitForTimeout(2000);

  const presetsPageLoaded = await safeEval(
    page,
    () => {
      const text = document.body.innerText;
      return text.includes("Preset") || text.includes("Template") || text.includes("Summary");
    },
    false,
  );
  assert(presetsPageLoaded, "Presets page loads");

  // ─── Test 6: Navigate to orchestrator monitor ───
  console.log("\n--- Orchestrator Monitor ---");
  await navigateTo(page, "/tasks/monitor");
  await page.waitForTimeout(2000);

  const monitorPageLoaded = await safeEval(
    page,
    () => {
      const text = document.body.innerText;
      return (
        text.includes("Orchestrator") ||
        text.includes("Monitor") ||
        text.includes("Health") ||
        text.includes("Status")
      );
    },
    false,
  );
  assert(monitorPageLoaded, "Orchestrator monitor page loads");

  // Check for model picker when orchestrator is stopped
  const hasModelPicker = await safeEval(
    page,
    () => {
      const text = document.body.innerText;
      return text.includes("Model") || text.includes("Start") || text.includes("model");
    },
    false,
  );
  assert(hasModelPicker, "Orchestrator monitor shows model/start controls");

  // ─── Test 7: Create a task via IPC and verify it appears ───
  console.log("\n--- Task Lifecycle (IPC) ---");

  // First list existing tasks
  let existingTasks;
  try {
    existingTasks = await ipc(page, "task_list");
  } catch (e) {
    existingTasks = { error: e.message || String(e) };
  }

  const taskListWorks = Array.isArray(existingTasks) || (existingTasks && !existingTasks.error);
  assert(taskListWorks, "task_list IPC command works", existingTasks?.error);

  // Create a test task
  let createResult;
  try {
    createResult = await ipc(page, "task_create", {
      taskType: "session_summary",
      presetId: "session-summary",
      inputParams: { sessionId: "test-e2e-session" },
      contextSources: ["session_export"],
    });
  } catch (e) {
    createResult = { error: e.message || String(e) };
  }

  const taskCreated = createResult?.id && !createResult.error;
  assert(taskCreated, "Task created via IPC", createResult?.error);

  const taskId = createResult?.id;

  if (taskId) {
    // ─── Test 8: Fetch task detail ───
    let taskDetailResult;
    try {
      taskDetailResult = await ipc(page, "task_get", { id: taskId });
    } catch (e) {
      taskDetailResult = { error: e.message || String(e) };
    }

    const detailOk = taskDetailResult && taskDetailResult.id === taskId && !taskDetailResult.error;
    assert(detailOk, "Task detail fetched via IPC", taskDetailResult?.error);

    // Check status is pending
    assert(
      taskDetailResult?.status === "pending",
      "New task status is pending",
      `got: ${taskDetailResult?.status}`,
    );

    // ─── Test 9: Navigate to task detail view ───
    await navigateTo(page, `/tasks/${taskId}`);
    await page.waitForTimeout(2000);

    const detailViewLoaded = await safeEval(
      page,
      () => {
        const text = document.body.innerText;
        return (
          text.includes("session_summary") ||
          text.includes("Session Summary") ||
          text.includes("pending") ||
          text.includes("Status")
        );
      },
      false,
    );
    assert(detailViewLoaded, "Task detail view renders");

    // ─── Test 10: Check task timeline section exists ───
    const hasTimeline = await safeEval(
      page,
      () => {
        const text = document.body.innerText;
        return text.includes("Timeline") || text.includes("Created") || text.includes("timeline");
      },
      false,
    );
    assert(hasTimeline, "Task detail shows timeline");

    // ─── Test 11: Delete the test task ───
    let deleteResult;
    try {
      await ipc(page, "task_delete", { id: taskId });
      deleteResult = { ok: true };
    } catch (e) {
      deleteResult = { error: e.message || String(e) };
    }

    assert(deleteResult.ok === true, "Task deleted via IPC", deleteResult?.error);

    // Verify it's gone
    let afterDelete;
    try {
      const task = await ipc(page, "task_get", { id: taskId });
      afterDelete = { found: true, status: task?.status };
    } catch (e) {
      afterDelete = { found: false, error: e.message || String(e) };
    }

    // Task should either be not found or have a deleted status
    const deletedOk = !afterDelete.found || afterDelete.error?.includes("not found");
    assert(deletedOk, "Deleted task is no longer retrievable");
  }

  // ─── Test 12: Orchestrator health check IPC ───
  console.log("\n--- Orchestrator Health ---");
  let healthResult;
  try {
    healthResult = await ipc(page, "task_orchestrator_health");
  } catch (e) {
    healthResult = { error: e.message || String(e) };
  }

  const healthOk = healthResult && !healthResult.error;
  assert(healthOk, "Orchestrator health check IPC works", healthResult?.error);

  if (healthOk) {
    assert(
      typeof healthResult.health === "string",
      "Health result has health field",
      `got: ${JSON.stringify(healthResult).slice(0, 100)}`,
    );
  }

  // ─── Test 13: List presets IPC ───
  let presetsResult;
  try {
    presetsResult = await ipc(page, "task_list_presets");
  } catch (e) {
    presetsResult = { error: e.message || String(e) };
  }

  const presetsOk = Array.isArray(presetsResult) && presetsResult.length > 0;
  assert(
    presetsOk,
    "task_list_presets returns presets",
    presetsResult?.error || `count: ${presetsResult?.length}`,
  );

  // ─── Test 14: Verify the set_orchestrator_session_id DB function exists ───
  // We can't directly call the Rust function, but we can verify the schema
  // by checking that orchestratorSessionId is a valid field on task objects
  console.log("\n--- Schema Validation ---");
  const schemaTask = await page.evaluate(async () => {
    try {
      const task = await window.__TAURI_INTERNALS__.invoke("plugin:tracepilot|task_create", {
        taskType: "session_summary",
        presetId: "session-summary",
        inputParams: { sessionId: "schema-test" },
        contextSources: ["session_export"],
      });
      // Check the task object has the orchestratorSessionId field (even if null)
      const hasField = "orchestratorSessionId" in task;
      // Clean up
      try {
        await window.__TAURI_INTERNALS__.invoke("plugin:tracepilot|task_delete", { id: task.id });
      } catch {}
      return { hasField, keys: Object.keys(task) };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  assert(
    schemaTask.hasField === true,
    "Task object includes orchestratorSessionId field",
    schemaTask.error || `keys: ${schemaTask.keys?.join(", ")}`,
  );
} catch (err) {
  console.error("\n⚠️  Test error:", err.message);
  failed++;
  results.push(`  ❌ Unhandled error: ${err.message}`);
}

// ─── Summary ───
console.log("\n=== Results ===");
results.forEach((r) => {
  console.log(r);
});
console.log(`\nTotal: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);

// Shutdown
await shutdown(browser, port);
process.exit(failed > 0 ? 1 : 0);
