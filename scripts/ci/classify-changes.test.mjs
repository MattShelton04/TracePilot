import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyChanges, verifyRequired } from "./classify-changes.mjs";

const ALL = { frontend: true, desktop: true, rust: true, dependencies: true };
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

test("main and unknown changes retain full CI", () => {
  assert.deepEqual(classifyChanges(["README.md"], "push"), ALL);
  assert.deepEqual(classifyChanges([], "pull_request"), ALL);
  for (const paths of [
    ["new-root-file"],
    [".github/workflows/ci.yml"],
    ["Cargo.lock"],
    ["docs/tool.js"],
    ["site/App.vue", "packages/types/src/index.ts", "crates/tracepilot-core/Cargo.toml"],
  ]) {
    const { dependencies: _audits, ...application } = classifyChanges(paths, "pull_request");
    assert.deepEqual(application, { frontend: true, desktop: true, rust: true }, paths.join());
  }
});

test("the daily schedule runs only the dependency audits", () => {
  assert.deepEqual(classifyChanges([], "schedule"), {
    frontend: false,
    desktop: false,
    rust: false,
    dependencies: true,
  });
});

test("docs skip app checks and site changes retain frontend validation", () => {
  assert.deepEqual(
    classifyChanges(["README.md", "docs/testing.md", "docs/images/app.png"], "pull_request"),
    { frontend: false, desktop: false, rust: false, dependencies: false },
  );
  assert.deepEqual(classifyChanges(["site/src/App.vue", "docs/landing-page.md"], "pull_request"), {
    frontend: true,
    desktop: false,
    rust: false,
    dependencies: false,
  });
  // A rename is represented by both its deleted and added paths.
  assert.equal(
    classifyChanges(["apps/desktop/src/App.vue", "site/src/App.vue"], "pull_request").desktop,
    true,
  );
});

test("frontend-only changes skip the Rust matrix but keep the shipped-app checks", () => {
  assert.deepEqual(
    classifyChanges(
      [
        "apps/desktop/src/App.vue",
        "packages/ui/src/Button.vue",
        "packages/types/src/session.ts",
        "packages/client/src/commands.ts",
        "tests/e2e/journeys.spec.mjs",
        "pnpm-lock.yaml",
      ],
      "pull_request",
    ),
    { frontend: true, desktop: true, rust: false, dependencies: true },
  );
  for (const path of [
    "crates/tracepilot-core/src/lib.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "packages/types/data/model-registry.json",
    "packages/types/src/generated/contracts.ts",
    "packages/client/src/generated/commands.ts",
    "rust-toolchain.toml",
    "scripts/e2e/test.ps1",
  ]) {
    assert.equal(classifyChanges([path], "pull_request").rust, true, path);
  }
});

test("every frontend file the crates read selects the Rust matrix", () => {
  const references = new Set();
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "target") walk(path);
      } else if (entry.name.endsWith(".rs")) {
        for (const match of readFileSync(path, "utf8").matchAll(
          /(?:\.\.\/)+((?:packages|apps)\/[\w./-]+)/g,
        ))
          references.add(match[1]);
      }
    }
  };
  walk(join(repoRoot, "crates"));
  assert.ok(references.size > 0, "expected crates to embed shared frontend data");
  for (const path of references)
    assert.equal(classifyChanges([path], "pull_request").rust, true, path);
});

test("dependency audits run when manifests or lockfiles change", () => {
  for (const path of [
    "Cargo.lock",
    "crates/tracepilot-core/Cargo.toml",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/desktop/package.json",
    "scripts/visual/package-lock.json",
    "deny.toml",
  ]) {
    assert.equal(classifyChanges([path], "pull_request").dependencies, true, path);
  }
  assert.equal(
    classifyChanges(
      ["crates/tracepilot-core/src/lib.rs", "apps/desktop/src/App.vue"],
      "pull_request",
    ).dependencies,
    false,
  );
});

function needsFor(frontend, desktop, rust = desktop, dependencies = false) {
  const result = (selected) => ({ result: selected ? "success" : "skipped" });
  return {
    changes: {
      result: "success",
      outputs: {
        frontend: String(frontend),
        desktop: String(desktop),
        rust: String(rust),
        dependencies: String(dependencies),
      },
    },
    policy: { result: "success" },
    security: result(dependencies),
    frontend_build: result(frontend),
    frontend_test: result(frontend),
    desktop_test: result(desktop),
    automation_contracts: result(desktop),
    desktop_e2e: result(desktop),
    rust: result(rust),
  };
}

test("required gate accepts precisely the selected jobs", () => {
  for (const flags of [
    [true, true, true, true],
    [false, false, false, false],
    [true, false, false, false],
    [true, true, false, false],
    [false, false, false, true],
  ])
    assert.deepEqual(verifyRequired(needsFor(...flags)), []);
});

test("required gate rejects failures, cancellation, unexpected skips and missing plans", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    const needs = needsFor(true, true, true, true);
    needs.desktop_e2e.result = result;
    assert.ok(verifyRequired(needs).some((error) => error.startsWith("desktop_e2e:")));
    const audit = needsFor(true, true, true, true);
    audit.security.result = result;
    assert.ok(verifyRequired(audit).some((error) => error.startsWith("security:")));
  }
  const needs = needsFor(false, false);
  needs.desktop_e2e.result = "failure";
  needs.changes.result = "failure";
  delete needs.changes.outputs.frontend;
  assert.equal(verifyRequired(needs).length, 3);
  const unexpected = needsFor(true, true, false);
  unexpected.rust.result = "success";
  assert.ok(verifyRequired(unexpected).some((error) => error.startsWith("rust:")));
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
    assert.equal(docs.outputs, "frontend=false\ndesktop=false\nrust=false\ndependencies=false\n");
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
    assert.equal(moved.outputs, "frontend=true\ndesktop=true\nrust=false\ndependencies=false\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
