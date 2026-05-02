use crate::document::{
    CheckpointExport, CustomTableExport, ParseDiagnosticsExport, PortableSession,
    PortableSessionMetadata, SessionArchive,
};
use crate::options::RedactionOptions;
use tracepilot_core::models::conversation::ConversationTurn;

use super::patterns::RedactionPattern;
use super::policy::collect_active_patterns;
use super::primitives::{redact_json_value, redact_opt_string, redact_string};
use super::stats::RedactionStats;

/// Apply redaction to every session in the archive according to `options`.
///
/// When all redaction flags are `false` (the default), this is a no-op.
/// Returns statistics about what was modified.
pub fn apply_redaction(archive: &mut SessionArchive, options: &RedactionOptions) -> RedactionStats {
    if !options.has_any() {
        return RedactionStats::default();
    }

    let active_patterns = collect_active_patterns(options);
    let mut stats = RedactionStats::default();

    for session in &mut archive.sessions {
        redact_session(session, &active_patterns, &mut stats);
    }

    archive.export_options.redaction_applied = true;

    stats
}

/// Redact all string-bearing fields in a single session.
fn redact_session(
    session: &mut PortableSession,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    redact_metadata(&mut session.metadata, patterns, stats);

    if let Some(conversation) = &mut session.conversation {
        for turn in conversation.iter_mut() {
            redact_turn(turn, patterns, stats);
        }
    }

    if let Some(events) = &mut session.events {
        for event in events.iter_mut() {
            redact_json_value(&mut event.data, patterns, stats);
        }
    }

    if let Some(todos) = &mut session.todos {
        for item in &mut todos.items {
            redact_opt_string(&mut item.description, patterns, stats);
            redact_string(&mut item.title, patterns, stats);
        }
    }

    if let Some(plan) = &mut session.plan {
        redact_string(plan, patterns, stats);
    }

    if let Some(checkpoints) = &mut session.checkpoints {
        redact_checkpoints(checkpoints, patterns, stats);
    }

    if let Some(rewind) = &mut session.rewind_snapshots {
        for snap in &mut rewind.snapshots {
            redact_opt_string(&mut snap.user_message, patterns, stats);
            redact_opt_string(&mut snap.git_branch, patterns, stats);
        }
    }

    if let Some(metrics) = &mut session.shutdown_metrics
        && let Some(changes) = &mut metrics.code_changes
        && let Some(files) = &mut changes.files_modified
    {
        for f in files.iter_mut() {
            redact_string(f, patterns, stats);
        }
    }

    if let Some(tables) = &mut session.custom_tables {
        redact_custom_tables(tables, patterns, stats);
    }

    if let Some(incidents) = &mut session.incidents {
        for incident in incidents.iter_mut() {
            redact_string(&mut incident.summary, patterns, stats);
        }
    }

    if let Some(diag) = &mut session.parse_diagnostics {
        redact_diagnostics(diag, patterns, stats);
    }

    if let Some(extensions) = &mut session.extensions {
        redact_json_value(extensions, patterns, stats);
    }
}

/// Redact metadata fields that commonly contain paths and identifiers.
fn redact_metadata(
    meta: &mut PortableSessionMetadata,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    redact_opt_string(&mut meta.cwd, patterns, stats);
    redact_opt_string(&mut meta.git_root, patterns, stats);
    redact_opt_string(&mut meta.repository, patterns, stats);
    redact_opt_string(&mut meta.branch, patterns, stats);
    redact_opt_string(&mut meta.summary, patterns, stats);

    if let Some(lineage) = &mut meta.lineage {
        for entry in lineage.iter_mut() {
            redact_opt_string(&mut entry.system_info, patterns, stats);
        }
    }
}

/// Redact all text content within a conversation turn.
fn redact_turn(
    turn: &mut ConversationTurn,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    redact_opt_string(&mut turn.user_message, patterns, stats);
    redact_opt_string(&mut turn.transformed_user_message, patterns, stats);

    for msg in &mut turn.assistant_messages {
        redact_string(&mut msg.content, patterns, stats);
    }
    for msg in &mut turn.reasoning_texts {
        redact_string(&mut msg.content, patterns, stats);
    }

    for tc in &mut turn.tool_calls {
        redact_opt_string(&mut tc.result_content, patterns, stats);
        redact_opt_string(&mut tc.args_summary, patterns, stats);
        redact_opt_string(&mut tc.intention_summary, patterns, stats);
        redact_opt_string(&mut tc.error, patterns, stats);
        if let Some(ref mut args) = tc.arguments {
            redact_json_value(args, patterns, stats);
        }
    }

    for event in &mut turn.session_events {
        redact_string(&mut event.summary, patterns, stats);
    }

    for msg in &mut turn.system_messages {
        redact_string(msg, patterns, stats);
    }

    if let Some(attachments) = &mut turn.attachments {
        for attachment in attachments.iter_mut() {
            redact_json_value(attachment, patterns, stats);
        }
    }
}

/// Redact checkpoint titles, filenames, and content.
fn redact_checkpoints(
    checkpoints: &mut [CheckpointExport],
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    for cp in checkpoints.iter_mut() {
        redact_string(&mut cp.title, patterns, stats);
        redact_string(&mut cp.filename, patterns, stats);
        if let Some(content) = &mut cp.content {
            redact_string(content, patterns, stats);
        }
    }
}

/// Redact values in custom table names, columns, and row data.
fn redact_custom_tables(
    tables: &mut [CustomTableExport],
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    for table in tables.iter_mut() {
        redact_string(&mut table.name, patterns, stats);
        for col in &mut table.columns {
            redact_string(col, patterns, stats);
        }
        for row in &mut table.rows {
            for value in row.values_mut() {
                redact_json_value(value, patterns, stats);
            }
        }
    }
}

/// Redact parse diagnostics warning messages.
fn redact_diagnostics(
    diag: &mut ParseDiagnosticsExport,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    use crate::document::EventParseWarning;
    if let Some(warnings) = &mut diag.warnings {
        for warning in warnings.iter_mut() {
            match warning {
                EventParseWarning::DeserializationFailed { error, .. } => {
                    redact_string(error, patterns, stats);
                }
                EventParseWarning::UnknownEventType { .. } => {}
            }
        }
    }
}
