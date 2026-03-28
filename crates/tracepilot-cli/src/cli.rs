//! CLI argument definitions using `clap` derive macros.

use clap::Parser;
use std::path::PathBuf;

/// TracePilot Export CLI — export and import Copilot sessions.
#[derive(Parser)]
#[command(name = "tracepilot-export", version, about)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

impl Cli {
    pub fn parse_from_env() -> Self {
        Self::parse()
    }
}

#[derive(clap::Subcommand)]
pub enum Command {
    /// Export one or more sessions to JSON, Markdown, or CSV.
    Export(ExportOpts),
    /// Import sessions from a .tpx.json archive.
    Import(ImportOpts),
}

// ── Export Options ──────────────────────────────────────────────────────────

#[derive(Parser)]
pub struct ExportOpts {
    /// Path(s) to session directories to export.
    #[arg(required = true)]
    pub sessions: Vec<PathBuf>,

    /// Output format: json, markdown, csv.
    #[arg(short, long, default_value = "json")]
    pub format: String,

    /// Output file path. If omitted, writes to stdout.
    #[arg(short, long)]
    pub output: Option<PathBuf>,

    /// Sections to include (comma-separated). Omit for all.
    /// Valid: conversation, events, todos, plan, checkpoints, rewind_snapshots,
    ///        metrics, incidents, health, custom_tables, parse_diagnostics.
    #[arg(short, long, value_delimiter = ',')]
    pub sections: Vec<String>,

    /// Replace filesystem paths with <REDACTED_PATH>.
    #[arg(long)]
    pub redact_paths: bool,

    /// Strip API keys, tokens, and credentials.
    #[arg(long)]
    pub strip_secrets: bool,

    /// Strip emails, IP addresses, and other PII.
    #[arg(long)]
    pub strip_pii: bool,

    /// Exclude subagent internals (reasoning, nested tool calls).
    #[arg(long)]
    pub no_agent_internals: bool,

    /// Exclude tool call arguments and result content.
    #[arg(long)]
    pub no_tool_details: bool,

    /// Include full tool results instead of 1KB previews.
    #[arg(long)]
    pub full_tool_results: bool,

    /// Print the rendered output to stdout (preview mode).
    #[arg(long)]
    pub preview: bool,
}

// ── Import Options ─────────────────────────────────────────────────────────

#[derive(Parser)]
pub struct ImportOpts {
    /// Path to the .tpx.json archive file.
    pub file: PathBuf,

    /// Target directory to write imported sessions into.
    /// Defaults to ~/.copilot/session-state/.
    #[arg(short = 't', long)]
    pub target_dir: Option<PathBuf>,

    /// Conflict resolution: skip, replace, duplicate.
    #[arg(short, long, default_value = "skip")]
    pub conflict: String,

    /// Only import specific session IDs (comma-separated).
    #[arg(long, value_delimiter = ',')]
    pub filter: Vec<String>,

    /// Show what would be imported without writing anything.
    #[arg(long)]
    pub dry_run: bool,
}
