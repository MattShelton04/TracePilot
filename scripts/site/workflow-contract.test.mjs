import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/site.yml", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

function verifyStalenessPaths(source) {
  const yaml = source.replaceAll("\r\n", "\n");
  const trigger = yaml.match(/^ {4}paths: &site-paths\n((?: {6}- .+\n)+)/m);
  assert.ok(trigger, "Missing authoritative Site trigger paths");
  assert.match(yaml, /^ {4}paths: \*site-paths$/m, "Main must use the same Site paths as PRs");
  const paths = trigger[1]
    .trim()
    .split("\n")
    .map((line) => {
      const pattern = line.trim().slice(2);
      // Current triggers are literal files or recursive directories. New glob
      // forms need an explicit equivalent Git pathspec rather than silent drift.
      assert.match(pattern, /^[\w./-]+(?:\/\*\*)?$/, `Unsupported Site glob: ${pattern}`);
      return pattern.replace(/\/\*\*$/, "");
    });
  const guard = yaml.match(/if git diff --quiet "\$BUILD_SHA" HEAD -- \\\n([\s\S]*?); then/);
  assert.ok(guard, "Missing Site staleness diff");
  const pathspecs = guard[1].replaceAll("\\\n", " ").trim().split(/\s+/);
  for (const path of pathspecs)
    assert.match(path, /^[\w./-]+$/, `Unsupported Site pathspec: ${path}`);
  assert.deepEqual(
    pathspecs.sort(),
    paths.sort(),
    "Site staleness paths must cover precisely the inputs that trigger replacement builds",
  );
}

test("Site PR/main filters and deploy staleness guard cover the same inputs", () => {
  verifyStalenessPaths(workflow);
});

test("Site path contract rejects changes to either list", () => {
  assert.throws(
    () =>
      verifyStalenessPaths(
        workflow.replace("paths: &site-paths\n", "paths: &site-paths\n      - new-input/**\n"),
      ),
    /Site staleness paths must cover precisely/,
  );
  assert.throws(
    () => verifyStalenessPaths(workflow.replace("packages/types/data packages/ui", "packages/ui")),
    /Site staleness paths must cover precisely/,
  );
});
