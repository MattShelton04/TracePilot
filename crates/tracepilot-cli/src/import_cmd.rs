//! `import` subcommand — import sessions from a `.tpx.json` archive.

use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use tracepilot_export::import::{self, ConflictStrategy, ImportOptions};

use crate::cli::ImportOpts;

/// Run the import subcommand.
pub fn run(opts: ImportOpts) -> Result<()> {
    let conflict_strategy = parse_conflict(&opts.conflict)?;
    let target_dir = opts.target_dir.unwrap_or_else(default_session_dir);

    if opts.dry_run {
        return run_preview(&opts.file, &target_dir, &opts.filter);
    }

    let import_options = ImportOptions {
        conflict_strategy,
        session_filter: opts.filter,
        dry_run: false,
    };

    let result = import::import_sessions(&opts.file, &target_dir, &import_options)
        .context("Import failed")?;

    eprintln!(
        "Imported {} session(s), skipped {}",
        result.imported.len(),
        result.skipped.len(),
    );

    for s in &result.imported {
        eprintln!("  ✓ {} → {}", s.id, s.path.display());
    }
    for s in &result.skipped {
        eprintln!("  ⊘ {} ({})", s.id, skip_reason_label(&s.reason));
    }
    if !result.warnings.is_empty() {
        eprintln!("\nWarnings:");
        for w in &result.warnings {
            eprintln!("  ⚠ {w}");
        }
    }

    Ok(())
}

fn run_preview(file: &PathBuf, target_dir: &PathBuf, filter: &[String]) -> Result<()> {
    let preview = import::preview_import(file, Some(target_dir.as_path()))
        .context("Preview failed")?;

    eprintln!("Archive: schema v{}", preview.schema_version);
    eprintln!("Migration needed: {:?}", preview.migration_status);
    eprintln!("Sessions: {}", preview.session_count);
    eprintln!("Can import: {}\n", preview.can_import);

    for s in &preview.sessions {
        let filtered_out = !filter.is_empty() && !filter.contains(&s.id);
        let status = if filtered_out {
            "(filtered out)"
        } else if s.already_exists {
            "(exists locally)"
        } else {
            "(new)"
        };

        eprintln!(
            "  {} {} {}",
            s.id,
            s.summary.as_deref().unwrap_or("Untitled"),
            status,
        );
    }

    if !preview.issues.is_empty() {
        eprintln!("\nValidation issues:");
        for issue in &preview.issues {
            let label = if issue.is_error() { "error" } else { "warn" };
            eprintln!("  [{}] {}", label, issue.message);
        }
    }

    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn parse_conflict(s: &str) -> Result<ConflictStrategy> {
    match s.to_lowercase().as_str() {
        "skip" => Ok(ConflictStrategy::Skip),
        "replace" => Ok(ConflictStrategy::Replace),
        "duplicate" | "dup" => Ok(ConflictStrategy::Duplicate),
        _ => bail!(
            "Unknown conflict strategy '{}'. Valid: skip, replace, duplicate",
            s
        ),
    }
}

fn default_session_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".copilot")
        .join("session-state")
}

fn skip_reason_label(reason: &import::SkipReason) -> &str {
    match reason {
        import::SkipReason::AlreadyExists => "already exists",
        import::SkipReason::FilteredOut => "filtered out",
        import::SkipReason::ValidationError(msg) => msg.as_str(),
    }
}
