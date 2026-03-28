/**
 * `tracepilot import <file>` — import sessions from a `.tpx.json` archive.
 *
 * Delegates to the Rust `tracepilot-export` binary for parsing, validation,
 * migration, and writing. The TypeScript layer handles Commander integration
 * and default directory resolution.
 */

import chalk from 'chalk';
import { getSessionStateDir } from './utils.js';
import { runExportBinary } from './rust-bridge.js';

interface ImportOptions {
  conflict?: string;
  targetDir?: string;
  sessions?: string[];
  dryRun?: boolean;
}

export async function importCommand(
  filePath: string,
  options: ImportOptions,
): Promise<void> {
  try {
    if (!filePath) {
      console.error(chalk.red('Error: A .tpx.json file path is required.'));
      process.exit(1);
    }

    // Build CLI arguments for the Rust binary
    const args: string[] = ['import', filePath];

    // Target directory (default: session state dir)
    args.push('--target-dir', options.targetDir || getSessionStateDir());

    // Conflict strategy
    if (options.conflict) {
      args.push('--conflict', options.conflict);
    }

    // Session filter
    if (options.sessions && options.sessions.length > 0) {
      args.push('--filter', options.sessions.join(','));
    }

    // Dry run
    if (options.dryRun) args.push('--dry-run');

    const result = runExportBinary(args);

    // Emit stdout
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }

    // Emit stderr (status messages)
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  } catch (err) {
    console.error(chalk.red(`Import failed: ${err}`));
    process.exit(1);
  }
}
