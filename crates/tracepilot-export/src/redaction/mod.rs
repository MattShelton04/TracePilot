//! Redaction engine — walks a [`SessionArchive`] and applies pattern-based
//! scrubbing to sensitive fields.
//!
//! # Architecture
//!
//! The engine applies three optional categories of redaction:
//! - **Paths:** Anonymize filesystem paths (Windows, Unix home, abs paths)
//! - **Secrets:** Strip API keys, tokens, passwords, env var assignments
//! - **PII:** Remove email addresses and IP addresses
//!
//! Each category can be independently toggled via [`RedactionOptions`].
//! The engine traverses all string-bearing fields in the archive, including
//! recursive JSON values in raw events, tool arguments, and custom tables.

pub mod patterns;

use crate::document::{
    CustomTableExport, PortableSession, PortableSessionMetadata, SessionArchive,
};
use crate::options::RedactionOptions;
use patterns::{RedactionPattern, PATH_PATTERNS, PII_PATTERNS, SECRET_PATTERNS};
use tracepilot_core::models::conversation::ConversationTurn;

/// Statistics about what the redaction engine modified.
#[derive(Debug, Clone, Default)]
pub struct RedactionStats {
    /// Number of string fields that were modified.
    pub fields_redacted: usize,
    /// Number of individual pattern matches replaced.
    pub total_replacements: usize,
}

/// Apply redaction to every session in the archive according to `options`.
///
/// When all redaction flags are `false` (the default), this is a no-op.
/// Returns statistics about what was modified.
pub fn apply_redaction(
    archive: &mut SessionArchive,
    options: &RedactionOptions,
) -> RedactionStats {
    if !options.has_any() {
        return RedactionStats::default();
    }

    let active_patterns = collect_active_patterns(options);
    let mut stats = RedactionStats::default();

    for session in &mut archive.sessions {
        redact_session(session, &active_patterns, &mut stats);
    }

    // Mark the archive as redacted
    archive.export_options.redaction_applied = true;

    stats
}

/// Collect all active pattern lists based on the user's redaction options.
fn collect_active_patterns(options: &RedactionOptions) -> Vec<&'static RedactionPattern> {
    let mut patterns = Vec::new();
    if options.anonymize_paths {
        patterns.extend(PATH_PATTERNS.iter());
    }
    if options.strip_secrets {
        patterns.extend(SECRET_PATTERNS.iter());
    }
    if options.strip_pii {
        patterns.extend(PII_PATTERNS.iter());
    }
    patterns
}

