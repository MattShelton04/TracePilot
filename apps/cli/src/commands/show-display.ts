/**
 * Display helpers for `tracepilot show`.
 *
 * Pure presentation logic split out from `show.ts` so the command file stays
 * focused on orchestration. All functions write to stdout via `console.log`.
 */

import chalk from "chalk";
import type { TurnInfo } from "../lib/turnReconstruction.js";
import { formatTokens } from "./utils.js";

export interface ShutdownMetrics {
  shutdownType?: string;
  totalPremiumRequests?: number;
  totalNanoAiu?: number;
  tokenDetails?: Record<string, { tokenCount?: number }>;
  totalApiDurationMs?: number;
  sessionStartTime?: number;
  currentModel?: string;
  codeChanges?: {
    linesAdded?: number;
    linesRemoved?: number;
    filesModified?: string[];
  };
  modelMetrics?: Record<
    string,
    {
      requests?: { count?: number; cost?: number };
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        reasoningTokens?: number;
      };
      totalNanoAiu?: number;
      tokenDetails?: Record<string, { tokenCount?: number }>;
    }
  >;
}

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: string;
  deps: string[];
}

export function displayTurns(turns: TurnInfo[]): void {
  console.log(chalk.bold.blue("\n  Conversation Turns\n"));
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const dur = t.durationMs ? chalk.dim(`${(t.durationMs / 1000).toFixed(1)}s`) : "";
    const model = t.model ? chalk.magenta(`[${t.model}]`) : "";
    console.log(`  ${chalk.bold(`Turn ${i}`)}  ${model}  ${dur}`);

    if (t.userMessage) {
      console.log(`    ${chalk.cyan("User:")} ${t.userMessage}`);
    }
    if (t.assistantSnippet) {
      console.log(
        `    ${chalk.green("Assistant:")} ${t.assistantSnippet}${t.assistantSnippet.length >= 120 ? "…" : ""}`,
      );
    }
    if (t.tools.length > 0) {
      const toolMap = new Map<string, { ok: number; fail: number }>();
      for (const tool of t.tools) {
        const entry = toolMap.get(tool.name) ?? { ok: 0, fail: 0 };
        if (tool.success) entry.ok++;
        else entry.fail++;
        toolMap.set(tool.name, entry);
      }
      const parts = [...toolMap.entries()].map(([name, counts]) => {
        return counts.fail > 0
          ? `${name} (${chalk.green("✓")}${counts.ok} ${chalk.red("✗")}${counts.fail})`
          : `${name} (${chalk.green("✓")})`;
      });
      console.log(`    ${chalk.dim("Tools:")} ${parts.join(", ")}`);
    }
    console.log();
  }
}

export function displayMetrics(m: ShutdownMetrics): void {
  console.log(chalk.bold.blue("\n  Shutdown Metrics\n"));
  if (m.shutdownType) console.log(`    ${chalk.dim("Type:")} ${m.shutdownType}`);
  if (m.currentModel) console.log(`    ${chalk.dim("Model:")} ${m.currentModel}`);
  if (m.totalNanoAiu != null)
    console.log(
      `    ${chalk.dim("AI Credits:")} ${(m.totalNanoAiu / 1_000_000_000).toFixed(3)} ${chalk.dim("(observed)")}`,
    );
  else if (m.totalPremiumRequests != null)
    console.log(
      `    ${chalk.dim("Legacy premium requests:")} ${m.totalPremiumRequests} ${chalk.dim("(AIC unavailable)")}`,
    );
  if (m.totalApiDurationMs != null)
    console.log(`    ${chalk.dim("API duration:")} ${(m.totalApiDurationMs / 1000).toFixed(1)}s`);

  if (m.codeChanges) {
    const c = m.codeChanges;
    const files = c.filesModified?.length ?? 0;
    console.log(
      `    ${chalk.dim("Code changes:")} ${chalk.green(`+${c.linesAdded ?? 0}`)} ${chalk.red(`-${c.linesRemoved ?? 0}`)} (${files} files)`,
    );
  }

  if (m.modelMetrics && Object.keys(m.modelMetrics).length > 0) {
    console.log(`\n    ${chalk.bold("Model Usage:")}`);
    for (const [model, info] of Object.entries(m.modelMetrics)) {
      const reqs = info.requests?.count ?? 0;
      const input = formatTokens(info.usage?.inputTokens ?? 0);
      const output = formatTokens(info.usage?.outputTokens ?? 0);
      const aiCredits =
        info.totalNanoAiu != null ? ` AIC: ${(info.totalNanoAiu / 1_000_000_000).toFixed(3)}` : "";
      console.log(
        `      ${chalk.cyan(model.padEnd(28))} requests: ${String(reqs).padEnd(4)} input: ${input.padEnd(8)} output: ${output}${aiCredits}`,
      );
    }
  }
  console.log();
}

export function displayTodos(todos: TodoItem[]): void {
  console.log(chalk.bold.blue(`\n  Todos (${todos.length} items)\n`));
  for (const t of todos) {
    let icon: string;
    let statusLabel = "";
    switch (t.status) {
      case "done":
        icon = chalk.green("✓");
        break;
      case "in_progress":
        icon = chalk.yellow("●");
        statusLabel = chalk.yellow(" [in_progress]");
        break;
      case "blocked":
        icon = chalk.red("✗");
        statusLabel = chalk.red(` [blocked${t.deps.length ? ` by ${t.deps.join(", ")}` : ""}]`);
        break;
      default:
        icon = chalk.dim("○");
        break;
    }
    const idStr = chalk.dim(t.id.padEnd(20));
    console.log(`    ${icon} ${idStr} ${t.title}${statusLabel}`);
  }
  console.log();
}
