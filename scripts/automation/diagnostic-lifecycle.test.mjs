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
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Run the real diagnostic entrypoints against a temporary checkout. Readiness is
// synthetic and the launcher only records arguments: no app/process is stopped.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tracepilot diagnostic test "));
  const events = join(root, "events.jsonl");
  const stop = join(root, "scripts/e2e/stop.ps1");
  for (const file of ["connect.mjs", "perf-profile.mjs", "stop.ps1"]) {
    const destination = join(root, "scripts/e2e", file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(new URL(`../e2e/${file}`, import.meta.url), destination);
  }
  mkdirSync(join(root, "scripts/automation"), { recursive: true });
  writeFileSync(
    join(root, "scripts/automation/app.ps1"),
    `param([string]$Action, [string]$Instance = '', [string]$ExpectedInstanceId = '')
$event = @{ event = 'stop'; instance = $Instance; instanceId = $ExpectedInstanceId } | ConvertTo-Json -Compress
Add-Content -LiteralPath $env:TRACEPILOT_TEST_EVENTS -Value $event
if ($env:TRACEPILOT_TEST_STOP_FAIL) { exit 1 }
exit 0
`,
  );
  writeFileSync(
    join(root, "scripts/automation/ready.mjs"),
    `import { appendFileSync } from 'node:fs';
const log = (event, extra = {}) => appendFileSync(process.env.TRACEPILOT_TEST_EVENTS, JSON.stringify({ event, ...extra }) + '\\n');
const fail = (step) => { if ((process.env.TRACEPILOT_TEST_FAIL ?? '').split(',').includes(step)) throw new Error('fixture failure: ' + step); };
export async function connectDesktop(endpoint, timeout, instanceId) {
  log('connect', { endpoint, instanceId });
  // Cleanup must use the connection selection even if arguments/environment change.
  process.env.TRACEPILOT_INSTANCE = 'changed-after-connect';
  process.argv.push('--instance', 'changed-after-connect');
  const browser = { close: async () => { log('disconnect'); fail('disconnect'); } };
  const page = {
    evaluate: async () => { fail('evaluate'); return []; },
    waitForTimeout: async () => {},
    locator: () => ({ first: () => ({ isVisible: async () => false }) }),
    on: () => log('capture-start'),
    off: () => { log('capture-stop'); fail('capture-stop'); },
  };
  const cdp = {
    send: async (method) => { fail('enable'); return { metrics: [] }; },
    detach: async () => { log('detach'); fail('detach'); },
  };
  const context = { newCDPSession: async () => { fail('session'); return cdp; } };
  return { browser, page, context };
}
`,
  );
  const state = (instance, port, instanceId = instance || "default") => {
    const path = instance
      ? join(root, ".tracepilot/instances", instance, "desktop.json")
      : join(root, ".tracepilot/automation/desktop.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ endpoint: `http://127.0.0.1:${port}`, instanceId }));
    return path;
  };
  const env = {
    ...process.env,
    TRACEPILOT_TEST_EVENTS: events,
    TRACEPILOT_INSTANCE: "",
    TRACEPILOT_AUTOMATION_REGISTRY: join(root, "registry"),
  };
  const runStop = (args = []) =>
    execute(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", stop, ...args],
      {
        cwd: root,
        env,
        windowsHide: true,
        timeout: 15_000,
      },
    );
  const runNode = (file, extraEnv = {}, args = []) =>
    execute(process.execPath, [file, ...args], {
      cwd: root,
      env: { ...env, ...extraEnv },
      windowsHide: true,
      timeout: 15_000,
    });
  const runApp = (args) =>
    execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, "scripts/automation/app.ps1"),
        ...args,
      ],
      { cwd: root, env, windowsHide: true, timeout: 15_000 },
    );
  const log = () =>
    existsSync(events)
      ? readFileSync(events, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
      : [];
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "tracepilot diagnostic test ")));
    rmSync(root, { recursive: true, force: true });
  });
  return { root, events, state, runStop, runNode, runApp, log };
}

