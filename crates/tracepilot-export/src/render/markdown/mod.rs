//! Markdown renderer for human-readable session documents.
//!
//! Produces a single `.md` file with all included sections formatted for
//! readability. Intended for sharing with teammates, pasting into docs,
//! or feeding to AI for summarization.

use chrono::{DateTime, Utc};
use tracepilot_core::utils::InfallibleWrite;

use crate::document::{PortableSession, SessionArchive};
use crate::error::{ExportError, Result};
use crate::options::ExportFormat;
use crate::render::{ExportFile, ExportRenderer};

mod footer;
mod header;
mod turns;

#[cfg(test)]
mod format_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod turn_tests;

/// Renderer that produces human-readable Markdown documents.
pub struct MarkdownRenderer;

impl ExportRenderer for MarkdownRenderer {
    fn format(&self) -> ExportFormat {
        ExportFormat::Markdown
    }

    fn render(&self, archive: &SessionArchive) -> Result<Vec<ExportFile>> {
        let mut files = Vec::new();

        for session in &archive.sessions {
            let md = render_session(session, archive);
            let id = &session.metadata.id;
            let short_id = tracepilot_core::utils::truncate_utf8(id, 8);
            files.push(ExportFile {
                filename: format!("session-{}.md", short_id),
                content: md.into_bytes(),
                mime_type: self.mime_type().to_string(),
            });
        }

        if files.is_empty() {
            return Err(ExportError::Render {
                format: "Markdown".to_string(),
                message: "no sessions to render".to_string(),
            });
        }

        Ok(files)
    }

    fn display_name(&self) -> &'static str {
        "Markdown (.md)"
    }

    fn extension(&self) -> &'static str {
        "md"
    }

    fn mime_type(&self) -> &'static str {
        "text/markdown"
    }
}

fn render_session(session: &PortableSession, archive: &SessionArchive) -> String {
    let mut md = String::with_capacity(4096);

    header::write_header(&mut md, session, archive);
    header::write_metadata(&mut md, &session.metadata);

    if let Some(plan) = &session.plan {
        header::write_plan(&mut md, plan);
    }
    if let Some(conversation) = &session.conversation {
        turns::write_conversation(&mut md, conversation);
    }
    if let Some(todos) = &session.todos {
        footer::write_todos(&mut md, todos);
    }
    if let Some(rewind) = &session.rewind_snapshots {
        footer::write_rewind_snapshots(&mut md, rewind);
    }
    if let Some(checkpoints) = &session.checkpoints {
        footer::write_checkpoints(&mut md, checkpoints);
    }
    if let Some(metrics) = &session.shutdown_metrics {
        footer::write_metrics(&mut md, metrics);
    }
    if let Some(incidents) = &session.incidents {
        footer::write_incidents(&mut md, incidents);
    }
    if let Some(tables) = &session.custom_tables {
        footer::write_custom_tables(&mut md, tables);
    }
    if let Some(events) = &session.events {
        footer::write_events_summary(&mut md, events);
    }
    if let Some(diag) = &session.parse_diagnostics {
        footer::write_diagnostics(&mut md, diag);
    }

    md
}

pub(super) fn format_dt(dt: &DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Writes `body` as a fenced code block whose fence is longer than any
/// backtick run inside it, so a fence in the body (a tool result written in
/// Markdown, a file preview) can't end the block early.
pub(super) fn push_fenced(md: &mut String, info: &str, body: &str) {
    let mut longest = 0;
    let mut run = 0;
    for c in body.chars() {
        run = if c == '`' { run + 1 } else { 0 };
        longest = longest.max(run);
    }
    let fence = "`".repeat(longest.max(2) + 1);
    md.push_line(format_args!("{fence}{info}\n{body}\n{fence}\n"));
}

/// Writes Markdown from a plan or checkpoint with its ATX headings pushed
/// down `levels` (to `######` at most), so they nest under the export's own
/// section heading. Only real headings move: lines in fenced code blocks
/// (`# install deps` in a shell block) and lines that merely start with `#`
/// (`#!/bin/bash`, `#include`, `#123`) are written as they are.
pub(super) fn push_nested_markdown(md: &mut String, text: &str, levels: usize) {
    // The open fence's character and length, by CommonMark's rules.
    let mut fence: Option<(char, usize)> = None;
    for line in text.lines() {
        let body = line.trim_start_matches(' ');
        let indent = line.len() - body.len();
        let run = if indent <= 3 { fence_run(body) } else { None };
        match (fence, run) {
            (Some((open, len)), Some((c, n))) if c == open && n >= len => {
                if body[n..].trim().is_empty() {
                    fence = None;
                }
            }
            (Some(_), _) => {}
            // A backtick fence's info string can't contain a backtick.
            (None, Some((c, n))) if c == '~' || !body[n..].contains('`') => {
                fence = Some((c, n));
            }
            (None, _) if indent <= 3 => {
                if let Some(level) = atx_level(body) {
                    let hashes = "#".repeat((level + levels).min(6));
                    let (indent, rest) = (&line[..indent], &body[level..]);
                    md.push_line(format_args!("{indent}{hashes}{rest}"));
                    continue;
                }
            }
            _ => {}
        }
        md.push_line(format_args!("{line}"));
    }
}

/// The marker run starting `body` when it is long enough to open or close a
/// code fence.
fn fence_run(body: &str) -> Option<(char, usize)> {
    let c = body.chars().next().filter(|&c| c == '`' || c == '~')?;
    let n = body.chars().take_while(|&x| x == c).count();
    (n >= 3).then_some((c, n))
}

/// The level of an ATX heading: one to six `#`, then a space, a tab or nothing.
fn atx_level(body: &str) -> Option<usize> {
    let level = body.chars().take_while(|&c| c == '#').count();
    let after = body[level..].chars().next();
    ((1..=6).contains(&level) && matches!(after, None | Some(' ' | '\t'))).then_some(level)
}

/// A duration as the app's `formatDuration` writes it: `850ms`, `2.1s`,
/// `3m 3s` or `1h 2m`.
pub(super) fn format_duration(ms: u64) -> String {
    if ms < 1_000 {
        return format!("{ms}ms");
    }
    if ms >= 3_600_000 {
        return format!("{}h {}m", ms / 3_600_000, ms % 3_600_000 / 60_000);
    }
    if ms >= 60_000 {
        return format!("{}m {}s", ms / 60_000, ms % 60_000 / 1_000);
    }
    // JavaScript's `toFixed(1)` rounds an exact tie up where Rust rounds it to
    // even; the only exact ties are whole milliseconds ending in 250 or 750.
    let ms = if ms % 500 == 250 { ms + 50 } else { ms };
    let seconds = format!("{:.1}", ms as f64 / 1_000.0);
    format!("{}s", seconds.strip_suffix(".0").unwrap_or(&seconds))
}

/// Text for one table cell: `|` is escaped and line breaks become spaces, so
/// the value can't split its row or end the table.
pub(super) fn cell(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .replace('|', "\\|")
}
