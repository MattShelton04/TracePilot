/** Correctness/interaction checks on the real app; mutates only an owned synthetic fixture. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connectDesktop } from "../automation/ready.mjs";

const [manifestPath, outputPath] = process.argv.slice(2);
assert(
  manifestPath && outputPath,
  "Usage: node scripts/perf/verify-desktop.mjs MANIFEST OUTPUT_DIR",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert(!manifest.private, "This mutating validation accepts synthetic fixtures only");
assert.equal(manifest.generator, "tracepilot-bench/performance_probe");
assert(
  readFileSync(join(manifest.root, ".tracepilot-performance-corpus"), "utf8").includes(
    "tracepilot-performance-corpus",
  ),
);
const state = JSON.parse(readFileSync(".tracepilot/automation/desktop.json", "utf8"));
assert.equal(state.runtime, "production");
assert.equal(realpathSync(state.dataRoot).toLowerCase(), realpathSync(manifest.root).toLowerCase());
const selected = manifest.sessions.find((session) => session.turnCount === 200);
assert(selected, "Requires the detailed 200-turn fixture");
const source = join(manifest.root, "copilot/session-state", selected.id, "events.jsonl");
assert(
  realpathSync(source)
    .toLowerCase()
    .startsWith(`${realpathSync(manifest.root).toLowerCase()}\\`),
);
const original = readFileSync(source);
const out = resolve(outputPath);
mkdirSync(out, { recursive: true });
const report = { status: "running", checks: [], launch: state };
const { browser, page } = await connectDesktop(state.endpoint);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
async function frames() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}
async function countReady(count) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".cv-turn-block").length === expected,
    count,
    { timeout: 60000 },
  );
  await frames();
}
async function refresh() {
  await page.evaluate(() => window.__TRACEPILOT_IPC_PERF__.clearIpcPerfLog());
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page.waitForFunction(() =>
    window.__TRACEPILOT_IPC_PERF__
      .getIpcPerfLog()
      .some((entry) => entry.cmd === "check_session_freshness"),
  );
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Refresh data"]').disabled,
  );
  await frames();
}
let changed = false;
try {
  const config = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("plugin:tracepilot|get_config"),
  );
  assert.equal(
    realpathSync(config.paths.sessionStateDir).toLowerCase(),
    realpathSync(join(manifest.root, "copilot/session-state")).toLowerCase(),
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate((id) => {
    location.hash = `#/session/${id}/conversation`;
  }, selected.id);
  await countReady(selected.turnCount);

  const selection = await page.evaluate(() => {
    const root = document.querySelector(".cv-user-body .markdown-content");
    const range = document.createRange();
    range.selectNodeContents(root);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  assert(selection.length > 20);
  await refresh();
  assert.equal(await page.evaluate(() => window.getSelection().toString()), selection);
  report.checks.push("No-op refresh preserves selected conversation text for copy");

  const frameTimes = await page.evaluate(async () => {
    window.getSelection().removeAllRanges();
    const root = document.querySelector(".cv-root").closest(".page-content");
    const height = root.scrollHeight;
    const intervals = [];
    let previous = performance.now();
    for (let index = 0; index < 120; index++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      intervals.push(now - previous);
      previous = now;
      root.scrollTop = (height - root.clientHeight) * (index / 119);
      if (root.scrollHeight !== height)
        throw new Error("Conversation height changed while scrolling");
    }
    return intervals;
  });
  await countReady(selected.turnCount);
  report.scroll = { frames: frameTimes.length, intervalsMs: frameTimes };
  report.checks.push(
    "Complete conversation remains mounted with stable height throughout scrolling",
  );

  const sentinel = "TRACEPILOT_APP_APPEND_VERIFICATION";
  const time = "2026-09-20T04:00:00.000Z";
  const event = (type, data) =>
    JSON.stringify({ id: randomUUID(), type, timestamp: time, parentId: null, data });
  const user = event("user.message", { content: `${sentinel} **fresh markdown**` });
  const rest = [
    event("assistant.turn_start", { turnId: "perf-append-turn" }),
    event("assistant.message", {
      messageId: "perf-append-message",
      content: "Fresh appended response.",
      outputTokens: 4,
    }),
    event("assistant.turn_end", { turnId: "perf-append-turn" }),
  ].join("\n");
  const split = Math.floor(user.length / 2);
  changed = true;
  appendFileSync(source, `\n${user.slice(0, split)}`);
  await refresh();
  await countReady(selected.turnCount);
  assert.equal(await page.getByText(`${sentinel} fresh markdown`, { exact: true }).count(), 0);
  report.checks.push("Partially written JSONL record does not create a phantom turn");

  const started = performance.now();
  appendFileSync(source, `${user.slice(split)}\n${rest}\n`);
  await refresh();
  await countReady(selected.turnCount + 1);
  await page.getByText("Fresh appended response.", { exact: true }).waitFor();
  report.appendToUsableMs = performance.now() - started;
  assert(await page.evaluate((text) => window.find(text), sentinel));
  report.checks.push(
    "Completed append is visible, correctly rendered, ordered, and browser-findable",
  );
  await page.screenshot({ path: join(out, "appended-conversation.png") });
  assert.equal(errors.length, 0, "Uncaught app errors");
  report.status = "complete";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack ?? error);
  await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  throw error;
} finally {
  if (changed) {
    writeFileSync(source, original);
    assert(readFileSync(source).equals(original), "Restore original synthetic events");
    try {
      await refresh();
      await countReady(selected.turnCount);
    } catch (error) {
      report.status = "failed";
      report.restoreRefreshError = String(error);
      process.exitCode = 1;
    }
  }
  report.errors = errors;
  writeFileSync(join(out, "verification.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
