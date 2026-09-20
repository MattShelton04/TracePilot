//! Durable, deterministic TracePilot performance corpus generator and service probe.
//!
//! The probe measures Rust service functions directly. It does not include the
//! Tauri command layer, desktop IPC, webview rendering, or controlled filesystem
//! cache state, and it does not claim an optimization.

#[path = "performance_probe/events.rs"]
mod events;
#[path = "performance_probe/generate.rs"]
mod generate;
#[path = "performance_probe/measure.rs"]
mod measure;
#[path = "performance_probe/model.rs"]
mod model;
#[path = "performance_probe/plan.rs"]
mod plan;
#[path = "performance_probe/validate.rs"]
mod validate;

use std::io;
use std::path::PathBuf;

use generate::generate_corpus;
use measure::probe_corpus;
use model::{AnyError, MANIFEST_FILE, Scale};
use serde_json::json;
use validate::{fail, write_json_output};

fn main() {
    if let Err(error) = run() {
        eprintln!("performance_probe: {error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), AnyError> {
    let args: Vec<String> = std::env::args().collect();
    let Some(command) = args.get(1).map(String::as_str) else {
        return usage_error();
    };

    match command {
        "generate" => {
            let root = absolute_root(required_option(&args, "--root")?)?;
            let scale = Scale::parse(required_option(&args, "--scale")?)?;
            let repeats = optional_usize(&args, "--repeats", 3)?;
            let should_probe = has_flag(&args, "--probe");
            let manifest = generate_corpus(&root, scale)?;
            if should_probe {
                let report = probe_corpus(&root, repeats, args.clone())?;
                write_json_output(&report, optional_path(&args, "--output")?)?;
            } else {
                let output = json!({
                    "fixtureVersion": manifest.fixture_version,
                    "scale": manifest.scale,
                    "root": manifest.root,
                    "manifest": root.join(MANIFEST_FILE),
                    "sessionCount": manifest.totals.session_count,
                    "eventCount": manifest.totals.event_count,
                    "turnCount": manifest.totals.turn_count,
                    "sourceBytes": manifest.totals.source_bytes,
                    "fileCount": manifest.totals.file_count,
                    "probeCommand": format!(
                        "cargo run --release -p tracepilot-bench --example performance_probe -- probe --root \"{}\" --repeats 3",
                        root.display()
                    )
                });
                write_json_output(&output, optional_path(&args, "--output")?)?;
            }
        }
        "probe" => {
            let root = absolute_root(required_option(&args, "--root")?)?;
            let repeats = optional_usize(&args, "--repeats", 3)?;
            let output = optional_path(&args, "--output")?;
            let report = probe_corpus(&root, repeats, args)?;
            write_json_output(&report, output)?;
        }
        _ => return usage_error(),
    }
    Ok(())
}

fn usage_error<T>() -> Result<T, AnyError> {
    fail(
        "usage:\n  cargo run --release -p tracepilot-bench --example performance_probe -- generate --root <absolute-path> --scale <small|typical|large|massive> [--probe] [--repeats 3] [--output <new-file>]\n  cargo run --release -p tracepilot-bench --example performance_probe -- probe --root <absolute-path> [--repeats 3] [--output <new-file>]",
    )
}

fn required_option<'a>(args: &'a [String], name: &str) -> Result<&'a str, AnyError> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].as_str())
        .ok_or_else(|| io::Error::other(format!("missing required option {name}")).into())
}

fn optional_path(args: &[String], name: &str) -> Result<Option<PathBuf>, AnyError> {
    let value = args
        .windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| PathBuf::from(&pair[1]));
    if let Some(path) = &value
        && !path.is_absolute()
    {
        return fail(format!(
            "{name} must be an absolute path: {}",
            path.display()
        ));
    }
    Ok(value)
}

fn optional_usize(args: &[String], name: &str, default: usize) -> Result<usize, AnyError> {
    let value = args
        .windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].parse::<usize>())
        .transpose()?
        .unwrap_or(default);
    if value == 0 || value > 20 {
        return fail(format!("{name} must be between 1 and 20"));
    }
    Ok(value)
}

fn has_flag(args: &[String], name: &str) -> bool {
    args.iter().any(|arg| arg == name)
}

fn absolute_root(value: &str) -> Result<PathBuf, AnyError> {
    let root = PathBuf::from(value);
    if !root.is_absolute() {
        return fail(format!("--root must be absolute: {}", root.display()));
    }
    Ok(root)
}