test("diagnostic stop selects only the requested lifecycle state", {
  skip: process.platform !== "win32",
}, async (t) => {
  await t.test("named state is forwarded with port and start identity", async (t) => {
    const f = fixture(t);
    f.state("", 9222);
    f.state("profile", 9245, "profile-start");
    await f.runStop(["-Instance", "profile", "-Port", "9245", "-InstanceId", "profile-start"]);
    assert.deepEqual(f.log(), [
      { event: "stop", instance: "profile", instanceId: "profile-start" },
    ]);
  });
  await t.test("default and legacy explicit-port cleanup stay supported", async (t) => {
    const f = fixture(t);
    f.state("", 9230);
    await f.runStop();
    await f.runStop(["-Port", "9230"]);
    assert.equal(f.log().length, 2);
    assert.ok(f.log().every((event) => event.instance === ""));
  });
  for (const [name, args, createState] of [
    ["missing selected state", ["-Instance", "missing"], () => {}],
    ["missing explicit-port state", ["-Port", "9245"], () => {}],
    ["mismatched port", ["-Instance", "profile", "-Port", "9222"], (f) => f.state("profile", 9245)],
    [
      "restarted instance",
      ["-Instance", "profile", "-InstanceId", "old-start"],
      (f) => f.state("profile", 9245, "new-start"),
    ],
    ["invalid instance", ["-Instance", "../escape"], () => {}],
    ["invalid port", ["-Port", "65536"], () => {}],
  ]) {
    await t.test(`rejects ${name} without stopping default state`, async (t) => {
      const f = fixture(t);
      f.state("", 9222);
      createState(f);
      await assert.rejects(f.runStop(args));
      assert.deepEqual(f.log(), []);
    });
  }
});

test("performance profiling cleans up its captured connection on success or failure", {
  skip: process.platform !== "win32",
}, async (t) => {
  for (const failure of [
    "",
    "session",
    "enable",
    "evaluate",
    "capture-stop",
    "detach",
    "disconnect",
  ]) {
    await t.test(
      failure ? `cleanup after ${failure} failure` : "named profile completes",
      async (t) => {
        const f = fixture(t);
        f.state("", 9222);
        f.state("profile", 9245, "profile-start");
        const run = f.runNode(
          join(f.root, "scripts/e2e/perf-profile.mjs"),
          {
            TRACEPILOT_TEST_FAIL: failure,
          },
          ["--instance", "profile"],
        );
        if (["session", "enable", "evaluate", "capture-stop"].includes(failure)) {
          await assert.rejects(run, new RegExp(`fixture failure: ${failure}`));
        } else {
          await run;
        }
        const events = f.log();
        assert.deepEqual(
          events.filter((event) => event.event === "stop"),
          [{ event: "stop", instance: "profile", instanceId: "profile-start" }],
        );
        assert.equal(events.filter((event) => event.event === "disconnect").length, 1);
        if (failure !== "session") {
          assert.equal(events.filter((event) => event.event === "detach").length, 1);
        }
        if (!["session", "enable"].includes(failure)) {
          assert.equal(events.filter((event) => event.event === "capture-stop").length, 1);
        }
        assert.ok(
          events.findIndex((event) => event.event === "disconnect") <
            events.findIndex((event) => event.event === "stop"),
        );
      },
    );
  }
});

test("legacy shutdown guards explicit ports and continues after disconnect failure", {
  skip: process.platform !== "win32",
}, async (t) => {
  const f = fixture(t);
  f.state("", 9230);
  const caller = join(f.root, "scripts/e2e/caller.mjs");
  writeFileSync(
    caller,
    `import { shutdown } from './connect.mjs';
await shutdown({ close: async () => { throw new Error('disconnect failed'); } }, 9230);
await shutdown({ close: async () => {} }, 9222);
await shutdown({ close: async () => {} });
`,
  );
  const { stderr } = await f.runNode(caller);
  assert.equal(f.log().filter((event) => event.event === "stop").length, 2);
  assert.match(stderr, /stop.ps1 failed/);
});

test("explicit diagnostic connections retain their recorded identity without scanning", {
  skip: process.platform !== "win32",
}, async (t) => {
  for (const [name, instance, port, trackedPort, trackedId, rejects, stops] of [
    ["named matching port", "profile", 9245, 9245, "named-start", false, true],
    ["named mismatching port", "profile", 9222, 9245, "named-start", true, false],
    ["default matching port", "", 9230, 9230, "default-start", false, true],
    ["default external port", "", 9245, 9230, "default-start", false, false],
    ["untracked explicit port", "", 9245, undefined, "", false, false],
  ]) {
    await t.test(name, async (t) => {
      const f = fixture(t);
      if (trackedPort !== undefined) f.state(instance, trackedPort, trackedId);
      const caller = join(f.root, "scripts/e2e/caller.mjs");
      writeFileSync(
        caller,
        `import { connect, shutdown } from './connect.mjs';
const connection = await connect({ port: ${port}, instance: ${JSON.stringify(instance)} });
await shutdown(connection.browser, connection);
`,
      );
      const run = f.runNode(caller);
      if (rejects) {
        await assert.rejects(run, /does not belong to instance profile/);
        assert.deepEqual(f.log(), []);
      } else {
        const { stderr } = await run;
        assert.deepEqual(f.log()[0], {
          event: "connect",
          endpoint: `http://127.0.0.1:${port}`,
          instanceId: stops ? trackedId : "",
        });
        assert.equal(f.log().filter((event) => event.event === "disconnect").length, 1);
        assert.deepEqual(
          f.log().filter((event) => event.event === "stop"),
          stops ? [{ event: "stop", instance, instanceId: trackedId }] : [],
        );
        if (!stops) assert.match(stderr, /No captured instance identity/);
      }
    });
  }
});

