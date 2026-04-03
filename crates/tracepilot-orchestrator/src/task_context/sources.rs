//! Per-source context data gathering.
//!
//! Each function extracts data from a specific source type (session export,
//! analytics, todos, etc.) and returns it as formatted markdown text.

use crate::error::Result;
use crate::presets::types::{ContextSource, ContextSourceType};
use std::collections::HashSet;
use std::path::Path;

/// Assemble context data from a single source definition.
///
/// `data_dir` is the session-state root (e.g. `~/.copilot/session-state`).
/// `params` holds runtime values like `session_id`.
pub fn assemble_source(
    source: &ContextSource,
    params: &serde_json::Value,
    data_dir: &Path,
) -> Result<String> {
    match source.source_type {
        ContextSourceType::SessionExport => assemble_session_export(source, params, data_dir),
        ContextSourceType::SessionAnalytics => assemble_session_analytics(params, data_dir),
        ContextSourceType::SessionHealth => assemble_session_health(params),
        ContextSourceType::SessionTodos => assemble_session_todos(params, data_dir),
        ContextSourceType::RecentSessions => assemble_recent_sessions(source, data_dir),
    }
}

/// Default sections for session export context — optimised for AI summarisation.
/// Includes the high-value sections while skipping raw events and checkpoints
/// which are verbose but low-signal for summary/review tasks.
const DEFAULT_EXPORT_SECTIONS: &[tracepilot_export::SectionId] = &[
    tracepilot_export::SectionId::Conversation,
    tracepilot_export::SectionId::Plan,
    tracepilot_export::SectionId::Todos,
    tracepilot_export::SectionId::Metrics,
    tracepilot_export::SectionId::Incidents,
    tracepilot_export::SectionId::Health,
];

/// Session export: uses the `tracepilot-export` crate for rich, structured
/// markdown output.  Selects high-value sections (conversation, plan, todos,
/// metrics, incidents, health) while omitting verbose raw events and checkpoints.
///
/// Configurable via `source.config`:
/// - `sections` — array of section names to include (overrides defaults)
/// - `max_bytes` — optional byte limit passed to `preview_export`
fn assemble_session_export(
    source: &ContextSource,
    params: &serde_json::Value,
    data_dir: &Path,
) -> Result<String> {
    let session_id = require_session_id(params)?;
    let session_path =
        tracepilot_core::session::discovery::resolve_session_path_in(session_id, data_dir)?;

    // ── Build section set ──────────────────────────────────────────────
    let sections: HashSet<tracepilot_export::SectionId> =
        if let Some(custom) = source.config.get("sections").and_then(|v| v.as_array()) {
            custom
                .iter()
                .filter_map(|v| v.as_str())
                .filter_map(parse_section_id)
                .collect()
        } else {
            DEFAULT_EXPORT_SECTIONS.iter().copied().collect()
        };

    // ── Build export options ───────────────────────────────────────────
    let options = tracepilot_export::ExportOptions {
        format: tracepilot_export::ExportFormat::Markdown,
        sections,
        output: tracepilot_export::OutputTarget::String,
        content_detail: tracepilot_export::ContentDetailOptions::default(),
        redaction: tracepilot_export::RedactionOptions::default(),
    };

    let max_bytes = source
        .config
        .get("max_bytes")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);

    // ── Export ──────────────────────────────────────────────────────────
    let markdown = tracepilot_export::preview_export(&session_path, &options, max_bytes)
        .map_err(|e| {
            tracing::warn!(
                session = %session_id,
                error = %e,
                "Export crate failed, falling back to basic summary"
            );
            e
        });

    match markdown {
        Ok(content) if !content.is_empty() => Ok(content),
        _ => assemble_session_export_fallback(source, params, data_dir),
    }
}

/// Fallback: basic summary from session metadata when the export crate fails
/// (e.g. corrupt session data). Produces a minimal markdown overview.
fn assemble_session_export_fallback(
    source: &ContextSource,
    params: &serde_json::Value,
    data_dir: &Path,
) -> Result<String> {
    let session_id = require_session_id(params)?;
    let session_path =
        tracepilot_core::session::discovery::resolve_session_path_in(session_id, data_dir)?;

    let load_result = tracepilot_core::summary::load_session_summary_with_events(&session_path)?;
    let summary = &load_result.summary;

    let mut lines = Vec::new();
    lines.push(format!("### Session: {}", summary.id));
    if let Some(count) = summary.event_count {
        lines.push(format!("- Events: {}", count));
    }
    if let Some(count) = summary.turn_count {
        lines.push(format!("- Turns: {}", count));
    }
    if let Some(repo) = &summary.repository {
        lines.push(format!("- Repository: {}", repo));
    }
    if let Some(metrics) = &summary.shutdown_metrics {
        if let Some(model) = &metrics.current_model {
            lines.push(format!("- Model: {}", model));
        }
    }
    lines.push(String::new());

    if let Some(typed_events) = &load_result.typed_events {
        let max_events = source
            .config
            .get("max_events")
            .and_then(|v| v.as_u64())
            .unwrap_or(500) as usize;

        let turns = tracepilot_core::turns::reconstruct_turns(typed_events);
        for turn in turns.iter().take(max_events) {
            if let Some(user_msg) = &turn.user_message {
                let truncated = truncate(user_msg, 2000);
                lines.push(format!("**User**: {}", truncated));
                lines.push(String::new());
            }
            for msg in &turn.assistant_messages {
                let truncated = truncate(&msg.content, 2000);
                lines.push(format!("**Assistant**: {}", truncated));
                lines.push(String::new());
            }
        }
    }

    Ok(lines.join("\n"))
}

