/**
 * `tracepilot show <session-id>` — display details for a specific session.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";

function getSessionDir(sessionId: string): string {
  const baseDir = join(homedir(), ".copilot", "session-state");
  return join(baseDir, sessionId);
}

async function findSession(partialId: string): Promise<string> {
  const baseDir = join(homedir(), ".copilot", "session-state");
  const entries = await readdir(baseDir);
  const matches = entries.filter((e) => e.startsWith(partialId));
  if (matches.length === 0) throw new Error(`No session matching "${partialId}"`);
  if (matches.length > 1)
    throw new Error(
      `Ambiguous ID "${partialId}" — matches: ${matches.join(", ")}`
    );
  return matches[0];
}

export async function showSessionCommand(
  sessionIdArg: string,
  options: { turns?: boolean; metrics?: boolean; todos?: boolean; json?: boolean }
) {
  try {
    const sessionId = await findSession(sessionIdArg);
    const dir = getSessionDir(sessionId);

    console.log(chalk.bold.blue(`\n  Session: ${sessionId}\n`));

    // Read workspace.yaml
    try {
      const yaml = await readFile(join(dir, "workspace.yaml"), "utf-8");
      console.log(chalk.dim("  --- workspace.yaml ---"));
      for (const line of yaml.split("\n").slice(0, 10)) {
        if (line.trim()) console.log(`  ${line}`);
      }
      console.log();
    } catch {
      console.log(chalk.dim("  (no workspace.yaml)\n"));
    }

    // Count events
    try {
      const events = await readFile(join(dir, "events.jsonl"), "utf-8");
      const lines = events.split("\n").filter((l) => l.trim());
      console.log(`  ${chalk.cyan("Events:")} ${lines.length}`);

      // Count by type
      const typeCounts = new Map<string, number>();
      for (const line of lines) {
        try {
          const evt = JSON.parse(line);
          const t = evt.type || "unknown";
          typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
        } catch { /* skip malformed lines */ }
      }
      for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${chalk.dim(type)}: ${count}`);
      }
      console.log();
    } catch {
      console.log(chalk.dim("  (no events.jsonl)\n"));
    }

    // List files present
    const files = await readdir(dir);
    console.log(`  ${chalk.cyan("Files:")} ${files.join(", ")}\n`);
  } catch (err) {
    console.error(chalk.red("Error:"), err);
    process.exit(1);
  }
}
