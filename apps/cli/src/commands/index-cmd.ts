/**
 * `tracepilot index` — stub for the index command.
 *
 * The full indexer is a Rust crate. For Phase 1, this is a placeholder.
 */

import chalk from "chalk";

export async function indexCommand(options: { full?: boolean }) {
  console.log(
    chalk.yellow(
      "\n  Index command uses the Rust indexer — run from the desktop app " +
        "or wait for NAPI-RS integration.\n"
    )
  );
  if (options.full) {
    console.log(chalk.dim("  (--full flag noted; will be used once Rust indexer is integrated)\n"));
  }
}