test("the real launcher checks the expected start identity under its lifecycle lock", {
  skip: process.platform !== "win32",
}, async (t) => {
  for (const [name, recorded, expected, rejects] of [
    ["matching state", "a".repeat(32), "a".repeat(32), false],
    ["restarted state", "b".repeat(32), "a".repeat(32), true],
    ["missing state", undefined, "a".repeat(32), true],
    ["legacy omitted expectation", "a".repeat(32), "", false],
  ]) {
    await t.test(name, async (t) => {
      const f = fixture(t);
      for (const file of ["app.ps1", "registry.ps1"]) {
        copyFileSync(
          new URL(`./${file}`, import.meta.url),
          join(f.root, "scripts/automation", file),
        );
      }
      const path =
        recorded === undefined
          ? join(f.root, ".tracepilot/instances/profile/desktop.json")
          : f.state("profile", 9245, recorded);
      if (recorded !== undefined) {
        const state = JSON.parse(readFileSync(path, "utf8"));
        // Empty process records ensure this test cannot stop a real process.
        writeFileSync(path, JSON.stringify({ ...state, processes: [] }));
      }
      const args = ["stop", "-Instance", "profile"];
      if (expected) args.push("-ExpectedInstanceId", expected);
      const run = f.runApp(args);
      if (rejects) {
        await assert.rejects(run, /has changed since connection/);
        assert.equal(existsSync(path), recorded !== undefined);
      } else {
        await run;
        assert.equal(existsSync(path), false);
      }
      assert.deepEqual(f.log(), []);
    });
  }
});

test("structured cleanup never adopts lifecycle state created after connection", {
  skip: process.platform !== "win32",
}, async (t) => {
  for (const [name, instance, initialPort] of [
    ["absent default state appears", "", undefined],
    ["mismatched default state is replaced", "", 9230],
    ["absent named state appears", "profile", undefined],
  ]) {
    await t.test(name, async (t) => {
      const f = fixture(t);
      if (initialPort !== undefined) f.state(instance, initialPort, "original-start");
      const path = instance
        ? join(f.root, ".tracepilot/instances", instance, "desktop.json")
        : join(f.root, ".tracepilot/automation/desktop.json");
      const caller = join(f.root, "scripts/e2e/caller.mjs");
      writeFileSync(
        caller,
        `import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { connect, shutdown } from './connect.mjs';
const connection = await connect({ port: 9245, instance: ${JSON.stringify(instance)} });
const statePath = ${JSON.stringify(path)};
mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(statePath, JSON.stringify({ endpoint: 'http://127.0.0.1:9245', instanceId: 'new-start' }));
await shutdown(connection.browser, connection);
`,
      );
      const { stderr } = await f.runNode(caller);
      assert.equal(f.log()[0].instanceId, "");
      assert.equal(f.log().filter((event) => event.event === "disconnect").length, 1);
      assert.deepEqual(
        f.log().filter((event) => event.event === "stop"),
        [],
      );
      assert.match(stderr, /No captured instance identity/);
      assert.equal(JSON.parse(readFileSync(path, "utf8")).instanceId, "new-start");
    });
  }
});

test("primary profiling failure survives a simultaneous capture cleanup failure", {
  skip: process.platform !== "win32",
}, async (t) => {
  const f = fixture(t);
  f.state("profile", 9245, "profile-start");
  await assert.rejects(
    f.runNode(
      join(f.root, "scripts/e2e/perf-profile.mjs"),
      {
        TRACEPILOT_TEST_FAIL: "evaluate,capture-stop",
      },
      ["--instance", "profile"],
    ),
    (error) => {
      assert.match(error.stderr, /Error: fixture failure: evaluate/);
      assert.match(error.stderr, /Console capture cleanup failed: fixture failure: capture-stop/);
      return true;
    },
  );
  assert.deepEqual(
    f.log().filter((event) => event.event === "stop"),
    [{ event: "stop", instance: "profile", instanceId: "profile-start" }],
  );
  assert.equal(f.log().filter((event) => event.event === "capture-stop").length, 1);
  assert.equal(f.log().filter((event) => event.event === "detach").length, 1);
  assert.equal(f.log().filter((event) => event.event === "disconnect").length, 1);
});
