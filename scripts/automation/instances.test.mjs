import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { isAlive, launcherFixture } from "./test-process.mjs";

// Agent isolation, -RealData and untracked-process cleanup. Like app.test.mjs, no
// Rust build or user data is involved.
test("Windows launcher keeps agents and real data isolated", {
  skip: process.platform !== "win32",
}, async (t) => {
  const fixture = launcherFixture();
  const { root, statePath, testEnv, run, instanceState, claimIds } = fixture;
  const alive = isAlive;
  // The launcher resolves the long path; tmpdir() can be an 8.3 short path on CI runners.
  const longRoot = realpathSync.native(root);
  t.after(() => fixture.cleanup());

  await t.test("agent environments must use a named or isolated instance", async () => {
    for (const agent of [{ CLAUDECODE: "1" }, { AI_AGENT: "codex" }, { CODEX_SANDBOX: "1" }]) {
      const env = { ...testEnv, ...agent };
      await assert.rejects(
        run("start", "ui", [], env),
        /Agent environment detected[\s\S]*-Instance/,
      );
      await assert.rejects(
        run("start", "desktop", [], env),
        /-Instance <slug> -Fixtures[\s\S]*-Instance <slug> -RealData/,
      );
    }
    assert.equal(existsSync(statePath), false);
    assert.deepEqual(claimIds(), []);
    const env = { ...testEnv, CLAUDECODE: "1" };
    try {
      await run("start", "ui", ["-Instance", "agent"], env);
      assert.equal(await (await fetch(instanceState("agent").url)).text(), "fixture");
    } finally {
      await run("stop", "ui", ["-Instance", "agent"], env);
    }
  });

  await t.test("validates -RealData options before launching", async () => {
    await assert.rejects(run("start", "desktop", ["-RealData"]), /-RealData requires/);
    await assert.rejects(run("start", "ui", ["-Instance", "r", "-RealData"]), /-RealData requires/);
    await assert.rejects(
      run("start", "desktop", ["-Instance", "r", "-RealData", "-Fixtures"]),
      /do not combine it/,
    );
    await assert.rejects(
      run("start", "desktop", ["-Instance", "r", "-RealData", "-DataRoot", join(root, "x")]),
      /do not combine it/,
    );
    assert.deepEqual(claimIds(), []);
  });

  await t.test("-RealData snapshots real sessions into the instance data root", async () => {
    // Stand-ins for ~/.copilot and ~/.claude; the fixture has no Tauri CLI, so the
    // start fails right after the snapshot and config are written.
    const home = join(root, "home");
    const events = join(home, ".copilot/session-state/real-1/events.jsonl");
    const transcript = join(home, ".claude/projects/C--repo/real-2.jsonl");
    for (const path of [events, transcript]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "{}\n");
    }
    const env = {
      ...testEnv,
      COPILOT_HOME: join(home, ".copilot"),
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
    };
    await assert.rejects(
      run("start", "desktop", ["-Instance", "real", "-RealData"], env),
      // PowerShell wraps error records at the console width, so join the lines first.
      (error) => /Missing .*apps.desktop/.test(String(error.message).replace(/\r?\n/g, "")),
    );
    const data = join(longRoot, ".tracepilot/instances/real/data");
    assert.equal(
      readFileSync(join(data, "copilot/session-state/real-1/events.jsonl"), "utf8"),
      "{}\n",
    );
    assert.ok(existsSync(join(data, "claude/projects/C--repo/real-2.jsonl")));
    const config = readFileSync(join(data, "tracepilot/config.toml"), "utf8");
    assert.match(config, /setupComplete = true/);
    assert.ok(config.includes(JSON.stringify(join(data, "copilot/session-state"))));
    assert.deepEqual(readdirSync(join(home, ".copilot")), ["session-state"]);
    assert.deepEqual(readdirSync(join(home, ".claude")), ["projects"]);
    await assert.rejects(
      run("start", "desktop", ["-Instance", "real", "-Fixtures"], env),
      /holds a real-data snapshot/,
    );
    assert.deepEqual(claimIds(), []);
  });

  await t.test("stop ends untracked desktop trees that use the instance profile", async () => {
    // Copies of node stand in for tracepilot-desktop.exe and its WebView2 child.
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const desktopExe = join(bin, "tracepilot-desktop.exe");
    const webviewExe = join(bin, "msedgewebview2.exe");
    copyFileSync(process.execPath, desktopExe);
    copyFileSync(process.execPath, webviewExe);
    const idle = join(bin, "idle.js");
    writeFileSync(idle, "setInterval(() => {}, 1000);");
    const profile = join(longRoot, ".tracepilot/instances/stray/data/webview-profile");
    const pidFile = join(bin, "desktop-pids.json");
    const desktopScript = join(bin, "desktop.js");
    writeFileSync(
      desktopScript,
      `const { spawn } = require('node:child_process');
       const child = spawn(${JSON.stringify(webviewExe)}, [${JSON.stringify(idle)}, ${JSON.stringify(`--user-data-dir=${profile}\\EBWebView`)}], { windowsHide: true });
       require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
       setInterval(() => {}, 1000);`,
    );
    const desktop = spawn(desktopExe, [desktopScript], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    desktop.unref();
    const decoy = spawn(webviewExe, [idle, `--user-data-dir=${join(root, "other-profile")}`], {
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      const deadline = Date.now() + 15_000;
      while (!existsSync(pidFile) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 100));
      const pids = JSON.parse(readFileSync(pidFile, "utf8"));
      const { stdout } = await run("stop", "desktop", ["-Instance", "stray"]);
      assert.match(stdout, /Stopped 1 untracked desktop process tree/);
      for (const pid of pids) assert.equal(alive(pid), false, `orphan PID ${pid}`);
      assert.equal(alive(decoy.pid), true, "a webview with another profile is not ours");
    } finally {
      decoy.kill();
      try {
        process.kill(desktop.pid);
      } catch {}
    }
  });
});