/// Parse a section name string into a `SectionId`.
fn parse_section_id(name: &str) -> Option<tracepilot_export::SectionId> {
    match name.to_lowercase().as_str() {
        "conversation" => Some(tracepilot_export::SectionId::Conversation),
        "events" => Some(tracepilot_export::SectionId::Events),
        "todos" => Some(tracepilot_export::SectionId::Todos),
        "plan" => Some(tracepilot_export::SectionId::Plan),
        "checkpoints" => Some(tracepilot_export::SectionId::Checkpoints),
        "metrics" => Some(tracepilot_export::SectionId::Metrics),
        "incidents" => Some(tracepilot_export::SectionId::Incidents),
        "health" => Some(tracepilot_export::SectionId::Health),
        _ => {
            tracing::warn!(section = %name, "Unknown section name in context source config");
            None
        }
    }
}

/// Session analytics: produces aggregate stats from parsed session data.
fn assemble_session_analytics(
    params: &serde_json::Value,
    data_dir: &Path,
) -> Result<String> {
    let session_id = require_session_id(params)?;
    let session_path =
        tracepilot_core::session::discovery::resolve_session_path_in(session_id, data_dir)?;

    let summary = tracepilot_core::summary::load_session_summary(&session_path)?;

    let mut lines = Vec::new();
    lines.push("### Analytics".to_string());
    if let Some(count) = summary.event_count {
        lines.push(format!("- Total events: {}", count));
    }
    if let Some(count) = summary.turn_count {
        lines.push(format!("- Total turns: {}", count));
    }
    if let Some(repo) = &summary.repository {
        lines.push(format!("- Repository: {}", repo));
    }
    if let Some(metrics) = &summary.shutdown_metrics {
        if let Some(model) = &metrics.current_model {
            lines.push(format!("- Model: {}", model));
        }
    }
    if let Some(start) = &summary.created_at {
        lines.push(format!("- Started: {}", start));
    }
    if let Some(end) = &summary.updated_at {
        lines.push(format!("- Updated: {}", end));
    }
    Ok(lines.join("\n"))
}

/// Session health: placeholder for health scoring data.
fn assemble_session_health(
    params: &serde_json::Value,
) -> Result<String> {
    let session_id = params
        .get("session_id")
        .or_else(|| params.get("session_export"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    Ok(format!(
        "### Health\nHealth scoring data for session {} is not yet available.\n",
        session_id
    ))
}

/// Session todos: reads the plan.md file from a session.
fn assemble_session_todos(
    params: &serde_json::Value,
    data_dir: &Path,
) -> Result<String> {
    let session_id = require_session_id(params)?;
    let session_path =
        tracepilot_core::session::discovery::resolve_session_path_in(session_id, data_dir)?;

    let plan_path = session_path.join("plan.md");
    if plan_path.exists() {
        let content = std::fs::read_to_string(&plan_path)?;
        Ok(format!("### Plan / Todos\n\n{}", content))
    } else {
        Ok("### Plan / Todos\n\nNo plan.md found for this session.\n".to_string())
    }
}

/// Recent sessions: lists a summary of recent sessions.
fn assemble_recent_sessions(
    source: &ContextSource,
    data_dir: &Path,
) -> Result<String> {
    let max_sessions = source
        .config
        .get("max_sessions")
        .and_then(|v| v.as_u64())
        .unwrap_or(10) as usize;

    let discovered = tracepilot_core::session::discovery::discover_sessions(data_dir)?;

    let mut lines = vec!["### Recent Sessions".to_string()];
    for session in discovered.iter().take(max_sessions) {
        match tracepilot_core::summary::load_session_summary(&session.path) {
            Ok(summary) => {
                let repo = summary.repository.as_deref().unwrap_or("unknown");
                let turns = summary.turn_count.unwrap_or(0);
                lines.push(format!(
                    "- **{}** — repo: {}, turns: {}",
                    summary.id, repo, turns
                ));
            }
            Err(_) => continue,
        }
    }

    Ok(lines.join("\n"))
}

/// Extract required session_id from params.
/// Checks both `session_id` and `session_export` keys for compatibility
/// with different preset variable naming conventions.
fn require_session_id(params: &serde_json::Value) -> Result<&str> {
    params
        .get("session_id")
        .or_else(|| params.get("session_export"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            crate::error::OrchestratorError::Task(
                "session_id or session_export required in input_params".into(),
            )
        })
}

/// Truncate a string to max_len characters, appending "..." if truncated.
/// Uses char boundaries to avoid panicking on multi-byte UTF-8.
fn truncate(s: &str, max_len: usize) -> String {
    let char_count = s.chars().count();
    if char_count <= max_len {
        s.to_string()
    } else {
        let end: usize = s.char_indices().nth(max_len).map_or(s.len(), |(i, _)| i);
        format!("{}...", &s[..end])
    }
}

