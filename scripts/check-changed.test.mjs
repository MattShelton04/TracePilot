import assert from "node:assert/strict";
import { test } from "node:test";
import { crateFor, parseArgs, planChecks, tail } from "./check-changed.mjs";

const crates = {
  "crates/tracepilot-core": "tracepilot-core",
  "crates/tracepilot-indexer": "tracepilot-indexer",
  "apps/desktop/src-tauri": "tracepilot-desktop",
};

function ctx({ deleted = [] } = {}) {
  return {
    crates,
    maxWorkers: "2",
    exists: (path) => !deleted.includes(path),
    testFiles: (dir) => [`${dir}/a.test.mjs`, `${dir}/b.test.mjs`],
  };
}

const plan = (paths, options) => planChecks(paths, ctx(options));
const names = (paths, options) => plan(paths, options).steps.map((step) => step.name);
const command = (step) => [step.cmd, ...step.args].join(" ");

test("docs-only changes run only the doc link check on those files", () => {
  const { steps } = plan(["docs/testing.md", "README.md"]);
  assert.deepEqual(steps.map(command), [
    "node scripts/check-doc-links.mjs docs/testing.md README.md",
  ]);
});

test("a deleted markdown page checks links across the repository", () => {
  const { steps } = plan(["docs/old.md", "docs/new.md"], { deleted: ["docs/old.md"] });
  assert.equal(command(steps[0]), "node scripts/check-doc-links.mjs");
});

test("desktop source runs biome, sizes, design system, scoped typecheck and related tests", () => {
  const paths = ["apps/desktop/src/components/Foo.vue", "apps/desktop/src/utils/bar.ts"];
  assert.deepEqual(names(paths), [
    "biome",
    "file sizes",
    "design system",
    "typecheck",
    "desktop tests (related)",
  ]);
  const steps = plan(paths).steps;
  assert.equal(
    command(steps.at(-1)),
    "pnpm --filter @tracepilot/desktop exec vitest related --run --maxWorkers=2 src/components/Foo.vue src/utils/bar.ts",
  );
  assert.equal(
    command(steps.find((s) => s.name === "typecheck")),
    "pnpm --workspace-concurrency=2 --filter ...@tracepilot/desktop typecheck",
  );
});

test("desktop config changes run the whole desktop suite", () => {
  const step = plan(["apps/desktop/vitest.config.ts"]).steps.at(-1);
  assert.equal(step.name, "desktop tests (all)");
  assert.match(command(step), /vitest run --maxWorkers=2$/);
});

test("deleted desktop files are not passed to vitest related", () => {
  const { steps } = plan(["apps/desktop/src/gone.ts"], { deleted: ["apps/desktop/src/gone.ts"] });
  assert.ok(!steps.some((s) => s.name.startsWith("desktop tests")));
  assert.ok(!steps.some((s) => s.name === "biome"), "biome never receives deleted paths");
});

test("shared packages run their own suite and typecheck their dependents", () => {
  const { steps, notes } = plan([
    "packages/ui/src/components/Button.vue",
    "packages/types/src/x.ts",
  ]);
  assert.deepEqual(steps.filter((s) => s.name.endsWith("tests")).map(command), [
    "pnpm --filter @tracepilot/ui exec vitest run --maxWorkers=2",
    "pnpm --filter @tracepilot/types exec vitest run --maxWorkers=2",
  ]);
  assert.equal(
    command(steps.find((s) => s.name === "typecheck")),
    "pnpm --workspace-concurrency=2 --filter ...@tracepilot/types --filter ...@tracepilot/ui typecheck",
  );
  assert.ok(notes.some((note) => note.includes("just ci")));
});

test("max workers is configurable", () => {
  const steps = planChecks(["packages/client/src/a.ts"], { ...ctx(), maxWorkers: "4" }).steps;
  assert.ok(steps.some((s) => s.args.includes("--maxWorkers=4")));
});

