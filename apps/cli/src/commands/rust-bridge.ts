/**
 * Subprocess bridge to the Rust `tracepilot-export` binary.
 *
 * The export/import engine is implemented in Rust (crates/tracepilot-export).
 * Rather than reimplementing that logic in TypeScript, we delegate to the
 * compiled Rust binary and capture its output. This gives us:
 *
 * - Zero code duplication with the Rust engine
 * - Full feature parity (redaction, renderers, import pipeline)
 * - The same 500+ tests backing every operation
 *
 * The binary is located by searching (in order):
 *   1. `TRACEPILOT_EXPORT_BIN` env var (explicit override)
 *   2. Workspace `target/debug/` or `target/release/` (dev builds)
 *   3. System PATH (installed binary)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BINARY_NAME = process.platform === 'win32' ? 'tracepilot-export.exe' : 'tracepilot-export';

/**
 * Find the Rust binary by checking common locations.
 * Throws with a helpful message if not found.
 */
function findBinary(): string {
  // 1. Explicit env var override
  const envPath = process.env.TRACEPILOT_EXPORT_BIN;
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Workspace target directories (dev builds)
  // Walk up from apps/cli/src/commands/ to find workspace root
  const workspaceRoot = resolve(__dirname, '..', '..', '..', '..');
  for (const profile of ['debug', 'release']) {
    const candidate = join(workspaceRoot, 'target', profile, BINARY_NAME);
    if (existsSync(candidate)) return candidate;
  }

  // 3. Try system PATH via `which` / `where`
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const result = execFileSync(cmd, [BINARY_NAME], { encoding: 'utf-8' }).trim();
    if (result) return result.split('\n')[0].trim();
  } catch {
    // not in PATH
  }

  throw new Error(
    `Could not find the tracepilot-export binary.\n\n` +
      `The export/import commands require the Rust binary to be built.\n` +
      `To build it, run: cargo build -p tracepilot-cli\n\n` +
      `Alternatively, set the TRACEPILOT_EXPORT_BIN environment variable\n` +
      `to the path of the tracepilot-export binary.`,
  );
}

// Cache the resolved binary path
let cachedBinaryPath: string | undefined;

function getBinary(): string {
  if (!cachedBinaryPath) {
    cachedBinaryPath = findBinary();
  }
  return cachedBinaryPath;
}

export interface BridgeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the Rust binary with the given arguments.
 * Uses `spawnSync` to capture both stdout and stderr on success.
 *
 * @param args - CLI arguments (e.g., ['export', '--format', 'json', ...])
 * @param options - Options to control execution
 * @returns stdout, stderr, and exit code
 */
export function runExportBinary(
  args: string[],
  options?: { maxBuffer?: number },
): BridgeResult {
  const bin = getBinary();
  const result = spawnSync(bin, args, {
    maxBuffer: options?.maxBuffer ?? 50 * 1024 * 1024,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw new Error(`Failed to execute ${bin}: ${result.error.message}`);
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}
