#!/usr/bin/env node

/**
 * TracePilot CLI — inspect and explore Copilot CLI sessions from the terminal.
 *
 * Phase 1: Pure TypeScript reading session files directly (no Rust FFI).
 * Once the Rust core is mature, we can optionally add NAPI bindings.
 */

import { Command } from "commander";
import { listSessionsCommand } from "./commands/list.js";
import { showSessionCommand } from "./commands/show.js";
import { searchCommand } from "./commands/search.js";
import { resumeCommand } from "./commands/resume.js";
import { indexCommand } from "./commands/index-cmd.js";

const program = new Command();

program
  .name("tracepilot")
  .description("Visualize, audit, and inspect GitHub Copilot CLI sessions")
  .version("0.1.0")
  .action(() => {
    // Default: show list when no subcommand given
    program.commands.find((c) => c.name() === "list")?.parse([], { from: "user" });
  });

program
  .command("list")
  .description("List all Copilot CLI sessions")
  .option("-n, --limit <count>", "Maximum sessions to display", "20")
  .option("--sort <field>", "Sort by: updated, created, name", "updated")
  .option("--repo <name>", "Filter by repository name")
  .option("--branch <name>", "Filter by branch name")
  .option("--json", "Output as JSON")
  .action(listSessionsCommand);

program
  .command("show <session-id>")
  .description("Show details for a specific session")
  .option("--turns", "Show conversation turns")
  .option("--metrics", "Show shutdown metrics")
  .option("--todos", "Show todo items")
  .option("--json", "Output as JSON")
  .action(showSessionCommand);

program
  .command("search <query>")
  .description("Search sessions by summary, repo, branch, or message content")
  .option("--json", "Output as JSON")
  .action(searchCommand);

program
  .command("resume <session-id>")
  .description("Print the command to resume a Copilot CLI session")
  .action(resumeCommand);

program
  .command("index")
  .description("Rebuild the session search index")
  .option("--full", "Full reindex (instead of incremental)")
  .action(indexCommand);

program.parse();
