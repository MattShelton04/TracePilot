#!/usr/bin/env node

/**
 * TracePilot CLI — inspect and explore Copilot CLI sessions from the terminal.
 *
 * Most commands use pure TypeScript to read session files directly.
 * Export/import commands delegate to the Rust engine via subprocess bridge
 * for full-fidelity rendering, redaction, and import validation.
 */

import { Command } from "commander";
import { listSessionsCommand } from "./commands/list.js";
import { showSessionCommand } from "./commands/show.js";
import { searchCommand } from "./commands/search.js";
import { resumeCommand } from "./commands/resume.js";
import { indexCommand } from "./commands/index-cmd.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  versionsListCommand,
  versionsDiffCommand,
  versionsCoverageCommand,
  versionsReportCommand,
  versionsExamplesCommand,
} from "./commands/versions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

const program = new Command();

program
  .name("tracepilot")
  .description("Visualize, audit, and inspect GitHub Copilot CLI sessions")
  .version(pkg.version)
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

// ── export / import commands ─────────────────────────────────────────

program
  .command("export [session-ids...]")
  .description("Export sessions to JSON, Markdown, or CSV")
  .option("-f, --format <format>", "Output format: json, markdown (md), csv", "json")
  .option("-o, --output <path>", "Output file path (default: stdout)")
  .option("-s, --sections <list>", "Sections to include (comma-separated)", (v: string) => v.split(","))
  .option("--redact-paths", "Replace filesystem paths with <REDACTED_PATH>")
  .option("--strip-secrets", "Strip API keys, tokens, and credentials")
  .option("--strip-pii", "Strip emails, IP addresses, and other PII")
  .option("--no-agent-internals", "Exclude subagent internals")
  .option("--no-tool-details", "Exclude tool call arguments and results")
  .option("--full-tool-results", "Include full tool results instead of previews")
  .option("--preview", "Preview the rendered output (stdout only)")
  .action(exportCommand);

program
  .command("import <file>")
  .description("Import sessions from a .tpx.json archive")
  .option("-c, --conflict <strategy>", "Conflict resolution: skip, replace, duplicate", "skip")
  .option("-t, --target-dir <path>", "Target directory for imported sessions")
  .option("--sessions <ids>", "Only import specific session IDs (comma-separated)", (v: string) => v.split(","))
  .option("--dry-run", "Show what would be imported without writing")
  .action(importCommand);

// ── versions command group ───────────────────────────────────────────
const versionsCmd = program
  .command("versions")
  .description("Analyze installed Copilot CLI versions and schema changes");

versionsCmd
  .command("list")
  .description("List installed Copilot CLI versions with event/method/agent counts")
  .option("--json", "Output as JSON")
  .action(versionsListCommand);

versionsCmd
  .command("diff [v1] [v2]")
  .description("Show schema differences between CLI versions")
  .option("--json", "Output as JSON")
  .action(versionsDiffCommand);

versionsCmd
  .command("coverage")
  .description("Show TracePilot event type coverage vs installed schemas")
  .option("--json", "Output as JSON")
  .action(versionsCoverageCommand);

versionsCmd
  .command("report")
  .description("Generate comprehensive version analysis report")
  .option("-o, --output <path>", "Write report to file (default: stdout)")
  .action(versionsReportCommand);

versionsCmd
  .command("examples")
  .description("Find real session examples of event types")
  .option("-e, --event-type <name>", "Specific event type to search for")
  .option("--json", "Output as JSON")
  .action(versionsExamplesCommand);

program.parse();
