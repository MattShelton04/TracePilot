import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const defaultResults = fileURLToPath(
  new URL("../../.tracepilot/automation-test-results/", import.meta.url),
);

// This watchdog includes cold PowerShell startup on hosted Windows. It is not
// the app's readiness deadline (the timeout test still passes TimeoutSeconds=1).
export const fixtureCommandTimeout = 60_000;

export const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// A copy of the launcher in a temporary checkout whose "Vite" is an HTTP server with
// one child process. A path with spaces exercises real Windows argument handling.
// No Rust build or user data is involved.
export function launcherFixture() {
  const root = mkdtempSync(join(tmpdir(), "tracepilot automation test "));
  const execute = fixtureRunner(root);
  const launcher = join(root, "scripts/automation/app.ps1");
  const runtime = join(root, ".tracepilot/automation");
  const statePath = join(runtime, "ui.json");
  const registry = join(root, "registry");
  const claims = join(registry, "claims");
  // The suites often run inside an agent; agent detection is tested explicitly.
  const testEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(CLAUDECODE|AI_AGENT|CODEX_.*|COPILOT_HOME|CLAUDE_CONFIG_DIR)$/i.test(name),
    ),
  );
  testEnv.TRACEPILOT_AUTOMATION_REGISTRY = registry;
  const vite = join(root, "apps/desktop/node_modules/vite/bin/vite.js");
  for (const path of [launcher, vite]) mkdirSync(dirname(path), { recursive: true });
  for (const file of ["app.ps1", "registry.ps1", "real-data.mjs"])
    copyFileSync(new URL(`./${file}`, import.meta.url), join(dirname(launcher), file));
  writeFileSync(
    vite,
    `
    const { createServer } = require('node:http');
    const { spawn } = require('node:child_process');
    const { mkdirSync, writeFileSync } = require('node:fs');
    mkdirSync('../../.tracepilot/automation', { recursive: true });
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
  return {
    root,
    runtime,
    statePath,
    claims,
    testEnv,
    run,
    state: () => JSON.parse(readFileSync(statePath, "utf8")),
    instanceState: (name, mode = "ui") =>
      JSON.parse(readFileSync(join(root, ".tracepilot/instances", name, `${mode}.json`), "utf8")),
    claimIds: () =>
      existsSync(claims)
        ? readdirSync(claims)
            .filter((file) => file.endsWith(".json"))
            .map((file) => file.slice(0, -5))
            .sort()
        : [],
    async cleanup() {
      await run("stop");
      // Only delete the exact directory created for this fixture.
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      assert.ok(root.startsWith(join(tmpdir(), "tracepilot automation test ")));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function fixtureRunner(root, resultsDirectory = defaultResults) {
  return async (file, args, { timeout = fixtureCommandTimeout, ...options } = {}) => {
    const started = performance.now();
    try {
      return await execute(file, args, { ...options, cwd: root, windowsHide: true, timeout });
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - started);
      error.message = `Fixture command failed after ${elapsedMs}ms (watchdog=${timeout}ms, killed=${Boolean(error.killed)}, code=${error.code}, signal=${error.signal ?? "none"}).\n${error.message}`;
      // Snapshot before fixture teardown removes its logs and lifecycle state.
      // Expected nonzero exits are recorded too; assertions still decide whether
      // they represent a test failure. Only synthetic fixture data is copied.
      const destination = join(resultsDirectory, randomUUID());
      try {
        mkdirSync(destination, { recursive: true });
        writeFileSync(
          join(destination, "command.json"),
          JSON.stringify(
            {
              file,
              args,
              elapsedMs,
              timeoutMs: timeout,
              killed: Boolean(error.killed),
              code: error.code,
              signal: error.signal,
              stdout: error.stdout,
              stderr: error.stderr,
            },
            null,
            2,
          ),
        );
        for (const path of [".tracepilot", "registry", "events.jsonl"]) {
          const source = join(root, path);
          if (existsSync(source)) cpSync(source, join(destination, path), { recursive: true });
        }
        error.message += `\nFixture diagnostics: ${destination}`;
      } catch (diagnosticError) {
        error.message += `\nCould not save fixture diagnostics: ${diagnosticError.message}`;
      }
      throw error;
    }
  };
}