/// Redact all string-bearing fields in a single session.
fn redact_session(
    session: &mut PortableSession,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    redact_metadata(&mut session.metadata, patterns, stats);

    if let Some(ref mut conversation) = session.conversation {
        for turn in conversation.iter_mut() {
            redact_turn(turn, patterns, stats);
        }
    }

    if let Some(ref mut events) = session.events {
        for event in events.iter_mut() {
            redact_json_value(&mut event.data, patterns, stats);
        }
    }

    if let Some(ref mut todos) = session.todos {
        for item in &mut todos.items {
            redact_opt_string(&mut item.description, patterns, stats);
            redact_string(&mut item.title, patterns, stats);
        }
    }

    if let Some(ref mut plan) = session.plan {
        redact_string(plan, patterns, stats);
    }

    if let Some(ref mut checkpoints) = session.checkpoints {
        for cp in checkpoints.iter_mut() {
            if let Some(ref mut content) = cp.content {
                redact_string(content, patterns, stats);
            }
        }
    }

    if let Some(ref mut tables) = session.custom_tables {
        redact_custom_tables(tables, patterns, stats);
    }

    if let Some(ref mut incidents) = session.incidents {
        for incident in incidents.iter_mut() {
            redact_string(&mut incident.summary, patterns, stats);
        }
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
}

/// Redact values in custom table rows.
fn redact_custom_tables(
    tables: &mut [CustomTableExport],
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    for table in tables.iter_mut() {
        for row in &mut table.rows {
            for value in row.values_mut() {
                redact_json_value(value, patterns, stats);
            }
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Redact a `String` field in place.
fn redact_string(s: &mut String, patterns: &[&RedactionPattern], stats: &mut RedactionStats) {
    if let Some(redacted) = apply_patterns(s, patterns) {
        *s = redacted;
        stats.fields_redacted += 1;
        stats.total_replacements += 1;
    }
}

/// Redact an `Option<String>` field in place.
fn redact_opt_string(
    s: &mut Option<String>,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    if let Some(value) = s {
        redact_string(value, patterns, stats);
    }
}

/// Recursively redact string values within a `serde_json::Value`.
fn redact_json_value(
    value: &mut serde_json::Value,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    match value {
        serde_json::Value::String(s) => {
            redact_string(s, patterns, stats);
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                redact_json_value(item, patterns, stats);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                redact_json_value(v, patterns, stats);
            }
        }
        _ => {}
    }
}

/// Extend `apply_patterns` to accept a slice of references (not a slice of owned values).
fn apply_patterns(text: &str, patterns: &[&RedactionPattern]) -> Option<String> {
    let mut result = text.to_string();
    let mut changed = false;

    for pattern in patterns {
        let after = pattern.regex.replace_all(&result, pattern.replacement);
        if after != result {
            changed = true;
            result = after.into_owned();
        }
    }

    if changed { Some(result) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{minimal_session, test_archive};
    use tracepilot_core::models::conversation::{AttributedMessage, TurnToolCall};

    fn test_options_all() -> RedactionOptions {
        RedactionOptions {
            anonymize_paths: true,
            strip_secrets: true,
            strip_pii: true,
        }
    }

    fn test_options_paths_only() -> RedactionOptions {
        RedactionOptions {
            anonymize_paths: true,
            strip_secrets: false,
            strip_pii: false,
        }
    }

    #[test]
    fn noop_when_disabled() {
        let mut session = minimal_session();
        session.metadata.cwd = Some(r"C:\Users\alice\project".into());
        let mut archive = test_archive(session);

        let stats = apply_redaction(&mut archive, &RedactionOptions::default());
        assert_eq!(stats.fields_redacted, 0);
        assert!(archive.sessions[0].metadata.cwd.as_ref().unwrap().contains("alice"));
        assert!(!archive.export_options.redaction_applied);
    }

    #[test]
    fn redacts_metadata_paths() {
        let mut session = minimal_session();
        session.metadata.cwd = Some(r"C:\Users\alice\project".into());
        session.metadata.git_root = Some("/home/alice/repos/project".into());
        let mut archive = test_archive(session);

        let stats = apply_redaction(&mut archive, &test_options_paths_only());
        assert!(stats.fields_redacted >= 2);
        assert!(!archive.sessions[0].metadata.cwd.as_ref().unwrap().contains("alice"));
        assert!(!archive.sessions[0].metadata.git_root.as_ref().unwrap().contains("alice"));
        assert!(archive.export_options.redaction_applied);
    }

    #[test]
    fn redacts_conversation_content() {
        let mut session = minimal_session();
        session.conversation = Some(vec![ConversationTurn {
            turn_index: 0,
            event_index: None,
            turn_id: None,
            interaction_id: None,
            user_message: Some("Read /home/user/secret.txt".into()),
            assistant_messages: vec![AttributedMessage {
                content: "Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij".into(),
                parent_tool_call_id: None,
                agent_display_name: None,
            }],
            model: None,
            timestamp: None,
            end_timestamp: None,
            tool_calls: vec![TurnToolCall {
                tool_call_id: Some("tc-1".into()),
                parent_tool_call_id: None,
                tool_name: "read_file".into(),
                event_index: None,
                arguments: Some(serde_json::json!({"path": "/home/user/secret.txt"})),
                success: Some(true),
                error: None,
                started_at: None,
                completed_at: None,
                duration_ms: None,
                mcp_server_name: None,
                mcp_tool_name: None,
                is_complete: true,
                is_subagent: false,
                agent_display_name: None,
                agent_description: None,
                model: None,
                intention_summary: None,
                result_content: Some("email: admin@company.com".into()),
                args_summary: None,
            }],
            duration_ms: None,
            is_complete: true,
            reasoning_texts: vec![],
            output_tokens: None,
            transformed_user_message: None,
            attachments: None,
            session_events: vec![],
        }]);
        let mut archive = test_archive(session);

        let stats = apply_redaction(&mut archive, &test_options_all());
        let conv = archive.sessions[0].conversation.as_ref().unwrap();
        let turn = &conv[0];

        // Path in user message
        assert!(!turn.user_message.as_ref().unwrap().contains("/home/user"));
        // Token in assistant message
        assert!(!turn.assistant_messages[0].content.contains("ghp_"));
        // Path in tool arguments
        let args = turn.tool_calls[0].arguments.as_ref().unwrap();
        assert!(!args.to_string().contains("/home/user"));
        // Email in result content
        assert!(!turn.tool_calls[0].result_content.as_ref().unwrap().contains("admin@"));

        assert!(stats.fields_redacted > 0);
    }

    #[test]
    fn redacts_plan_content() {
        let mut session = minimal_session();
        session.plan = Some("Deploy to 192.168.1.100 using API_KEY=abc123".into());
        let mut archive = test_archive(session);

        apply_redaction(&mut archive, &test_options_all());

        let plan = archive.sessions[0].plan.as_ref().unwrap();
        assert!(!plan.contains("192.168.1.100"));
    }

    #[test]
    fn redacts_todo_content() {
        let mut session = minimal_session();
        session.todos = Some(crate::document::TodoExport {
            items: vec![crate::document::TodoItemExport {
                id: "t1".into(),
                title: "Fix /home/user/bug.rs".into(),
                description: Some("Password: hunter2secret".into()),
                status: "pending".into(),
                created_at: None,
                updated_at: None,
            }],
            deps: vec![],
        });
        let mut archive = test_archive(session);

        apply_redaction(&mut archive, &test_options_all());

        let todo = &archive.sessions[0].todos.as_ref().unwrap().items[0];
        assert!(!todo.title.contains("/home/user"));
        assert!(!todo.description.as_ref().unwrap().contains("hunter2secret"));
    }

    #[test]
    fn has_any_detects_flags() {
        assert!(!RedactionOptions::default().has_any());
        assert!(test_options_all().has_any());
        assert!(test_options_paths_only().has_any());
    }

    #[test]
    fn redaction_stats_populated() {
        let mut session = minimal_session();
        session.metadata.cwd = Some(r"C:\Users\alice\project".into());
        session.plan = Some("Contact admin@test.com at 10.0.0.1".into());
        let mut archive = test_archive(session);

        let stats = apply_redaction(&mut archive, &test_options_all());
        assert!(stats.fields_redacted >= 2);
        assert!(stats.total_replacements >= 2);
    }
}