test("crate changes run fmt, clippy and tests for exactly those crates", () => {
  const paths = [
    "crates/tracepilot-indexer/src/lib.rs",
    "crates/tracepilot-core/tests/golden/case.json",
    "apps/desktop/src-tauri/src/main.rs",
  ];
  const steps = plan(paths).steps.filter((s) => s.cmd === "cargo");
  assert.deepEqual(steps.map(command), [
    "cargo fmt --all -- --check",
    "cargo clippy -p tracepilot-core -p tracepilot-desktop -p tracepilot-indexer --all-targets -j 6 -- -D warnings",
    "cargo test -p tracepilot-core -p tracepilot-desktop -p tracepilot-indexer -j 6",
  ]);
});

test("crate READMEs don't trigger Rust checks", () => {
  assert.deepEqual(names(["crates/tracepilot-core/README.md"]), ["doc links"]);
});

test("root Rust configuration adds a full-gate note instead of a workspace build", () => {
  const { steps, notes } = plan(["Cargo.lock"]);
  assert.deepEqual(steps, []);
  assert.match(notes[0], /just ci/);
});

test("script groups run their own node tests with group options", () => {
  const steps = plan(["scripts/automation/app.ps1", "scripts/pricing/cli.mjs"]).steps;
  const automation = steps.find((s) => s.name === "node --test scripts/automation");
  assert.deepEqual(automation.args, [
    "--test",
    "--test-concurrency=1",
    "scripts/automation/a.test.mjs",
    "scripts/automation/b.test.mjs",
  ]);
  assert.ok(steps.some((s) => s.name === "node --test scripts/pricing"));
  assert.ok(steps.some((s) => s.name === "check-scripts-index"));
});

test("a group README change checks links and the script index, not the group tests", () => {
  assert.deepEqual(names(["scripts/perf/README.md"]), ["doc links", "check-scripts-index"]);
});

test("renderer and fixture changes run the fixture and visual contracts", () => {
  const steps = plan(["packages/ui/src/components/renderers/Shell.vue"], {
    deleted: ["scripts/visual/node_modules"],
  }).steps;
  const visual = steps.find((s) => s.name === "node --test scripts/visual");
  assert.ok(steps.some((s) => s.name === "node --test scripts/fixtures"));
  assert.match(visual.skip, /npm ci --prefix scripts\/visual/);
});

test("top-level scripts run their sibling test when it exists", () => {
  const steps = plan(["scripts/check-doc-links.mjs", "scripts/build.ps1"]).steps;
  const top = steps.find((s) => s.name === "node --test scripts/*.test.mjs");
  assert.deepEqual(top.args, ["--test", "scripts/check-doc-links.test.mjs"]);
});

test("policy checks follow the files that can break them", () => {
  assert.deepEqual(names([".github/workflows/ci.yml"]), ["check-workflow-actions"]);
  assert.deepEqual(names(["docs/adr/0001-x.md"]), ["doc links", "check-adr"]);
  assert.deepEqual(names(["changelog.d/fix-search.md"]), ["doc links", "changelog fragments"]);
  assert.ok(names(["crates/tracepilot-orchestrator/src/lib.rs"]).includes("check-public-api"));
});

test("crateFor maps crate folders and falls back to the folder", () => {
  assert.equal(crateFor("crates/tracepilot-core/src/a.rs", crates), "tracepilot-core");
  assert.equal(crateFor("crates/new-crate/src/a.rs", crates), "crates/new-crate");
  assert.equal(crateFor("apps/desktop/src/a.ts", crates), undefined);
});

test("parseArgs accepts both flag forms and rejects unknown flags", () => {
  assert.deepEqual(parseArgs(["--base", "main", "--dry-run"]), {
    base: "main",
    dryRun: true,
    maxWorkers: process.env.CHECK_CHANGED_MAX_WORKERS ?? "2",
  });
  assert.equal(parseArgs(["--base=origin/dev", "--max-workers=3"]).maxWorkers, "3");
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--max-workers", "0"]), /positive integer/);
});

test("tail keeps the last lines and drops trailing whitespace", () => {
  const text = `${Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\r\n")}\n\n`;
  const lines = tail(text);
  assert.equal(lines.length, 40);
  assert.equal(lines[0], "line 10");
  assert.equal(lines.at(-1), "line 49");
});
