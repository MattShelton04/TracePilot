import assert from "node:assert/strict";
import { sep } from "node:path";
import test from "node:test";
import { discoverDesktop, instanceFromArgs, stateFile } from "../e2e/connect.mjs";

test("diagnostic scripts select a named instance from arguments or the environment", () => {
  assert.equal(instanceFromArgs([], {}), "");
  assert.equal(instanceFromArgs(["--instance", "perf-1"], {}), "perf-1");
  assert.equal(instanceFromArgs(["--port", "9240", "--instance=perf-2"], {}), "perf-2");
  assert.equal(instanceFromArgs([], { TRACEPILOT_INSTANCE: "perf-3" }), "perf-3");
  assert.equal(instanceFromArgs(["--instance=cli"], { TRACEPILOT_INSTANCE: "env" }), "cli");
  assert.throws(() => instanceFromArgs(["--instance"], {}), /needs a name/);
  assert.throws(() => instanceFromArgs(["--instance=../escape"], {}), /Invalid instance name/);
  assert.throws(() => instanceFromArgs(["--instance=Upper"], {}), /Invalid instance name/);
});

test("named instances read their own lifecycle state", async () => {
  assert.ok(stateFile().endsWith([".tracepilot", "automation", "desktop.json"].join(sep)));
  assert.ok(
    stateFile("perf-1").endsWith([".tracepilot", "instances", "perf-1", "desktop.json"].join(sep)),
  );
  await assert.rejects(
    discoverDesktop(undefined, "missing-instance-for-test"),
    /pnpm app:start -Instance missing-instance-for-test/,
  );
  assert.deepEqual(await discoverDesktop(9240, "ignored"), { port: 9240, instanceId: "" });
});
