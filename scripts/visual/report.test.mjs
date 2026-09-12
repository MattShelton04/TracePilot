import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cases, selectCases } from "./manifest.mjs";
import { buildReport, escapeHtml, validatePng } from "./report.mjs";

function png(value = 0) {
  const bytes = Buffer.alloc(25);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(1440, 16);
  bytes.writeUInt32BE(960, 20);
  bytes[24] = value;
  return bytes;
}

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
            { id: "sessions", status: "captured" },
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
