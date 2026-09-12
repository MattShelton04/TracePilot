import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { captureExitCode } from "./capture-policy.mjs";
import { cases, selectCases } from "./manifest.mjs";
import { decodePng } from "./png.mjs";
import { buildReport, escapeHtml, validatePng } from "./report.mjs";

function png(value = 0, options = {}) {
  const data = Buffer.alloc(1440 * 960 * 4, 255);
  data[0] = value;
  return PNG.sync.write({ width: 1440, height: 960, data }, options);
}

test("head capture errors fail CI while unavailable historical cases remain reportable", () => {
  const captured = { id: "sessions", status: "captured" };
  assert.equal(captureExitCode([captured]), 0);
  assert.equal(captureExitCode([captured], "base"), 0);
  for (const status of ["incomplete", "failed"]) {
    const reports = [captured, { id: "new-route", status }];
    assert.equal(captureExitCode(reports, "head"), 1);
    assert.equal(captureExitCode(reports, "base"), 0);
  }
  assert.equal(captureExitCode([]), 1);
  assert.throws(() => captureExitCode([captured], "typo"), /Invalid visual revision/);
});

test("two shards cover every case exactly once and reject invalid shards", () => {
  assert.deepEqual(
    [...selectCases("1/2"), ...selectCases("2/2")].map((x) => x.id).sort(),
    cases.map((x) => x.id).sort(),
  );
  assert.equal(new Set(cases.map((x) => x.id)).size, cases.length);
  for (const shard of ["0/2", "3/2", "1/0", "1/100", "x"]) assert.throws(() => selectCases(shard));
});

test("manifest covers every named desktop route", async () => {
  const registry = await readFile(
    new URL("../../apps/desktop/src/config/routes.ts", import.meta.url),
    "utf8",
  );
  const names = [...registry.matchAll(/^ {2}\w+: "([\w-]+)",/gm)].map((match) => match[1]);
  for (const name of names)
    assert.ok(
      cases.some((item) => item.id === name),
      `Missing route ${name}`,
    );
});

test("artifact images require PNG signatures and the exact desktop dimensions", () => {
  assert.ok(validatePng(png()));
  assert.equal(validatePng(Buffer.from("<svg onload=alert(1)>")), false);
  const wrongSize = png();
  wrongSize.writeUInt32BE(999999, 16);
  assert.equal(validatePng(wrongSize), false);
  assert.equal(escapeHtml('<script>"&'), "&lt;script&gt;&quot;&amp;");
});

test("decoder rejects truncated PNGs, repeated dimensions, interlace and corrupt pixel data", () => {
  const valid = png();
  assert.equal(decodePng(valid).length, 1440 * 960 * 4);
  // Color-profile metadata affects displayed colors but is not represented by
  // raw RGBA equality. Unsupported inputs must stay explicit limitations.
  const colorMetadata = PNG.sync.write({
    width: 1440,
    height: 960,
    data: decodePng(valid),
    gamma: 0.45,
  });
  assert.equal(validatePng(colorMetadata), false);
  const duplicate = Buffer.concat([
    valid.subarray(0, 33),
    valid.subarray(8, 33),
    valid.subarray(33),
  ]);
  const interlaced = Buffer.from(valid);
  interlaced[28] = 1;
  const wrongDepth = Buffer.from(valid);
  wrongDepth[24] = 16;
  const oversizedChunk = Buffer.from(valid);
  oversizedChunk.writeUInt32BE(0xffffffff, 33);
  for (const bytes of [
    duplicate,
    interlaced,
    wrongDepth,
    oversizedChunk,
    valid.subarray(0, 25),
    valid.subarray(0, -1),
    Buffer.concat([valid, Buffer.from("extra")]),
  ]) {
    assert.equal(validatePng(bytes), false);
    assert.throws(() => decodePng(bytes), /Unsupported or malformed/);
  }
  const corrupt = Buffer.from(valid);
  corrupt[41] ^= 1;
  assert.throws(() => decodePng(corrupt));
});

