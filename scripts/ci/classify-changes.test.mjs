import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyChanges, verifyRequired } from "./classify-changes.mjs";

test("main and unknown changes retain full CI", () => {
  assert.deepEqual(classifyChanges(["README.md"], "push"), { frontend: true, desktop: true });
  for (const paths of [
    [],
    ["new-root-file"],
    [".github/workflows/ci.yml"],
    ["pnpm-lock.yaml"],
    ["docs/tool.js"],
    ["site/App.vue", "packages/types/src/index.ts"],
  ]) {
    assert.deepEqual(classifyChanges(paths, "pull_request"), { frontend: true, desktop: true });
  }
});

test("docs skip app checks and site changes retain frontend validation", () => {
  assert.deepEqual(
    classifyChanges(["README.md", "docs/testing.md", "docs/images/app.png"], "pull_request"),
    { frontend: false, desktop: false },
  );
  assert.deepEqual(classifyChanges(["site/src/App.vue", "docs/landing-page.md"], "pull_request"), {
    frontend: true,
    desktop: false,
  });
  // A rename is represented by both its deleted and added paths.
  assert.equal(
    classifyChanges(["apps/desktop/src/App.vue", "site/src/App.vue"], "pull_request").desktop,
    true,
  );
});

function needsFor(frontend, desktop) {
  return {
    changes: {
      result: "success",
      outputs: { frontend: String(frontend), desktop: String(desktop) },
    },
    policy: { result: "success" },
    security: { result: "success" },
    frontend_build: { result: frontend ? "success" : "skipped" },
    frontend_test: { result: frontend ? "success" : "skipped" },
    desktop_test: { result: desktop ? "success" : "skipped" },
    automation_contracts: { result: desktop ? "success" : "skipped" },
    desktop_e2e: { result: desktop ? "success" : "skipped" },
    rust: { result: desktop ? "success" : "skipped" },
  };
}

test("required gate accepts precisely the selected jobs", () => {
  for (const flags of [
    [true, true],
    [false, false],
    [true, false],
  ])
    assert.deepEqual(verifyRequired(needsFor(...flags)), []);
});

test("required gate rejects failures, cancellation, unexpected skips and missing plans", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    const needs = needsFor(true, true);
    needs.desktop_e2e.result = result;
    assert.ok(verifyRequired(needs).some((error) => error.startsWith("desktop_e2e:")));
  }
  const needs = needsFor(false, false);
  needs.desktop_e2e.result = "failure";
  needs.changes.result = "failure";
  delete needs.changes.outputs.frontend;
  assert.equal(verifyRequired(needs).length, 3);
});

test("complete merge diff uses the tested base and preserves additions, deletions and moves", () => {
  const root = mkdtempSync(join(tmpdir(), "tracepilot-ci-selection-"));
  const repository = join(root, "repo");
  mkdirSync(repository);
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "user.name=CI test", "-c", "user.email=ci@example.invalid", ...args],
      { cwd: repository, encoding: "utf8" },
    ).trim();
  const write = (path, contents) => {
    const target = join(repository, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  const classify = (head) => {
    const eventPath = join(root, "event.json");
    const outputPath = join(root, "outputs");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { sha: head } } }));
    writeFileSync(outputPath, "");
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./classify-changes.mjs", import.meta.url))],
      {
        cwd: repository,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
        },
      },
    );
    return { ...result, outputs: readFileSync(outputPath, "utf8") };
  };
  try {
    git("init", "--quiet", "--initial-branch=main");
    write("README.md", "base\n");
    write("docs/deleted.md", "delete me\n");
    write("apps/desktop/source.txt", "application\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "base");
    git("switch", "--quiet", "-c", "docs-change");
    write("README.md", "updated docs\n");
    write("docs/added.md", "new docs\n");
    git("rm", "--quiet", "docs/deleted.md");
    git("add", ".");
    git("commit", "--quiet", "-m", "docs");
    const head = git("rev-parse", "HEAD");
    git("switch", "--quiet", "main");
    write("apps/desktop/source.txt", "unrelated main update\n");
    git("commit", "--quiet", "-am", "main update");
    git("merge", "--quiet", "--no-ff", "docs-change", "-m", "merge docs");
    const docs = classify(head);
    assert.equal(docs.status, 0, docs.stderr);
    assert.equal(docs.outputs, "frontend=false\ndesktop=false\n");
    assert.match(docs.stdout, /"changedFiles":3/);
    assert.notEqual(classify("0".repeat(40)).status, 0);

    git("switch", "--quiet", "-c", "move-change");
    git("mv", "apps/desktop/source.txt", "docs/source.md");
    git("commit", "--quiet", "-m", "move app source");
    const movedHead = git("rev-parse", "HEAD");
    git("switch", "--quiet", "main");
    git("merge", "--quiet", "--no-ff", "move-change", "-m", "merge move");
    const moved = classify(movedHead);
    assert.equal(moved.status, 0, moved.stderr);
    assert.equal(moved.outputs, "frontend=true\ndesktop=true\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
