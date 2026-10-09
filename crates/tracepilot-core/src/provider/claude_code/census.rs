//! The format census behind `scripts/claude-census.mjs` (implementation plan
//! Q3): which record and attachment types the parser has no mapping for, and
//! which Claude Code versions wrote the sessions under a config directory.
//!
//! The report is safe to paste into an issue. It holds counts, type names
//! and versions only (each checked by [`super::drift`]), never paths, ids or
//! content. It reads only what indexing reads: `projects/<slug>/<uuid>.jsonl`
//! and their `subagents/`, never `sessions/` or any key file.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::Path;

use super::drift::version_order;
use super::{ClaudeCodeProvider, ClaudeDiagnostics, parse_claude_session};
use crate::error::Result;
use crate::provider::SessionProvider;

/// How many sessions an observation appeared in, and in how many records.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Tally {
    pub sessions: usize,
    pub records: usize,
}

/// Format drift across every session under one config directory.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FormatCensus {
    pub sessions: usize,
    /// Sessions the parser could not read at all.
    pub unreadable_sessions: usize,
    pub malformed_lines: usize,
    pub partial_tails: usize,
    pub oversized_lines: usize,
    pub unmapped_record_types: BTreeMap<String, Tally>,
    pub unmapped_attachment_types: BTreeMap<String, Tally>,
    pub versions: BTreeMap<String, Tally>,
}

/// Parse every session under `config_dir` (a Claude Code config directory,
/// the folder holding `projects/`) and tally its format drift.
pub fn format_census(config_dir: &Path) -> Result<FormatCensus> {
    let never = || false;
    let mut census = FormatCensus::default();
    for session in ClaudeCodeProvider::new(config_dir).discover(&never)? {
        census.sessions += 1;
        match parse_claude_session(&session.primary_path, &never) {
            Ok(parsed) => census.add(&parsed.diagnostics),
            Err(_) => census.unreadable_sessions += 1,
        }
    }
    Ok(census)
}

impl FormatCensus {
    /// Add one session's diagnostics.
    pub fn add(&mut self, diagnostics: &ClaudeDiagnostics) {
        self.malformed_lines += diagnostics.malformed_lines;
        self.partial_tails += diagnostics.partial_tails;
        self.oversized_lines += diagnostics.oversized_lines;
        let observations = diagnostics.format_observations();
        tally(
            &mut self.unmapped_record_types,
            &observations.unmapped_record_types,
        );
        tally(
            &mut self.unmapped_attachment_types,
            &observations.unmapped_attachment_types,
        );
        tally(&mut self.versions, &observations.versions);
    }

    /// The report as Markdown.
    pub fn render(&self) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "## Claude Code format census\n");
        let _ = writeln!(
            out,
            "TracePilot {}. Counts, type names and versions only.\n",
            env!("CARGO_PKG_VERSION")
        );
        let _ = writeln!(
            out,
            "- Sessions: {} ({} unreadable)",
            self.sessions, self.unreadable_sessions
        );
        let _ = writeln!(
            out,
            "- Skipped lines: {} malformed, {} oversized, {} partial last lines",
            self.malformed_lines, self.oversized_lines, self.partial_tails
        );
        let mut versions: Vec<_> = self.versions.iter().collect();
        versions.sort_by(|a, b| version_order(a.0, b.0));
        for (title, column, rows) in [
            (
                "Unmapped record types",
                "Type",
                self.unmapped_record_types.iter().collect(),
            ),
            (
                "Unmapped attachment types",
                "Type",
                self.unmapped_attachment_types.iter().collect(),
            ),
            ("Claude Code versions", "Version", versions),
        ] {
            table(&mut out, title, column, &rows);
        }
        out
    }
}

fn tally(into: &mut BTreeMap<String, Tally>, counts: &BTreeMap<String, usize>) {
    for (name, records) in counts {
        let entry = into.entry(name.clone()).or_default();
        entry.sessions += 1;
        entry.records += records;
    }
}

fn table(out: &mut String, title: &str, column: &str, rows: &[(&String, &Tally)]) {
    let _ = writeln!(out, "\n### {title}\n");
    if rows.is_empty() {
        let _ = writeln!(out, "None.");
        return;
    }
    let _ = writeln!(out, "| {column} | Sessions | Records |");
    let _ = writeln!(out, "| --- | ---: | ---: |");
    for (name, tally) in rows {
        let _ = writeln!(out, "| {name} | {} | {} |", tally.sessions, tally.records);
    }
}
