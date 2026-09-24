import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectGarbage, entryImages, migrateLegacyRun } from "./pages-store.mjs";
import { compare } from "./pixels.mjs";
import { decodePng, encodeHeat } from "./png.mjs";
import { areaKey, changeAreas, differenceImage, focusRect } from "./review-images.mjs";

const solid = (value) => Buffer.alloc(1440 * 960 * 4, value);
function withBlock(value, block) {
  const pixels = solid(value);
  for (let y = block.y; y < block.y + block.height; y++)
    for (let x = block.x; x < block.x + block.width; x++)
      pixels.set([250, 250, 250, 255], (y * 1440 + x) * 4);
  return pixels;
}

test("nearby regions merge into reviewable areas and repeated layouts share a key", () => {
  const areas = changeAreas([
    { x: 0, y: 0, width: 10, height: 10, pixels: 5 },
    { x: 20, y: 0, width: 10, height: 10, pixels: 50 },
    { x: 900, y: 900, width: 4, height: 4, pixels: 16 },
  ]);
  assert.deepEqual(areas[0], { x: 0, y: 0, width: 30, height: 10, pixels: 55 });
  assert.equal(areas.length, 2);
  assert.equal(areaKey(areas), areaKey([...areas].reverse()));
});

test("close-ups stay inside the screenshot and are skipped for view-sized changes", () => {
  assert.deepEqual(focusRect({ x: 1430, y: 950, width: 10, height: 10 }), {
    x: 960,
    y: 760,
    width: 480,
    height: 200,
  });
  assert.equal(focusRect({ x: 0, y: 0, width: 1400, height: 900 }), null);
});

test("difference images dim unchanged context and mark changed pixels", async () => {
  const before = solid(40),
    after = withBlock(40, { x: 100, y: 100, width: 20, height: 10 });
  const result = await compare(before, after, 1440, 960);
  const image = differenceImage(after, result.heat, changeAreas(result.regions));
  const pixel = (x, y) => [...image.subarray((y * 1440 + x) * 4, (y * 1440 + x) * 4 + 4)];
  assert.ok(pixel(110, 105)[0] > 200 && pixel(110, 105)[1] < 150); // pink change
  assert.ok(pixel(700, 700)[0] < 40); // dimmed context
  assert.deepEqual(pixel(97, 100).slice(0, 3), [40, 40, 40]); // undimmed inside the area
  assert.deepEqual(pixel(94, 100).slice(0, 3), [255, 69, 112]); // outline
});

test("legacy runs move into the shared store once and unreferenced images are collected", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tracepilot-pages-store-"));
  try {
    const visual = join(temp, "visual"),
      store = join(visual, "img"),
      runDir = join(visual, "runs", "7");
    await mkdir(runDir, { recursive: true });
    await mkdir(store);
    const before = solid(40),
      after = withBlock(40, { x: 300, y: 200, width: 40, height: 12 });
    const exact = await compare(before, after, 1440, 960);
    const { encodePng } = await import("./png.mjs");
    await writeFile(join(runDir, "base-sessions.png"), encodePng(1440, 960, before));
    await writeFile(join(runDir, "head-sessions.png"), encodePng(1440, 960, after));
    await writeFile(join(runDir, "diff-sessions-0.png"), encodeHeat(exact.heat));
    const data = {
      schema: 3,
      title: "Main · 1234abcd · fixture visual comparison",
      summary: { changed: 1, unchanged: 0, subtle: 0, incomplete: 0, baseUnavailable: 0, total: 1 },
      metadata: { runUrl: "https://github.com/o/r/actions/runs/7/attempts/1", attempt: 1 },
      rows: [
        {
          id: "sessions",
          route: "/",
          state: "populated",
          change: "changed",
          baseHash: "a",
          headHash: "b",
          analyses: {
            0: { ...exact, heat: undefined, heatFile: "diff-sessions-0.png" },
            8: { ...exact, heat: undefined, heatFile: "../escape.png" },
          },
        },
      ],
    };
    await writeFile(
      join(runDir, "index.html"),
      `<html><script id="report-data" type="application/json">${JSON.stringify(data)}</script></html>`,
    );
    await writeFile(join(store, `${"e".repeat(64)}.png`), "orphan");
    const { rows, summary } = await migrateLegacyRun(runDir, store);
    assert.equal(summary.changed, 1);
    assert.equal(await migrateLegacyRun(runDir, store), null, "migration is idempotent");
    const row = rows[0];
    assert.match(row.headImage, /^[a-f0-9]{64}\.png$/);
    assert.equal(row.analyses[0].changed, 480, "metrics are recomputed from the PNGs");
    assert.match(row.analyses[0].heatFile, /^[a-f0-9]{64}\.png$/);
    assert.ok(row.review.difference && row.review.focus.length === 1);
    decodePng(await readFile(join(store, row.review.difference)));
    assert.deepEqual((await readdir(runDir)).sort(), [
      "changes.json",
      "images.json",
      "index.html",
      "summary.json",
    ]);
    const html = await readFile(join(runDir, "index.html"), "utf8");
    assert.ok(html.includes('"imageRoot":"../../img/"'));
    assert.deepEqual(entryImages(rows).changes, { sessions: "changed" });
    assert.equal(await collectGarbage(visual, [7]), 1);
    const kept = await readdir(store);
    assert.equal(kept.includes(`${"e".repeat(64)}.png`), false);
    assert.ok(kept.includes(row.review.difference) && kept.includes(row.baseImage));
    assert.equal(await collectGarbage(visual, []), kept.length);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
