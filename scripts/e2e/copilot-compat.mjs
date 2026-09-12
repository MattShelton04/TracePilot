/** Replay the 1.0.83 subagent lifecycle through the real Tauri backend and UI.
 * Usage: node scripts/e2e/copilot-compat.mjs --session-root <configured session-state> [--port 9222]
 * Creates one temporary session; existing sessions are never modified.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, navigateTo } from "./connect.mjs";

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const rootArg = option("--session-root");
if (!rootArg)
  throw new Error("--session-root must match the running app's configured session directory");
const root = realpathSync(rootArg);
const sessionId = randomUUID();
const sessionDir = join(root, sessionId);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rows = readFileSync(
  join(repo, "crates/tracepilot-core/tests/fixtures/versions/v1_0_83_multiturn.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const now = Date.now();
for (let index = 0; index < rows.length; index++) {
  rows[index].timestamp = new Date(now - (rows.length - index) * 1000).toISOString();
  if (rows[index].type === "session.start") {
    rows[index].data.sessionId = sessionId;
    rows[index].data.startTime = rows[index].timestamp;
  }
}
const eventsPath = join(sessionDir, "events.jsonl");
let browser;
let page;
let created = false;
let written = 0;
function appendThrough(length) {
  appendFileSync(
    eventsPath,
    `${rows
      .slice(written, length)
      .map((row) => JSON.stringify(row))
      .join("\n")}\n`,
  );
  written = length;
}

try {
  mkdirSync(sessionDir); // fail if this path already exists
  created = true;
  writeFileSync(
    join(sessionDir, "workspace.yaml"),
    `id: ${sessionId}\nsummary: TracePilot compatibility replay\ncreated_at: ${rows[0].timestamp}\nupdated_at: ${new Date(now).toISOString()}\n`,
  );
  appendThrough(8); // task wrapper returned; no child lifecycle log yet
  const conn = await connect({ port: Number(option("--port") ?? 9222) });
  browser = conn.browser;
  page = conn.page;
  await page.reload(); // Recreate stores after any dev-server module updates.
  await navigateTo(page, `/session/${sessionId}/conversation`);
  const status = page.locator(".cv-subagent-status").first();
  const results = [];
  async function verify(expected, phase) {
    await page.waitForFunction(
      (title) => document.querySelector(".cv-subagent-status")?.getAttribute("title") === title,
      expected,
      { timeout: 25000 },
    );
    assert.equal(await status.getAttribute("title"), expected);
    results.push({ phase, status: expected });
    console.log(`${phase}: ${expected}`);
  }
  await verify("Running", "launch before child logs");
  appendThrough(21);
  await verify("Idle — waiting for messages", "initial work settled");
  appendThrough(26);
  await verify("Running", "follow-up accepted");
  appendThrough(40);
  await verify("Idle — waiting for messages", "follow-up settled without another terminal event");
  await page.locator(".cv-subagent-card").first().click();
  await page.locator(".sap-status").first().waitFor();
  await page.waitForTimeout(1200); // The subagent panel slides in.
  assert.equal(
    await page.locator(".sap-status").first().innerText(),
    "Idle — waiting for messages",
  );
  console.log(JSON.stringify({ passed: true, results }, null, 2));
  // Leave the app on its normal session list before removing the fixture.
  await navigateTo(page, "/");
} finally {
  if (page) await navigateTo(page, "/").catch(() => {});
  if (browser) await browser.close();
  // The random, task-owned directory must still be a direct child of the supplied root.
  if (created) cleanupSession();
}

function cleanupSession() {
  assert.equal(dirname(resolve(sessionDir)), root, "Unexpected cleanup target");
  rmSync(sessionDir, { recursive: true, force: true });
}
