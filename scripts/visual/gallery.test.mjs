import assert from "node:assert/strict";
import test from "node:test";
import { configureVisualFeatures, defaultFeatures } from "./feature-policy.mjs";
import { renderGallery, renderHistory, safeHttpUrl, scriptJson } from "./gallery-template.mjs";
import { historyEntry } from "./history.mjs";
import { cases } from "./manifest.mjs";
import "./gallery/pixels.js";

test("core captures disable experimental features and alerts; each experimental case explicitly opts in", () => {
  for (const item of cases) {
    const config = configureVisualFeatures(
      { features: { copilotSdk: true }, alerts: { enabled: true, custom: 42 } },
      item.features,
    );
    assert.equal(config.features.copilotSdk, false, item.id);
    assert.equal(config.alerts.enabled, false);
    assert.equal(config.alerts.custom, 42);
    assert.equal(config.features.sessionReplay, item.id === "replay");
    if (item.features?.length) assert.match(item.state, /Experimental · explicitly enabled/);
  }
  const config = configureVisualFeatures({});
  config.features.skills = false;
  assert.equal(defaultFeatures.skills, true);
  assert.throws(() => configureVisualFeatures({}, ["unknown"]), /Unknown visual feature/);
});

test("pixel analysis finds exact bounds and separate regions, with threshold and cancellation", async () => {
  const before = new Uint8ClampedArray(1440 * 960 * 4),
    after = before.slice();
  const pixel = (x, y, value) => {
    after[(y * 1440 + x) * 4] = value;
  };
  pixel(10, 20, 8);
  pixel(11, 20, 9);
  pixel(1439, 959, 255);
  const exact = await TracePilotPixels.compare(before, after, 1440, 960);
  assert.equal(exact.changed, 3);
  assert.equal(exact.regionCount, 2);
  assert.deepEqual(exact.bounds, { x: 10, y: 20, width: 1430, height: 940 });
  assert.deepEqual(exact.regions[0], { x: 0, y: 0, width: 32, height: 32, pixels: 2 });
  assert.deepEqual(
    [...exact.heat.slice((20 * 1440 + 10) * 4, (20 * 1440 + 10) * 4 + 4)],
    [255, 69, 112, 210],
  );
  const filtered = await TracePilotPixels.compare(before, after, 1440, 960, { threshold: 8 });
  assert.equal(filtered.changed, 2);
  const same = await TracePilotPixels.compare(before, before, 1440, 960);
  assert.equal(same.changed, 0);
  assert.equal(same.bounds, null);
  assert.deepEqual(same.regions, []);
  assert.equal(
    await TracePilotPixels.compare(before, after, 1440, 960, { cancelled: () => true }),
    null,
  );
  await assert.rejects(TracePilotPixels.compare(before, after, 960, 640), /1440×960/);
});

test("filtered zero differences are not described as identical decoded pixels", async () => {
  const before = new Uint8ClampedArray(1440 * 960 * 4);
  const after = before.slice();
  after[0] = 8;
  const exact = await TracePilotPixels.compare(before, after, 1440, 960);
  const filtered = await TracePilotPixels.compare(before, after, 1440, 960, { threshold: 8 });
  assert.equal(exact.changed, 1);
  assert.equal(filtered.changed, 0);
  assert.match(TracePilotPixels.describeBounds(filtered, 8, true), /No differences exceed.*8/);
  assert.equal(TracePilotPixels.describeBounds(filtered, 8, true).includes("identical"), false);
  assert.match(TracePilotPixels.describeBounds(exact, 0, true), /Bounds: 0, 0/);
  const identical = await TracePilotPixels.compare(before, before, 1440, 960);
  assert.equal(
    TracePilotPixels.describeBounds(identical, 0, true),
    "PNG bytes differ; decoded pixels are identical.",
  );
  assert.equal(
    TracePilotPixels.describeBounds(identical, 0, false),
    "Decoded pixels are identical.",
  );
});

test("report data cannot terminate scripts and executable assets use a hash CSP", async () => {
  const malicious = '</script><img src=x onerror="alert(1)">&\u2028';
  assert.equal(scriptJson({ malicious }).includes("</script>"), false);
  assert.deepEqual(JSON.parse(scriptJson({ malicious })), { malicious });
  const html = await renderGallery({
    title: malicious,
    rows: [
      {
        id: "sessions",
        route: malicious,
        state: malicious,
        change: "incomplete",
        head: { errors: [malicious] },
      },
    ],
    summary: { changed: 0, unchanged: 0, incomplete: 1, baseUnavailable: 0 },
    metadata: { runUrl: "javascript:alert(1)" },
  });
  assert.equal(html.includes(malicious), false);
  assert.equal(html.includes('href="javascript:'), false);
  assert.match(html, /script-src 'sha256-[A-Za-z0-9+/]+=*'/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.equal(safeHttpUrl("https://user:secret@example.test"), "");
  assert.equal(safeHttpUrl("data:text/html,x"), "");
});

test("history accepts bounded display fields and rejects unsafe path identifiers", async () => {
  const valid = {
    id: 123,
    sha: "a".repeat(40),
    title: "</script><script>alert(1)</script>",
    created: "2026-09-12",
    views: ["sessions", "../../outside", "sessions"],
    summary: { changed: 9999 },
  };
  assert.equal(historyEntry({ ...valid, id: "../outside" }), null);
  assert.equal(historyEntry({ ...valid, pr: -1 }), null);
  assert.deepEqual(historyEntry(valid).views, ["sessions"]);
  assert.equal(historyEntry(valid).summary.changed, 128);
  assert.equal(historyEntry({ ...valid, summary: undefined }).summary, null);
  const html = await renderHistory([valid, { ...valid, id: "bad" }]);
  assert.equal(html.includes(valid.title), false);
  const data = JSON.parse(
    /<script id="report-data" type="application\/json">(.*?)<\/script>/.exec(html)[1],
  );
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].id, 123);
});
