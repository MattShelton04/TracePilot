/** Native first-setup/full-rebuild measurements. Only owned, isolated corpora. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { connectDesktop } from "../automation/ready.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    assert(arg.startsWith("--") && arg.includes("="), "Expected --key=value");
    const at = arg.indexOf("=");
    return [arg.slice(2, at), arg.slice(at + 1)];
  }),
);
assert(options.manifest && options.out, "Supply --manifest=... --out=...");
const mode = options.mode ?? "rebuild";
assert(["setup", "rebuild"].includes(mode));
const repeats = Number(options.samples ?? (mode === "setup" ? 1 : 3));
assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
assert(mode !== "setup" || repeats === 1, "Setup needs a new data root for each sample");
const manifestText = readFileSync(options.manifest, "utf8");
const manifest = JSON.parse(manifestText);
const canonical = (path) => realpathSync(path).toLowerCase();
const root = canonical(manifest.root);
if (manifest.private) {
  const source = JSON.parse(readFileSync(join(root, "private-source-manifest.json"), "utf8"));
  assert(source.private && canonical(source.root) === root, "Requires an owned private copy");
  assert.notEqual(canonical(source.source), canonical(join(root, "copilot/session-state")));
} else {
  assert.equal(manifest.generator, "tracepilot-bench/performance_probe");
  assert(
    readFileSync(join(root, ".tracepilot-performance-corpus"), "utf8").includes(
      "tracepilot-performance-corpus",
    ),
  );
}
assert(manifest.sessions.length > 0);
const state = JSON.parse(readFileSync(".tracepilot/automation/desktop.json", "utf8"));
assert.equal(state.runtime, "production");
assert.equal(state.build?.rustProfile, "release");
assert.equal(state.build?.frontend, "built");
assert.equal(canonical(state.dataRoot), root);
const report = {
  harnessVersion: 1,
  mode,
  fixtureHash: createHash("sha256").update(manifestText).digest("hex"),
  private: manifest.private === true,
  sessions: manifest.sessions.length,
  launch: state,
  startedAt: new Date().toISOString(),
  cacheState: "Empty/newly rebuilt SQLite index; OS file cache uncontrolled, no cold-disk claim",
  instrumentation:
    "Native lifecycle events in renderer performance.now; completeness checked after timing",
  status: "running",
  samples: [],
};
const { browser, page } = await connectDesktop(state.endpoint);
const invoke = (cmd) =>
  page.evaluate((name) => window.__TAURI_INTERNALS__.invoke(`plugin:tracepilot|${name}`), cmd);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
async function cleanup() {
  await page.evaluate(async () => {
    const probe = window.__TP_INDEX_PROBE__;
    if (!probe) return;
    for (const { event, eventId } of probe.listeners) {
      window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
      await window.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", { event, eventId });
    }
    document.removeEventListener("click", probe.click, true);
    delete window.__TP_INDEX_PROBE__;
  });
}
try {
  const config = await invoke("get_config");
  assert.equal(
    canonical(config.paths.sessionStateDir),
    canonical(join(root, "copilot/session-state")),
  );
  assert.equal(canonical(dirname(config.paths.indexDbPath)), canonical(join(root, "tracepilot")));
  assert.equal(resolve(config.paths.indexDbPath).toLowerCase(), join(root, "tracepilot/index.db"));
  await page.setViewportSize({ width: 1440, height: 960 });
  if (mode === "setup") {
    assert.equal(config.general.setupComplete, false);
    assert(!existsSync(config.paths.indexDbPath), "First setup requires no existing index.db");
    const selected = await page.getByRole("tab", { selected: true }).getAttribute("aria-label");
    const initialStep = Number(selected?.replace("Step ", ""));
    assert(initialStep >= 1 && initialStep <= 5);
    for (let step = initialStep; step < 5; step++) {
      await page
        .getByRole("button", { name: step === 1 ? "Begin Setup →" : "Continue →", exact: true })
        .click();
      await page.getByRole("tab", { name: `Step ${step + 1}`, selected: true }).waitFor();
      await page.locator(".slides-viewport:not([inert])").waitFor();
    }
    await page.getByRole("button", { name: "Launch TracePilot", exact: true }).waitFor();
  } else {
    assert.equal(config.general.setupComplete, true);
    assert.equal(
      config.ui.autoRefreshEnabled,
      false,
      "Disable auto-refresh in this isolated app first",
    );
    await page.evaluate(() => {
      location.hash = "#/settings";
    });
    await page.locator(".settings-root").waitFor();
    // Data & Storage opens read connections on mount. Do not race those reads
    // against Windows database deletion when measuring an idle full rebuild.
    await page.waitForFunction(() => {
      const text = document.querySelector(".settings-root")?.textContent ?? "";
      return /saved plaintext snapshots? using (?!—)/.test(text);
    });
  }
  for (let iteration = 0; iteration < repeats; iteration++) {
    await page.evaluate(async () => {
      const probe = { events: [], listeners: [], start: null, click: null };
      window.__TP_INDEX_PROBE__ = probe;
      probe.click = (event) => {
        if (event.target.closest("button")?.textContent.includes("Launch TracePilot")) {
          probe.start = performance.now();
        }
      };
      document.addEventListener("click", probe.click, true);
      for (const event of [
        "indexing-started",
        "indexing-finished",
        "search-indexing-started",
        "search-indexing-finished",
      ]) {
        const handler = window.__TAURI_INTERNALS__.transformCallback((message) => {
          probe.events.push({
            event,
            at: performance.now(),
            ...(event === "search-indexing-finished" ? { success: message.payload.success } : {}),
          });
        });
        const eventId = await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
          event,
          target: { kind: "Any" },
          handler,
        });
        probe.listeners.push({ event, eventId });
      }
    });
    let listReadyAt = null;
    let commandResult = null;
    if (mode === "setup") {
      await page.getByRole("button", { name: "Launch TracePilot", exact: true }).click();
      await page.getByTestId("session-card").first().waitFor({ timeout: 180_000 });
      listReadyAt = await page.evaluate(async () => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        return performance.now();
      });
    } else {
      commandResult = await page.evaluate(async () => {
        window.__TP_INDEX_PROBE__.start = performance.now();
        try {
          return await window.__TAURI_INTERNALS__.invoke("plugin:tracepilot|reindex_sessions_full");
        } catch (error) {
          throw new Error(JSON.stringify(error));
        }
      });
      assert.deepEqual(commandResult, [manifest.sessions.length, manifest.sessions.length]);
    }
    await page.waitForFunction(
      () =>
        window.__TP_INDEX_PROBE__.events.some(
          (entry) => entry.event === "search-indexing-finished",
        ),
      null,
      { timeout: 180_000 },
    );
    const probe = await page.evaluate(() => ({
      start: window.__TP_INDEX_PROBE__.start,
      events: window.__TP_INDEX_PROBE__.events,
    }));
    const first = (event) => {
      const entry = probe.events.find((item) => item.event === event);
      assert(entry, `Missing ${event}`);
      return entry;
    };
    const started = first("indexing-started").at;
    const indexed = first("indexing-finished").at;
    const searchStarted = first("search-indexing-started").at;
    const searchFinished = first("search-indexing-finished");
    assert.equal(searchFinished.success, true);
    assert(probe.start !== null && probe.start <= started && started <= indexed);
    assert(indexed <= searchStarted && searchStarted <= searchFinished.at);
    const health = await invoke("fts_health");
    assert.equal(health.totalSessions, manifest.sessions.length);
    assert.equal(health.indexedSessions, manifest.sessions.length);
    assert.equal(health.pendingSessions, 0);
    assert.equal(health.inSync, true);
    assert(health.totalContentRows > 0);
    assert.equal(health.totalContentRows, health.ftsIndexRows);
    assert.equal(await invoke("get_session_count"), manifest.sessions.length);
    const search = await page.evaluate(async (query) => {
      const result = await window.__TAURI_INTERNALS__.invoke("plugin:tracepilot|search_content", {
        query,
        limit: 1,
      });
      return { totalCount: result.totalCount, returned: result.results.length };
    }, manifest.stableSentinels.searchTerm);
    assert.equal(search.returned, 1, "Search must return an actual indexed match");
    assert(search.totalCount > 0);
    if (!manifest.private) {
      assert.equal(search.totalCount, manifest.totals.expectedSearchMatches);
      assert.equal(
        health.totalContentRows,
        2 * (manifest.totals.turnCount + manifest.totals.toolCallCount),
      );
    }
    await invoke("fts_integrity_check");
    const sample = {
      iteration,
      sessionIndexMs: indexed - started,
      searchIndexMs: searchFinished.at - searchStarted,
      indexingTotalMs: searchFinished.at - started,
      actionToSearchCompleteMs: searchFinished.at - probe.start,
      actionToListReadyMs: listReadyAt === null ? null : listReadyAt - probe.start,
      sessionIndexToListReadyMs: listReadyAt === null ? null : listReadyAt - indexed,
      commandResult,
      search,
      events: probe.events.map((entry) => ({ ...entry, at: entry.at - probe.start })),
      health,
    };
    report.samples.push(sample);
    console.log(JSON.stringify({ mode, sessions: report.sessions, ...sample }));
    await cleanup();
  }
  assert.equal(errors.length, 0, "Uncaught app errors");
  report.status = "complete";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  report.errors = errors;
  mkdirSync(dirname(resolve(options.out)), { recursive: true });
  writeFileSync(options.out, JSON.stringify(report, null, 2));
  await cleanup().catch(() => {});
  await browser.close();
}
