//! TracePilot Export CLI — export and import sessions from the command line.
//!
//! This binary wraps the `tracepilot-export` library crate, exposing its full
//! export/import pipeline through a `clap`-based CLI with sensible defaults.
//!
//! # Usage
//!
//! ```sh
//! tracepilot-export export <session-dir> -f json -o session.tpx.json
//! tracepilot-export import <file> --conflict skip
//! ```

mod cli;
mod export_cmd;
mod import_cmd;

fn main() -> anyhow::Result<()> {
    let args = cli::Cli::parse_from_env();

    match args.command {
        cli::Command::Export(opts) => export_cmd::run(opts),
        cli::Command::Import(opts) => import_cmd::run(opts),
    }
}
