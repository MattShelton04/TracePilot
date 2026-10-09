import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fixtureRunner } from "./test-process.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tracepilot subprocess test "));
  const results = join(root, "results");
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "tracepilot subprocess test ")));
    rmSync(root, { recursive: true, force: true });
  });
  return { root, results, run: fixtureRunner(root, results) };
}

test("subprocess failures preserve exit status and fixture evidence before teardown", async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, ".tracepilot/automation"), { recursive: true });
  writeFileSync(join(f.root, ".tracepilot/automation/ui-vite.err.log"), "fixture startup failure");
  writeFileSync(join(f.root, "events.jsonl"), '{"event":"stop"}\n');
  await assert.rejects(
    f.run(process.execPath, [
      "-e",
      "console.log('started'); console.error('fixture error'); process.exit(7)",
    ]),
    (error) => {
      assert.equal(error.code, 7);
      assert.equal(error.killed, false);
      assert.match(error.stdout, /started/);
      assert.match(error.stderr, /fixture error/);
      assert.match(error.message, /killed=false, code=7/);
      assert.match(error.message, /Fixture diagnostics:/);
      return true;
    },
  );
  const [capture] = readdirSync(f.results);
  const saved = join(f.results, capture);
  const command = JSON.parse(readFileSync(join(saved, "command.json"), "utf8"));
  assert.equal(command.code, 7);
  assert.equal(command.killed, false);
  assert.match(command.stderr, /fixture error/);
  assert.equal(
    readFileSync(join(saved, ".tracepilot/automation/ui-vite.err.log"), "utf8"),
    "fixture startup failure",
  );
  assert.equal(readFileSync(join(saved, "events.jsonl"), "utf8"), '{"event":"stop"}\n');
});

test("a hung subprocess still fails with explicit watchdog diagnostics", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 1000 }),
    (error) => {
      assert.equal(error.killed, true);
      assert.match(error.message, /watchdog=1000ms, killed=true/);
      return true;
    },
  );
  const [capture] = readdirSync(f.results);
  const command = JSON.parse(readFileSync(join(f.results, capture, "command.json"), "utf8"));
  assert.equal(command.timeoutMs, 1000);
  assert.equal(command.killed, true);
});

test("diagnostic write errors cannot replace the original subprocess failure", async (t) => {
  const f = fixture(t);
  writeFileSync(f.results, "not a directory");
  await assert.rejects(f.run(process.execPath, ["-e", "process.exit(9)"]), (error) => {
    assert.equal(error.code, 9);
    assert.match(error.message, /Could not save fixture diagnostics:/);
    return true;
  });
});
