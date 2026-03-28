//! `export` subcommand — export sessions to JSON, Markdown, or CSV.

use std::collections::HashSet;
use std::io::Write;
use std::path::Path;

use anyhow::{bail, Context, Result};
use tracepilot_export::options::{
    ContentDetailOptions, ExportFormat, ExportOptions, OutputTarget, RedactionOptions,
};
use tracepilot_export::SectionId;

use crate::cli::ExportOpts;

/// Run the export subcommand.
pub fn run(opts: ExportOpts) -> Result<()> {
    let format = parse_format(&opts.format)?;
    let sections = parse_sections(&opts.sections)?;

    let content_detail = ContentDetailOptions {
        include_subagent_internals: !opts.no_agent_internals,
        include_tool_details: !opts.no_tool_details,
        include_full_tool_results: opts.full_tool_results,
    };

    let redaction = RedactionOptions {
        anonymize_paths: opts.redact_paths,
        strip_secrets: opts.strip_secrets,
        strip_pii: opts.strip_pii,
    };

    let output_target = match &opts.output {
        Some(path) => OutputTarget::File(path.clone()),
        None => OutputTarget::String,
    };

    let export_options = ExportOptions {
        format,
        sections,
        output: output_target,
        content_detail,
        redaction,
    };

    // Preview mode: render and print to stdout
    if opts.preview {
        return run_preview(&opts.sessions, &export_options);
    }

    // Normal export
    let session_refs: Vec<&Path> = opts.sessions.iter().map(|p| p.as_path()).collect();

    let files = if session_refs.len() == 1 {
        tracepilot_export::export_session(session_refs[0], &export_options)
            .context("Export failed")?
    } else {
        tracepilot_export::export_sessions_batch(&session_refs, &export_options)
            .context("Export failed")?
    };

    match &opts.output {
        Some(output_path) => {
            // Write first file to the specified path
            if let Some(file) = files.first() {
                std::fs::write(output_path, &file.content)
                    .with_context(|| format!("Failed to write to {}", output_path.display()))?;
                eprintln!(
                    "Exported {} session(s) → {} ({} bytes)",
                    opts.sessions.len(),
                    output_path.display(),
                    file.content.len(),
                );

                // Write additional files (CSV multi-file) alongside the first
                for extra in files.iter().skip(1) {
                    let sibling = output_path.with_file_name(&extra.filename);
                    std::fs::write(&sibling, &extra.content).with_context(|| {
                        format!("Failed to write to {}", sibling.display())
                    })?;
                    eprintln!("  + {} ({} bytes)", extra.filename, extra.content.len());
                }
            }
        }
        None => {
            // Write to stdout
            if let Some(file) = files.first() {
                std::io::stdout()
                    .write_all(&file.content)
                    .context("Failed to write to stdout")?;
            }
        }
    }

    Ok(())
}

fn run_preview(sessions: &[std::path::PathBuf], options: &ExportOptions) -> Result<()> {
    if sessions.is_empty() {
        bail!("At least one session directory is required");
    }

    let content = tracepilot_export::preview_export(sessions[0].as_path(), options, None)
        .context("Preview failed")?;

    println!("{content}");
    Ok(())
}

// ── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_format(s: &str) -> Result<ExportFormat> {
    match s.to_lowercase().as_str() {
        "json" => Ok(ExportFormat::Json),
        "markdown" | "md" => Ok(ExportFormat::Markdown),
        "csv" => Ok(ExportFormat::Csv),
        _ => bail!("Unknown format '{}'. Valid: json, markdown (md), csv", s),
    }
}

fn parse_sections(raw: &[String]) -> Result<HashSet<SectionId>> {
    if raw.is_empty() {
        return Ok(SectionId::ALL.iter().copied().collect());
    }

    let mut set = HashSet::new();
    for name in raw {
        let section = match name.to_lowercase().as_str() {
            "conversation" => SectionId::Conversation,
            "events" => SectionId::Events,
            "todos" => SectionId::Todos,
            "plan" => SectionId::Plan,
            "checkpoints" => SectionId::Checkpoints,
            "rewind_snapshots" | "rewind-snapshots" | "snapshots" => SectionId::RewindSnapshots,
            "metrics" => SectionId::Metrics,
            "incidents" => SectionId::Incidents,
            "health" => SectionId::Health,
            "custom_tables" | "custom-tables" | "tables" => SectionId::CustomTables,
            "parse_diagnostics" | "parse-diagnostics" | "diagnostics" => {
                SectionId::ParseDiagnostics
            }
            _ => bail!(
                "Unknown section '{}'. Valid: conversation, events, todos, plan, checkpoints, \
                 rewind_snapshots, metrics, incidents, health, custom_tables, parse_diagnostics",
                name
            ),
        };
        set.insert(section);
    }
    Ok(set)
}
