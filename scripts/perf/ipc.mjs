/** Warm native Tauri round trips; complements, but does not replace, desktop.mjs. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { connectDesktop } from "../automation/ready.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    assert(arg.startsWith("--") && arg.includes("="), "Expected --key=value");
    const at = arg.indexOf("=");
    return [arg.slice(2, at), arg.slice(at + 1)];
  }),
);
assert(options.manifest && options.out, "Supply --manifest=... --out=...");
const manifestText = readFileSync(options.manifest, "utf8");
const manifest = JSON.parse(manifestText);
const state = JSON.parse(readFileSync(".tracepilot/automation/desktop.json", "utf8"));
assert.equal(state.runtime, "production");
assert.equal(state.build?.rustProfile, "release");
assert.equal(resolve(state.dataRoot).toLowerCase(), resolve(manifest.root).toLowerCase());
const repeats = Number(options.samples ?? 7);
assert(Number.isInteger(repeats) && repeats >= 3 && repeats <= 30);
const selected = options.session
  ? [manifest.sessions.find((session) => session.id === options.session)]
  : [...manifest.sessions].sort((a, b) => b.eventCount - a.eventCount).slice(0, 3);
assert(selected.length && selected.every(Boolean), "Session missing from manifest");
const report = {
  harnessVersion: 1,
  fixtureHash: createHash("sha256").update(manifestText).digest("hex"),
  private: manifest.private === true,
  launch: state,
  startedAt: new Date().toISOString(),
  cacheState: "Existing native process, one untimed warm call per session; OS cache uncontrolled",
  instrumentation: "Direct Tauri round trip, performance.now; CDP renderer metrics outside samples",
  status: "running",
  results: [],
};
const { browser, page, context } = await connectDesktop(state.endpoint);
const cdp = await context.newCDPSession(page);
let customProtocolRequests = 0;
page.on("request", (request) => {
  if (request.url().startsWith("http://ipc.localhost/")) customProtocolRequests++;
});
async function metrics() {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}
try {
  await cdp.send("Performance.enable");
  report.webview = await cdp.send("Browser.getVersion");
  const config = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("plugin:tracepilot|get_config"),
  );
  assert.equal(
    resolve(config.paths.sessionStateDir).toLowerCase(),
    resolve(manifest.root, "copilot/session-state").toLowerCase(),
  );
  await page.evaluate(() => {
    location.hash = "#/settings";
  });
  await page.locator(".settings-root").waitFor();
  for (const session of selected) {
    // Hash and size validation deliberately stays outside the timed calls.
    const warm = await page.evaluate(async (sessionId) => {
      const result = await window.__TAURI_INTERNALS__.invoke(
        "plugin:tracepilot|get_session_turns",
        { sessionId },
      );
      return { count: result.turns.length, json: JSON.stringify(result) };
    }, session.id);
    assert.equal(warm.count, session.turnCount, "Complete expected conversation response");
    const bytes = Buffer.byteLength(warm.json);
    const payloadHash = createHash("sha256").update(warm.json).digest("hex");
    warm.json = null;
    const before = await metrics();
    const samples = await page.evaluate(
      async ({ sessionId, count, repeats }) => {
        const times = [];
        for (let i = 0; i < repeats; i++) {
          const start = performance.now();
          const value = await window.__TAURI_INTERNALS__.invoke(
            "plugin:tracepilot|get_session_turns",
            { sessionId },
          );
          times.push(performance.now() - start);
          if (value.turns.length !== count) throw new Error("Response count changed");
        }
        return times;
      },
      { sessionId: session.id, count: session.turnCount, repeats },
    );
    const after = await metrics();
    report.results.push({
      sessionId: session.id,
      turns: session.turnCount,
      bytes,
      payloadHash,
      samples,
      before,
      after,
    });
    console.log(
      `${session.turnCount} turns / ${(bytes / 1048576).toFixed(2)} MiB: ${samples.map((value) => value.toFixed(1)).join(", ")} ms`,
    );
  }
  report.status = "complete";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  report.customProtocolRequests = customProtocolRequests;
  mkdirSync(dirname(resolve(options.out)), { recursive: true });
  writeFileSync(options.out, JSON.stringify(report, null, 2));
  await cdp.detach();
  await browser.close();
}
