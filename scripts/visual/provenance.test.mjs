import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildReport } from "./report.mjs";

test("report rejects self-comparisons, wrong heads, mixed shards and swapped sides", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "visual-provenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseDir = join(root, "base"),
    headDir = join(root, "head"),
    output = join(root, "report");
  await mkdir(baseDir);
  await mkdir(headDir);
  const a = "a".repeat(40),
    b = "b".repeat(40);
  const save = (dir, revision, sha, shard = 1) =>
    writeFile(
      join(dir, `capture-${shard}-2.json`),
      JSON.stringify({ schema: 1, revision, revisionSha: sha, cases: [] }),
    );
  await save(baseDir, "base", a);
  await save(headDir, "head", a);
  await assert.rejects(buildReport({ baseDir, headDir, output }), /against itself/);
  await save(headDir, "head", b);
  await assert.rejects(
    buildReport({ baseDir, headDir, output, metadata: { expectedHeadSha: a } }),
    /does not match/,
  );
  await save(baseDir, "base", b, 2);
  await assert.rejects(buildReport({ baseDir, headDir, output }), /different revisions/);
  await save(baseDir, "head", a);
  await assert.rejects(buildReport({ baseDir, headDir, output }), /Wrong capture revision/);
});
