//! Empirical spike: run the export pipeline against a real session directory
//! and validate each section/toggle/format produces the expected output.
//!
//! Usage:
//!   cargo run --example spike_real_session -- <SESSION_DIR>
//!
//! e.g.:
//!   cargo run --example spike_real_session -- "C:\Users\mattt\.copilot\session-state\129abc86-d548-4e57-a870-77ff9af27e2d"

use std::collections::HashSet;

use tracepilot_export::{
    document::SectionId,
    export_session,
    options::{ContentDetailOptions, ExportFormat, ExportOptions, OutputTarget, RedactionOptions},
    preview_export,
};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let session_dir = if args.len() > 1 {
        std::path::PathBuf::from(&args[1])
    } else {
        // Default: use the richest known session
        std::path::PathBuf::from(
            r"C:\Users\mattt\.copilot\session-state\129abc86-d548-4e57-a870-77ff9af27e2d",
        )
    };

    println!("=== TracePilot Export Spike ===");
    println!("Session: {}", session_dir.display());
    println!();

    if !session_dir.exists() {
        eprintln!("Session directory not found: {}", session_dir.display());
        std::process::exit(1);
    }

    // (name, passed, detail)
    let mut results: Vec<(String, bool, String)> = Vec::new();

    // ── 1. JSON: Full Export ───────────────────────────────────────────
    section("1. JSON Full Export (all sections)");
    let opts = ExportOptions::all(ExportFormat::Json);
    match export_session(&session_dir, &opts) {
        Ok(files) => {
            let archive_bytes = &files[0].content;
            let archive: tracepilot_export::document::SessionArchive =
                serde_json::from_slice(archive_bytes).expect("valid JSON");
            let session = &archive.sessions[0];

            let info = format!(
                "{}KB, {} available_sections",
                archive_bytes.len() / 1024,
                session.available_sections.len(),
            );
            println!("  OK — {info}");
            results.push(("JSON full export".into(), true, info));

            // Print what each section contains
            print_section("conversation", session.conversation.as_ref().map(|c| c.len()));
            print_section("events", session.events.as_ref().map(|e| e.len()));
            print_section("todos", session.todos.as_ref().map(|t| t.items.len()));
            print_section("plan", session.plan.as_ref().map(|_| 1));
            print_section("checkpoints", session.checkpoints.as_ref().map(|c| c.len()));
            print_section("metrics", session.shutdown_metrics.as_ref().map(|_| 1));
            print_section("incidents", session.incidents.as_ref().map(|i| i.len()));
            print_section("health", session.health.as_ref().map(|_| 1));
            print_section("rewind_snapshots", session.rewind_snapshots.as_ref().map(|r| r.snapshots.len()));
            print_section("custom_tables", session.custom_tables.as_ref().map(|t| t.len()));
            print_section("parse_diagnostics", session.parse_diagnostics.as_ref().map(|_| 1));
        }
        Err(e) => {
            let msg = format!("FAIL — {e}");
            println!("  {msg}");
            results.push(("JSON full export".into(), false, msg));
        }
    }

    // ── 2. Markdown: Full Export ──────────────────────────────────────
    section("2. Markdown Full Export");
    let opts = ExportOptions::all(ExportFormat::Markdown);
    match export_session(&session_dir, &opts) {
        Ok(files) => {
            let text = files[0].as_text().unwrap_or("");
            let lines = text.lines().count();
            let has_header = text.contains("# Session:");
            let has_conv = text.contains("## Conversation");
            let has_plan = text.contains("## Plan");
            let has_metrics = text.contains("## Metrics") || text.contains("## Shutdown Metrics");
            let has_tools = text.contains("**Tool Calls**") || text.contains("### Tool:");
            let info = format!(
                "{lines} lines | header={has_header} conv={has_conv} plan={has_plan} metrics={has_metrics} tools={has_tools}"
            );
            println!("  {info}");
            let pass = has_header && has_conv;
            results.push(("Markdown full export".into(), pass, info));
        }
        Err(e) => {
            let msg = format!("FAIL — {e}");
            println!("  {msg}");
            results.push(("Markdown full export".into(), false, msg));
        }
    }

    // ── 3. CSV: Full Export ───────────────────────────────────────────
    section("3. CSV Full Export");
    let opts = ExportOptions::all(ExportFormat::Csv);
    match export_session(&session_dir, &opts) {
        Ok(files) => {
            let filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();
            for f in &files {
                let text = f.as_text().unwrap_or("");
                println!("  {} — {} lines", f.filename, text.lines().count());
            }
            let info = format!("{} CSV files: {:?}", files.len(), filenames);
            results.push(("CSV full export".into(), files.len() >= 2, info));
        }
        Err(e) => {
            let msg = format!("FAIL — {e}");
            println!("  {msg}");
            results.push(("CSV full export".into(), false, msg));
        }
    }

    // ── 4. Section Filtering — conversation only ──────────────────────
    section("4. Section Filtering — conversation only");
    {
        let opts = ExportOptions {
            format: ExportFormat::Json,
            sections: HashSet::from([SectionId::Conversation]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions::default(),
        };
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let archive: tracepilot_export::document::SessionArchive =
                    serde_json::from_slice(&files[0].content).unwrap();
                let session = &archive.sessions[0];
                let conv_ok = session.conversation.is_some();
                let events_excluded = session.events.is_none();
                let plan_excluded = session.plan.is_none();
                let todos_excluded = session.todos.is_none();
                let info = format!(
                    "conv={conv_ok} events_excluded={events_excluded} plan_excluded={plan_excluded} todos_excluded={todos_excluded}"
                );
                println!("  {info}");
                results.push(("Section filter: conv only".into(), conv_ok && events_excluded && plan_excluded && todos_excluded, info));
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("Section filter: conv only".into(), false, msg));
            }
        }
    }

    // ── 5. Section Filtering — plan + todos ──────────────────────────
    section("5. Section Filtering — plan + todos only");
    {
        let opts = ExportOptions {
            format: ExportFormat::Json,
            sections: HashSet::from([SectionId::Plan, SectionId::Todos]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions::default(),
        };
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let archive: tracepilot_export::document::SessionArchive =
                    serde_json::from_slice(&files[0].content).unwrap();
                let session = &archive.sessions[0];
                let plan_present = session.plan.is_some();
                let conv_excluded = session.conversation.is_none();
                let events_excluded = session.events.is_none();
                let todo_count = session.todos.as_ref().map(|t| t.items.len()).unwrap_or(0);
                let info = format!(
                    "plan={plan_present} todos={todo_count} conv_excluded={conv_excluded} events_excluded={events_excluded}"
                );
                println!("  {info}");
                results.push(("Section filter: plan+todos".into(), plan_present && conv_excluded, info));
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("Section filter: plan+todos".into(), false, msg));
            }
        }
    }

    // ── 6. Content Detail: includeToolDetails = false ─────────────────
    section("6. Content Detail: includeToolDetails = false");
    {
        let opts = ExportOptions {
            format: ExportFormat::Json,
            sections: HashSet::from([SectionId::Conversation]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions {
                include_subagent_internals: true,
                include_tool_details: false,
                include_full_tool_results: false,
            },
            redaction: RedactionOptions::default(),
        };
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let archive: tracepilot_export::document::SessionArchive =
                    serde_json::from_slice(&files[0].content).unwrap();
                let session = &archive.sessions[0];
                if let Some(conv) = &session.conversation {
                    let all_stripped = conv.iter().all(|turn| {
                        turn.tool_calls.iter().all(|tc| tc.arguments.is_none() && tc.result_content.is_none())
                    });
                    let summaries_kept = conv.iter().any(|turn| {
                        turn.tool_calls.iter().any(|tc| tc.intention_summary.is_some() || tc.args_summary.is_some())
                    });
                    let info = format!("all_args_stripped={all_stripped} summaries_kept={summaries_kept}");
                    println!("  {info}");
                    results.push(("includeToolDetails=false".into(), all_stripped, info));
                } else {
                    let info = "SKIP — no conversation data".to_string();
                    println!("  {info}");
                    results.push(("includeToolDetails=false".into(), false, info));
                }
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("includeToolDetails=false".into(), false, msg));
            }
        }
    }

    // ── 7. Content Detail: includeSubagentInternals = false ──────────
    section("7. Content Detail: includeSubagentInternals = false");
    {
        let opts = ExportOptions {
            format: ExportFormat::Json,
            sections: HashSet::from([SectionId::Conversation]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions {
                include_subagent_internals: false,
                include_tool_details: true,
                include_full_tool_results: false,
            },
            redaction: RedactionOptions::default(),
        };
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let archive: tracepilot_export::document::SessionArchive =
                    serde_json::from_slice(&files[0].content).unwrap();
                let session = &archive.sessions[0];
                if let Some(conv) = &session.conversation {
                    let total_turns = conv.len();
                    let total_tools = conv.iter().map(|t| t.tool_calls.len()).sum::<usize>();
                    let subagent_child_count = conv
                        .iter()
                        .flat_map(|t| &t.tool_calls)
                        .filter(|tc| tc.parent_tool_call_id.is_some())
                        .count();
                    let info = format!(
                        "turns={total_turns} tool_calls={total_tools} subagent_children_remaining={subagent_child_count}"
                    );
                    println!("  {info}");
                    results.push(("includeSubagentInternals=false".into(), subagent_child_count == 0, info));
                } else {
                    let info = "SKIP — no conversation data".to_string();
                    println!("  {info}");
                    results.push(("includeSubagentInternals=false".into(), false, info));
                }
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("includeSubagentInternals=false".into(), false, msg));
            }
        }
    }

    // ── 8. Content Detail: includeFullToolResults ─────────────────────
    section("8. Content Detail: includeFullToolResults = true vs false");
    {
        let make_opts = |full: bool| ExportOptions {
            format: ExportFormat::Json,
            sections: HashSet::from([SectionId::Conversation]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions {
                include_subagent_internals: true,
                include_tool_details: true,
                include_full_tool_results: full,
            },
            redaction: RedactionOptions::default(),
        };
        let size_truncated = export_session(&session_dir, &make_opts(false))
            .map(|f| f[0].content.len())
            .unwrap_or(0);
        let size_full = export_session(&session_dir, &make_opts(true))
            .map(|f| f[0].content.len())
            .unwrap_or(0);
        let diff_kb = (size_full as i64 - size_truncated as i64) / 1024;
        let info = format!(
            "truncated={}KB full={}KB diff={:+}KB",
            size_truncated / 1024,
            size_full / 1024,
            diff_kb
        );
        println!("  {info}");
        // Full should be >= truncated; if diff > 0, truncation is active
        results.push(("includeFullToolResults: size comparison".into(), size_full >= size_truncated, info));
    }

    // ── 9. Redaction: anonymizePaths ──────────────────────────────────
    section("9. Redaction: anonymizePaths = true");
    {
        // Use JSON format for path detection: in JSON output, backslashes in
        // string values are serialized as `\\` (two chars), whereas JSON escape
        // sequences like `\n` appear as `\n` (one backslash + n).  Checking for
        // the double-backslash pattern `[A-Za-z]:\\\\[A-Za-z]` reliably detects
        // unredacted Windows paths without false-positives from `\n` sequences.
        let opts = ExportOptions {
            format: ExportFormat::Json,
            sections: HashSet::from([SectionId::Conversation, SectionId::Plan]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions {
                anonymize_paths: true,
                strip_secrets: false,
                strip_pii: false,
            },
        };
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let text = files[0].as_text().unwrap_or("");
                let has_redacted = text.contains("<REDACTED_PATH>");
                // In JSON output, real Windows paths have double-escaped backslashes
                // (`C:\\\\Users\\\\matt`), while `\n`/`\t` stay as single-backslash
                // escapes.  Requiring `\\\\[A-Za-z0-9]` eliminates all false positives.
                let double_bs_path = regex::Regex::new(
                    r#"[A-Za-z]:\\\\[A-Za-z0-9]"#
                ).unwrap();
                let raw_paths_remain = double_bs_path.is_match(text);
                let info = format!(
                    "<REDACTED_PATH>_present={has_redacted} raw_win_paths_remain={raw_paths_remain}"
                );
                println!("  {info}");
                if raw_paths_remain {
                    println!("  ⚠ Remaining Windows paths (with 120-char context):");
                    let lines: Vec<&str> = text.lines().collect();
                    let mut shown = 0;
                    for (i, line) in lines.iter().enumerate() {
                        if double_bs_path.is_match(line) && shown < 5 {
                            if let Some(m) = double_bs_path.find(line) {
                                let start = m.start().saturating_sub(30);
                                let end = (m.end() + 90).min(line.len());
                                println!("    Line {}: ...{}...", i + 1, &line[start..end]);
                            }
                            shown += 1;
                        }
                    }
                }
                results.push(("anonymizePaths=true".into(), has_redacted && !raw_paths_remain, info));
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("anonymizePaths=true".into(), false, msg));
            }
        }
    }

    // ── 10. Redaction: stripPii = true ────────────────────────────────
    section("10. Redaction: stripPii = true");
    {
        let opts = ExportOptions {
            format: ExportFormat::Json,
            sections: HashSet::from([SectionId::Conversation, SectionId::Plan]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions {
                anonymize_paths: false,
                strip_secrets: false,
                strip_pii: true,
            },
        };
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let text = files[0].as_text().unwrap_or("");
                let info = format!("OK — {}KB output", text.len() / 1024);
                println!("  {info}");
                results.push(("stripPii=true".into(), true, info));
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("stripPii=true".into(), false, msg));
            }
        }
    }

    // ── 11. Minimal (metadata only) ───────────────────────────────────
    section("11. Minimal export (no sections)");
    {
        let opts = ExportOptions::minimal(ExportFormat::Json);
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let archive: tracepilot_export::document::SessionArchive =
                    serde_json::from_slice(&files[0].content).unwrap();
                let session = &archive.sessions[0];
                let id = &session.metadata.id;
                let available_count = session.available_sections.len();
                let info = format!(
                    "id={id} available_sections={available_count} conv={:?} events={:?}",
                    session.conversation.as_ref().map(|c| c.len()),
                    session.events.as_ref().map(|e| e.len()),
                );
                println!("  {info}");
                let pass = available_count == 0
                    && session.conversation.is_none()
                    && session.events.is_none();
                results.push(("Minimal export (metadata only)".into(), pass, info));
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("Minimal export (metadata only)".into(), false, msg));
            }
        }
    }

    // ── 12. Preview Export ────────────────────────────────────────────
    section("12. Preview Export (JSON, 512KB cap)");
    {
        let opts = ExportOptions::all(ExportFormat::Json);
        match preview_export(&session_dir, &opts, Some(512 * 1024)) {
            Ok(content) => {
                let info = format!("OK — preview {}KB (capped at 512KB)", content.len() / 1024);
                println!("  {info}");
                results.push(("Preview export".into(), true, info));
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("Preview export".into(), false, msg));
            }
        }
    }

    // ── 13. Analytics CSV preset ──────────────────────────────────────
    section("13. Analytics CSV preset (metrics + events + health + incidents)");
    {
        let opts = ExportOptions {
            format: ExportFormat::Csv,
            sections: HashSet::from([
                SectionId::Metrics,
                SectionId::Events,
                SectionId::Health,
                SectionId::Incidents,
            ]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions::default(),
        };
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();
                let has_events = filenames.iter().any(|f| f.contains("events"));
                for f in &files {
                    let text = f.as_text().unwrap_or("");
                    println!("  {} — {} lines", f.filename, text.lines().count());
                }
                let info = format!("{} files, has_events_csv={has_events}", files.len());
                results.push(("Analytics CSV preset".into(), has_events, info));
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("Analytics CSV preset".into(), false, msg));
            }
        }
    }

    // ── 14. Markdown plan heading demotion ────────────────────────────
    section("14. Markdown plan heading demotion");
    {
        let opts = ExportOptions {
            format: ExportFormat::Markdown,
            sections: HashSet::from([SectionId::Plan]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions::default(),
        };
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let text = files[0].as_text().unwrap_or("");
                let plan_section_start = text.find("## Plan");
                if let Some(start) = plan_section_start {
                    let plan_content = &text[start..];
                    // BUG CHECK: demoted headings should be `### Heading`, not `## # Heading`
                    let has_correct_sub = plan_content.contains("###");
                    let has_double_hash_with_octothorpe = plan_content.contains("## #");
                    let info = format!(
                        "plan_found=true correct_sub_headings={has_correct_sub} BUG_double_hash_octothorpe={has_double_hash_with_octothorpe}"
                    );
                    println!("  {info}");
                    println!("  First 15 lines of plan section:");
                    for line in plan_content.lines().take(15) {
                        println!("    {line}");
                    }
                    // Pass if no `## #` bug pattern (double-hash + literal octothorpe)
                    results.push(("Markdown plan heading demotion".into(), !has_double_hash_with_octothorpe, info));
                } else {
                    let info = "plan section not found in markdown output".to_string();
                    println!("  {info}");
                    results.push(("Markdown plan heading demotion".into(), false, info));
                }
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("Markdown plan heading demotion".into(), false, msg));
            }
        }
    }

    // ── 15. Markdown conversation structure ───────────────────────────
    section("15. Markdown conversation structure (spot check)");
    {
        let opts = ExportOptions {
            format: ExportFormat::Markdown,
            sections: HashSet::from([SectionId::Conversation]),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions::default(),
        };
        match export_session(&session_dir, &opts) {
            Ok(files) => {
                let text = files[0].as_text().unwrap_or("");
                let turn_count = text.matches("### Turn").count();
                let user_count = text.matches("**User:**").count();
                let assistant_count = text.matches("**Assistant:**").count();
                let info = format!(
                    "turns={turn_count} user_msgs={user_count} assistant_msgs={assistant_count}"
                );
                println!("  {info}");
                println!("  First 20 lines of conversation section:");
                let conv_start = text.find("## Conversation").unwrap_or(0);
                for line in text[conv_start..].lines().take(20) {
                    println!("    {line}");
                }
                results.push(("Markdown conversation structure".into(), turn_count > 0, info));
            }
            Err(e) => {
                let msg = format!("FAIL — {e}");
                println!("  {msg}");
                results.push(("Markdown conversation structure".into(), false, msg));
            }
        }
    }

    // ── Summary ───────────────────────────────────────────────────────
    println!();
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║              SPIKE RESULTS SUMMARY                       ║");
    println!("╠══════════════════════════════════════════════════════════╣");
    let total = results.len();
    let passed = results.iter().filter(|(_, ok, _)| *ok).count();
    for (name, ok, detail) in &results {
        let icon = if *ok { "✅" } else { "❌" };
        let truncated_name = &name[..name.len().min(44)];
        let truncated_detail = &detail[..detail.len().min(50)];
        println!("║ {icon} {truncated_name:<44} ║");
        if !ok {
            println!("║   → {truncated_detail:<52} ║");
        }
    }
    println!("╠══════════════════════════════════════════════════════════╣");
    println!("║  {passed}/{total} checks passed{:<47}║", "");
    println!("╚══════════════════════════════════════════════════════════╝");

    if passed < total {
        std::process::exit(1);
    }
}

fn section(title: &str) {
    println!("\n── {title} ──");
}

fn print_section(name: &str, count: Option<usize>) {
    let status = match count {
        Some(n) if n > 0 => format!("✓ present ({n} items)"),
        Some(_) => "✓ present (empty)".to_string(),
        None => "○ not present (no data or skipped)".to_string(),
    };
    println!("    {name:<20}: {status}");
}