test("reports changed captures, missing bases, failures and escaped artifact diagnostics", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tracepilot-visual-report-"));
  try {
    const base = join(temp, "base"),
      head = join(temp, "head"),
      output = join(temp, "report");
    await mkdir(base);
    await mkdir(head);
    for (const dir of [base, head]) {
      await writeFile(join(dir, "sessions.png"), png(dir === base ? 1 : 2));
      await writeFile(join(dir, "analytics.png"), png());
      await writeFile(
        join(dir, "capture-1-2.json"),
        JSON.stringify({
          schema: 1,
          cases: [
            { id: "sessions", status: "captured", state: "historical fixture state" },
            { id: "analytics", status: "captured" },
            { id: "tools", status: "captured" },
            { id: "future-route", route: '/new/"<script>', state: "new view", status: "captured" },
            { id: "../../unsafe", status: "captured" },
            { id: "search", status: "failed", errors: ['<script>alert("artifact")</script>'] },
          ],
        }),
      );
    }
    await writeFile(join(head, "search.png"), png());
    await writeFile(join(head, "tools.png"), png());
    await writeFile(join(head, "future-route.png"), png());
    const report = await buildReport({ baseDir: base, headDir: head, output });
    assert.equal(report.rows.find((x) => x.id === "sessions").change, "changed");
    const comparison = report.rows.find((x) => x.id === "sessions").analyses;
    assert.equal(comparison[0].changed, 1);
    assert.deepEqual(comparison[0].regions, [{ x: 0, y: 0, width: 1, height: 1, pixels: 1 }]);
    const heat = decodePng(await readFile(join(output, comparison[0].heatFile)));
    assert.deepEqual([...heat.subarray(0, 4)], [255, 69, 112, 210]);
    assert.equal(comparison[8].changed, 0);
    assert.equal(comparison[8].heatFile, null);
    assert.equal(report.rows.find((x) => x.id === "sessions").state, "historical fixture state");
    assert.equal(report.rows.find((x) => x.id === "search").change, "incomplete");
    assert.equal(report.rows.find((x) => x.id === "analytics").change, "unchanged");
    assert.equal(report.rows.find((x) => x.id === "tools").change, "base unavailable");
    assert.equal(report.rows.find((x) => x.id === "future-route").change, "base unavailable");
    assert.equal(
      report.rows.some((x) => x.id === "../../unsafe"),
      false,
    );
    const html = await readFile(join(output, "index.html"), "utf8");
    assert.ok(html.includes("&lt;script&gt;alert(&quot;artifact&quot;)&lt;/script&gt;"));
    assert.equal(html.includes('<script>alert("artifact")'), false);
    assert.ok(html.includes("synthetic backend fixtures"));
    assert.ok(html.includes("/new/&quot;&lt;script&gt;"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("PNG encoding differences are unchanged pixels; invalid images become explicit limitations", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tracepilot-visual-encoding-"));
  try {
    const base = join(temp, "base"),
      head = join(temp, "head"),
      output = join(temp, "report");
    for (const dir of [base, head]) {
      await mkdir(dir);
      await writeFile(
        join(dir, "capture-1-1.json"),
        JSON.stringify({
          schema: 1,
          cases: [
            { id: "sessions", status: "captured" },
            { id: "search", status: "captured" },
          ],
        }),
      );
      await writeFile(join(dir, "sessions.png"), png(42, { colorType: dir === base ? 2 : 6 }));
      await writeFile(join(dir, "search.png"), dir === head ? png().subarray(0, 25) : png());
    }
    const { rows } = await buildReport({ baseDir: base, headDir: head, output });
    const same = rows.find((row) => row.id === "sessions");
    assert.notEqual(same.baseHash, same.headHash);
    assert.equal(same.pngChanged, true);
    assert.equal(same.change, "unchanged");
    assert.equal(same.analyses[0].changed, 0);
    assert.match(same.analyses[0].description, /PNG bytes differ; decoded pixels are identical/);
    const invalid = rows.find((row) => row.id === "search");
    assert.equal(invalid.change, "incomplete");
    assert.equal(invalid.headHash, undefined);
    assert.match(invalid.head.errors.join(" "), /safely decoded/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("combined artifact inventories cannot expand beyond the trusted 128-view bound", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tracepilot-visual-limits-"));
  try {
    const base = join(temp, "base"),
      head = join(temp, "head"),
      output = join(temp, "report");
    await mkdir(base);
    await mkdir(head);
    const metadata = (prefix, count) =>
      JSON.stringify({
        schema: 1,
        cases: Array.from({ length: count }, (_, index) => ({
          id: `${prefix}-${index}`,
          status: "captured",
        })),
      });
    await writeFile(join(base, "capture-1-2.json"), metadata("base", 60));
    await writeFile(join(head, "capture-1-2.json"), metadata("head", 60));
    await assert.rejects(
      buildReport({ baseDir: base, headDir: head, output }),
      /Combined capture inventory exceeds limit/,
    );
    await writeFile(join(base, "capture-2-2.json"), metadata("extra", 70));
    await assert.rejects(
      buildReport({ baseDir: base, headDir: head, output }),
      /Capture inventory exceeds limit/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
