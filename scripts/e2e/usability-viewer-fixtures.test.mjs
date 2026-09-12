import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { enrichViewerFixtures, viewerFixtures } from "./usability-viewer-fixtures.mjs";

const require = createRequire(new URL("../../packages/ui/package.json", import.meta.url));
const Papa = require("papaparse");
const id = "12345678-1234-1234-1234-123456789abc";
const manifest = { sessions: [{ id, kind: "rich-lifecycle" }] };

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-viewer-fixtures-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true });
  });
  const options = {
    sessionRoot: root,
    ensureDirectory: (directory) => mkdirSync(directory, { recursive: true }),
    writeNew: (path, content) => writeFileSync(path, content, { flag: "wx" }),
  };
  return { root, options, directory: join(root, id, "viewer-fixtures") };
}

test("viewer fixtures exercise valid structured data and intentional JSON failure", () => {
  const files = viewerFixtures();
  assert.equal(files.size, 8);
  const json = JSON.parse(files.get("audit-structured.json"));
  const longKey = Object.keys(json).find((key) => key.length > 200);
  assert(longKey);
  assert(json[longKey].length > 1_000);
  assert.equal(json.summary.owner, null);
  const records = files.get("audit-records.jsonl").trim().split("\n").map(JSON.parse);
  assert.equal(records.length, 120);
  assert.equal(records.at(-1).data.label, "Final record — filter target café");
  const csv = Papa.parse(files.get("audit-table.csv"), { skipEmptyLines: "greedy" });
  assert.deepEqual(csv.errors, []);
  assert.equal(csv.data.length, 121);
  assert.equal(csv.data[1][3], 'Comma, quote "Ready", and a\nsecond line');
  assert(csv.data.every((row) => row.length === 5));
  assert.throws(() => JSON.parse(files.get("audit-invalid.json")), SyntaxError);
  assert(files.get("audit-binary.bin").includes(0));
  assert.equal(files.get("audit-preview.png").readUInt32BE(16), 160);
  assert.equal(files.get("audit-preview.png").readUInt32BE(20), 96);
});

test("enrichment creates missing assets and preserves edited fixtures on repeat", (t) => {
  const { root, options, directory } = sandbox(t);
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, "plan.md"), "Existing edited plan");
  const first = enrichViewerFixtures(manifest, options);
  assert.equal(first.created.length, 8);
  assert.deepEqual(first.preserved, []);
  writeFileSync(join(directory, "audit-notes.txt"), "User-edited disposable notes");
  const second = enrichViewerFixtures(manifest, options);
  assert.deepEqual(second.created, []);
  assert.equal(second.preserved.length, 8);
  assert.equal(
    readFileSync(join(directory, "audit-notes.txt"), "utf8"),
    "User-edited disposable notes",
  );
  assert.equal(readFileSync(join(root, id, "plan.md"), "utf8"), "Existing edited plan");
});

test("unsafe destination and invalid session IDs fail before any asset write", (t) => {
  const { options, directory } = sandbox(t);
  mkdirSync(join(directory, "audit-preview.png"), { recursive: true });
  assert.throws(() => enrichViewerFixtures(manifest, options), /Unsafe existing fixture file/);
  assert.deepEqual(readdirSync(directory), ["audit-preview.png"]);
  assert.throws(
    () =>
      enrichViewerFixtures({ sessions: [{ id: "../escape", kind: "rich-lifecycle" }] }, options),
    /match the regular expression/,
  );
});
