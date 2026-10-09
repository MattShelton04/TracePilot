import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const defaultResults = fileURLToPath(
  new URL("../../.tracepilot/automation-test-results/", import.meta.url),
);

// This watchdog includes cold PowerShell startup on hosted Windows. It is not
// the app's readiness deadline (the timeout test still passes TimeoutSeconds=1).
export const fixtureCommandTimeout = 60_000;

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
