/**
 * `tracepilot export <session-id...>` — export sessions to JSON, Markdown, or CSV.
 *
 * Delegates to the Rust `tracepilot-export` binary for all rendering, redaction,
 * and content filtering. The TypeScript layer handles session ID resolution
 * (partial IDs → full UUIDs → directory paths) and Commander integration.
 */

import { join } from 'node:path';
import chalk from 'chalk';
import { findSession, getSessionStateDir } from './utils.js';
import { runExportBinary } from './rust-bridge.js';

interface ExportOptions {
  format: string;
  output?: string;
  sections?: string[];
  redactPaths?: boolean;
  stripSecrets?: boolean;
  stripPii?: boolean;
  noAgentInternals?: boolean;
  noToolDetails?: boolean;
  fullToolResults?: boolean;
  preview?: boolean;
}

export async function exportCommand(
  sessionIds: string[],
  options: ExportOptions,
): Promise<void> {
  try {
    if (!sessionIds || sessionIds.length === 0) {
      console.error(chalk.red('Error: At least one session ID is required.'));
      process.exit(1);
    }

    // Resolve partial session IDs to full paths
    const sessionPaths: string[] = [];
    const baseDir = getSessionStateDir();

    for (const id of sessionIds) {
      try {
        const fullId = await findSession(id);
        sessionPaths.push(join(baseDir, fullId));
      } catch (err) {
        console.error(chalk.red(`Error resolving session "${id}": ${err}`));
        process.exit(1);
      }
    }

    // Build CLI arguments for the Rust binary
    const args: string[] = ['export'];

    // Session paths (positional)
    args.push(...sessionPaths);

    // Format
    args.push('--format', options.format || 'json');

    // Output file
    if (options.output) {
      args.push('--output', options.output);
    }

    // Sections
    if (options.sections && options.sections.length > 0) {
      args.push('--sections', options.sections.join(','));
    }

    // Redaction flags
    if (options.redactPaths) args.push('--redact-paths');
    if (options.stripSecrets) args.push('--strip-secrets');
    if (options.stripPii) args.push('--strip-pii');

    // Content detail flags
    if (options.noAgentInternals) args.push('--no-agent-internals');
    if (options.noToolDetails) args.push('--no-tool-details');
    if (options.fullToolResults) args.push('--full-tool-results');

    // Preview mode
    if (options.preview) args.push('--preview');

    const result = runExportBinary(args);

    // Emit stdout (the exported content)
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }

    // Emit stderr (status messages from the Rust binary)
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  } catch (err) {
    console.error(chalk.red(`Export failed: ${err}`));
    process.exit(1);
  }
}
