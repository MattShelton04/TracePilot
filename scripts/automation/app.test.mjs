import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("Windows lifecycle owns only its recorded process trees", {
  skip: process.platform !== "win32",
}, async (t) => {
  // A path with spaces exercises real Windows argument handling. No Rust build or
  // user data is involved: the fixture is an HTTP server with one child process.
  const root = mkdtempSync(join(tmpdir(), "tracepilot automation test "));
  const launcher = join(root, "scripts/automation/app.ps1");
  const runtime = join(root, ".tracepilot/automation");
  const statePath = join(runtime, "ui.json");
  const vite = join(root, "apps/desktop/node_modules/vite/bin/vite.js");
  for (const path of [launcher, vite]) mkdirSync(dirname(path), { recursive: true });
  copyFileSync(new URL("./app.ps1", import.meta.url), launcher);
  writeFileSync(
    vite,
    `
    const { createServer } = require('node:http');
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true });
    writeFileSync('../../.tracepilot/automation/fixture-pids.json', JSON.stringify([process.pid, child.pid]));
    if (process.env.TRACEPILOT_TEST_STALL) setInterval(() => {}, 1000);
    else createServer((req, res) => res.end('fixture')).listen(Number(process.argv[process.argv.indexOf('--port') + 1]), '127.0.0.1');
  `,
  );
  const run = (action, mode = "ui", extra = [], env = process.env) =>
    execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        launcher,
        action,
        "-Mode",
        mode,
        ...extra,
      ],
      { cwd: root, windowsHide: true, timeout: 30_000, env },
    );
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  t.after(async () => {
    await run("stop");
    // Only delete the exact directory created for this test.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "tracepilot automation test ")));
    rmSync(root, { recursive: true, force: true });
  });

  await t.test("reuses a healthy server, then stops both parent and child", async () => {
    await run("start");
    const initial = state();
    assert.equal(await (await fetch(initial.url)).text(), "fixture");
    await run("start");
    await run("status");
    assert.deepEqual(state().processes, initial.processes);
    const pids = JSON.parse(readFileSync(join(runtime, "fixture-pids.json"), "utf8"));
    await run("stop");
    assert.equal(existsSync(statePath), false);
    for (const pid of pids) assert.equal(alive(pid), false, `orphan PID ${pid}`);
    await run("stop"); // Idempotent.
  });

  await t.test("refuses a stale PID record that points at a live process", async () => {
    await run("start");
    const owned = state();
    try {
      const stale = structuredClone(owned);
      stale.processes[0].started = "0";
      writeFileSync(statePath, JSON.stringify(stale));
      await run("stop");
      assert.equal(alive(owned.processes[0].pid), true);
      assert.equal(await (await fetch(owned.url)).text(), "fixture");
    } finally {
      writeFileSync(statePath, JSON.stringify(owned));
      await run("stop");
    }
  });

  await t.test("cleans up the complete tree after startup timeout", async () => {
    await assert.rejects(
      run("start", "ui", ["-TimeoutSeconds", "1"], {
        ...process.env,
        TRACEPILOT_TEST_STALL: "1",
      }),
      /Startup timed out/,
    );
    const pids = JSON.parse(readFileSync(join(runtime, "fixture-pids.json"), "utf8"));
    assert.equal(existsSync(statePath), false);
    for (const pid of pids) assert.equal(alive(pid), false, `orphan PID ${pid}`);
  });

  await t.test("rejects an occupied requested CDP port without disturbing its owner", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = server.address().port;
      await assert.rejects(
        run("start", "desktop", ["-Port", String(port)]),
        /No free loopback port/,
      );
      assert.equal(server.listening, true);
      assert.equal(existsSync(join(runtime, "desktop.json")), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
