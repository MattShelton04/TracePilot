// A command-line report: printing is its output.
#![allow(clippy::print_stdout, clippy::print_stderr)]
//! Claude Code format census (implementation plan Q3). Run it through
//! `node scripts/claude-census.mjs`; see `scripts/README.md`.
//!
//! Reads the Claude Code config directory given as the only argument, else
//! `CLAUDE_CONFIG_DIR`, else `~/.claude`, and prints a Markdown report of
//! counts, type names and versions that is safe to paste into an issue.

use std::path::PathBuf;
use std::process::ExitCode;

use tracepilot_core::paths::default_claude_config_dir_opt;
use tracepilot_core::provider::claude_code::format_census;

fn main() -> ExitCode {
    let Some(dir) = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .or_else(default_claude_config_dir_opt)
    else {
        eprintln!("No Claude Code folder: pass its path, or set CLAUDE_CONFIG_DIR.");
        return ExitCode::FAILURE;
    };
    match format_census(&dir) {
        Ok(census) => {
            print!("{}", census.render());
            ExitCode::SUCCESS
        }
        // The error names the folder; keep it out of anything pasted.
        Err(_) => {
            eprintln!(
                "Could not read that Claude Code folder. Pass the folder that holds \
                 `projects/`, or set CLAUDE_CONFIG_DIR."
            );
            ExitCode::FAILURE
        }
    }
}
