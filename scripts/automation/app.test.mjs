import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fixtureRunner } from "./test-process.mjs";

test("Windows lifecycle owns only its recorded process trees", {
  skip: process.platform !== "win32",
}, async (t) => {
  // A path with spaces exercises real Windows argument handling. No Rust build or
  // user data is involved: the fixture is an HTTP server with one child process.
  const root = mkdtempSync(join(tmpdir(), "tracepilot automation test "));
  const execute = fixtureRunner(root);
  const launcher = join(root, "scripts/automation/app.ps1");
  const runtime = join(root, ".tracepilot/automation");
  const statePath = join(runtime, "ui.json");
  const registry = join(root, "registry");
  const claims = join(registry, "claims");
  const testEnv = { ...process.env, TRACEPILOT_AUTOMATION_REGISTRY: registry };
  const vite = join(root, "apps/desktop/node_modules/vite/bin/vite.js");
  for (const path of [launcher, vite]) mkdirSync(dirname(path), { recursive: true });
  copyFileSync(new URL("./app.ps1", import.meta.url), launcher);
  copyFileSync(new URL("./registry.ps1", import.meta.url), join(dirname(launcher), "registry.ps1"));
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
  const run = (action, mode = "ui", extra = [], env = testEnv) =>
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
      { env },
    );
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const instanceState = (name, mode = "ui") =>
    JSON.parse(readFileSync(join(root, ".tracepilot/instances", name, `${mode}.json`), "utf8"));
  const claimIds = () =>
    existsSync(claims)
      ? readdirSync(claims)
          .filter((file) => file.endsWith(".json"))
          .map((file) => file.slice(0, -5))
          .sort()
      : [];
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
    assert.equal(initial.runtime, "development");
    assert.equal(initial.dataRoot, null);
    assert.equal(initial.build.frontend, "vite-hmr");
    assert.equal(initial.build.rustProfile, "debug");
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
        ...testEnv,
        TRACEPILOT_TEST_STALL: "1",
      }),
      /Startup timed out/,
    );
    const pids = JSON.parse(readFileSync(join(runtime, "fixture-pids.json"), "utf8"));
    assert.equal(existsSync(statePath), false);
    for (const pid of pids) assert.equal(alive(pid), false, `orphan PID ${pid}`);
  });

  await t.test(
    "does not silently reuse a healthy instance with mismatched launch options",
    async () => {
      await run("start");
      const owned = state();
      const mismatched = structuredClone(owned);
      mismatched.runtime = "production";
      writeFileSync(statePath, JSON.stringify(mismatched));
      try {
        await assert.rejects(run("start"), /different launch options/);
        assert.equal(alive(owned.processes[0].pid), true);
        assert.equal(await (await fetch(owned.url)).text(), "fixture");
      } finally {
        writeFileSync(statePath, JSON.stringify(owned));
        await run("stop");
      }
    },
  );

  await t.test("rejects a relative desktop data root before launching", async () => {
    await assert.rejects(
      run("start", "desktop", ["-DataRoot", "relative-data"]),
      /TRACEPILOT_DATA_ROOT must be an absolute path/,
    );
    assert.equal(existsSync(join(runtime, "desktop.json")), false);
  });

  await t.test("rejects SkipBuild outside production runtime", async () => {
    await assert.rejects(
      run("start", "ui", ["-SkipBuild"]),
      /-SkipBuild is valid only with -Runtime production/,
    );
    assert.equal(existsSync(statePath), false);
  });

  await t.test("rejects invalid or production UI ports before launching", async () => {
    const invalidUiPort = (error) => {
      // The command line echoes UiPort even when the watchdog kills the shell.
      assert.equal(error.killed, false);
      assert.match(error.stderr, /Cannot validate\s+argument on parameter 'UiPort'/);
      return true;
    };
    await assert.rejects(run("start", "ui", ["-UiPort", "-1"]), invalidUiPort);
    await assert.rejects(run("start", "ui", ["-UiPort", "65536"]), invalidUiPort);
    await assert.rejects(
      run("start", "desktop", ["-Runtime", "production", "-UiPort", "1437"]),
      /-UiPort is valid only with -Runtime development/,
    );
    assert.equal(existsSync(statePath), false);
    assert.equal(existsSync(join(runtime, "desktop.json")), false);
  });

  await t.test("custom executables require an isolated production launch", async () => {
    await assert.rejects(
      run("start", "desktop", ["-Executable", process.execPath]),
      /-Executable requires desktop production mode/,
    );
    assert.equal(existsSync(join(runtime, "desktop.json")), false);
  });

  await t.test("separate lifecycle state does not stop the normal instance", async () => {
    const isolated = join(root, "independent lifecycle");
    const options = ["-StateDirectory", isolated];
    await run("start");
    const normal = state();
    try {
      await run("start", "ui", options);
      const separate = JSON.parse(readFileSync(join(isolated, "ui.json"), "utf8"));
      assert.notEqual(separate.url, normal.url);
      await run("stop", "ui", options);
      assert.equal(alive(normal.processes[0].pid), true);
      assert.equal(await (await fetch(normal.url)).text(), "fixture");
    } finally {
      await run("stop", "ui", options);
      await run("stop");
    }
  });

  await t.test("uses the requested UI port and rejects mismatched reuse", async () => {
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    await run("start", "ui", ["-UiPort", String(port)]);
    try {
      const owned = state();
      assert.equal(new URL(owned.url).port, String(port));
      assert.equal(await (await fetch(owned.url)).text(), "fixture");
      await run("start", "ui", ["-UiPort", String(port)]);
      const alternatePort = port === 65535 ? port - 1 : port + 1;
      await assert.rejects(
        run("start", "ui", ["-UiPort", String(alternatePort)]),
        /different launch options.*UI port/,
      );
      assert.deepEqual(state().processes, owned.processes);
      assert.equal(await (await fetch(owned.url)).text(), "fixture");
    } finally {
      await run("stop");
    }
  });

  await t.test("rejects an occupied requested UI port without disturbing its owner", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await assert.rejects(
        run("start", "ui", ["-UiPort", String(server.address().port)]),
        /No free loopback port/,
      );
      assert.equal(server.listening, true);
      assert.equal(existsSync(statePath), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test("rejects the same requested UI and CDP port before launching", async () => {
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    await assert.rejects(
      run("start", "desktop", ["-Port", String(port), "-UiPort", String(port)]),
      /No free loopback port/,
    );
    assert.equal(existsSync(join(runtime, "desktop.json")), false);
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

  await t.test(
    "concurrent named instances claim distinct ports outside the default range",
    async () => {
      try {
        await Promise.all([
          run("start", "ui", ["-Instance", "alpha"]),
          run("start", "ui", ["-Instance", "beta"]),
        ]);
        const alpha = instanceState("alpha");
        const beta = instanceState("beta");
        assert.notEqual(alpha.url, beta.url);
        for (const owned of [alpha, beta]) {
          const port = Number(new URL(owned.url).port);
          assert.ok(port >= 1440 && port <= 1479, `isolated UI port ${port}`);
          assert.equal(await (await fetch(owned.url)).text(), "fixture");
        }
        assert.deepEqual(claimIds(), [alpha.instanceId, beta.instanceId].sort());
        const { stdout } = await run("status", "ui", ["-All"]);
        assert.match(stdout, /alpha \| ui\/development/);
        assert.match(stdout, /beta \| ui\/development/);
        await run("stop", "ui", ["-Instance", "alpha"]);
        assert.deepEqual(claimIds(), [beta.instanceId]);
        assert.equal(await (await fetch(beta.url)).text(), "fixture");
      } finally {
        await run("stop", "ui", ["-Instance", "alpha"]);
        await run("stop", "ui", ["-Instance", "beta"]);
      }
      assert.deepEqual(claimIds(), []);
    },
  );

  await t.test("skips ports reserved by another live claim before they are bound", async () => {
    // Deterministic form of the race: a live instance has claimed a port that is
    // still free to bind (its server has not started yet). A new start must skip it.
    await run("start", "ui", ["-Instance", "holder"]);
    const reservedClaim = join(claims, `${"c".repeat(32)}.json`);
    try {
      const holder = instanceState("holder");
      const reservedPort = Number(new URL(holder.url).port) + 1;
      writeFileSync(
        reservedClaim,
        JSON.stringify({
          id: "c".repeat(32),
          mode: "ui",
          runtime: "development",
          repoRoot: join(root, "other checkout"),
          statePath: join(root, "other checkout", "ui.json"),
          uiPort: reservedPort,
          cdpPort: 0,
          processes: holder.processes,
        }),
      );
      await run("start", "ui", ["-Instance", "next"]);
      const next = Number(new URL(instanceState("next").url).port);
      assert.notEqual(next, reservedPort);
      assert.notEqual(next, reservedPort - 1);
    } finally {
      rmSync(reservedClaim, { force: true });
      await run("stop", "ui", ["-Instance", "next"]);
      await run("stop", "ui", ["-Instance", "holder"]);
    }
  });

  await t.test("prunes claims whose launcher and processes have exited", async () => {
    mkdirSync(claims, { recursive: true });
    const stale = join(claims, `${"a".repeat(32)}.json`);
    writeFileSync(
      stale,
      JSON.stringify({
        id: "a".repeat(32),
        mode: "ui",
        runtime: "development",
        uiPort: 1440,
        launcher: { pid: 999999, started: "0", executable: "C:/missing.exe" },
        processes: [],
      }),
    );
    const { stdout } = await run("status", "ui", ["-All"]);
    assert.match(stdout, /No live TracePilot automation instances/);
    assert.equal(existsSync(stale), false);
  });

  await t.test("keeps a fresh unreadable claim and prunes an old one", async () => {
    mkdirSync(claims, { recursive: true });
    const fresh = join(claims, `${"d".repeat(32)}.json`);
    const old = join(claims, `${"e".repeat(32)}.json`);
    writeFileSync(fresh, "{");
    writeFileSync(old, "{");
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    utimesSync(old, tenMinutesAgo, tenMinutesAgo);
    await run("status", "ui", ["-All"]);
    assert.equal(existsSync(fresh), true);
    assert.equal(existsSync(old), false);
    rmSync(fresh);
  });

  await t.test("refuses a second desktop development instance from one checkout", async () => {
    await run("start", "ui", ["-Instance", "gamma"]);
    const sibling = join(claims, `${"b".repeat(32)}.json`);
    try {
      // A live development desktop claim for this checkout, owned by the gamma server.
      writeFileSync(
        sibling,
        JSON.stringify({
          id: "b".repeat(32),
          mode: "desktop",
          runtime: "development",
          repoRoot: resolve(root),
          statePath: join(root, "elsewhere", "desktop.json"),
          uiPort: 0,
          cdpPort: 0,
          processes: instanceState("gamma").processes,
        }),
      );
      await assert.rejects(run("start", "desktop", ["-Instance", "delta"]), /its own worktree/);
      assert.equal(existsSync(join(root, ".tracepilot/instances/delta/desktop.json")), false);
      assert.deepEqual(claimIds(), [instanceState("gamma").instanceId, "b".repeat(32)].sort());
    } finally {
      rmSync(sibling, { force: true });
      await run("stop", "ui", ["-Instance", "gamma"]);
    }
  });

  await t.test("validates named-instance options before launching", async () => {
    await assert.rejects(run("start", "ui", ["-Instance", "Bad_Name"]), /-Instance must be/);
    await assert.rejects(
      run("start", "ui", ["-Instance", "ok", "-StateDirectory", join(root, "other")]),
      /either -Instance or -StateDirectory/,
    );
    await assert.rejects(run("start", "ui", ["-Fixtures"]), /-Fixtures requires desktop mode/);
    await assert.rejects(
      run("start", "desktop", ["-Instance", "first", "-FirstRun"]),
      /-FirstRun requires -Fixtures/,
    );
    assert.deepEqual(claimIds(), []);
  });
});
