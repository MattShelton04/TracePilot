//! Post-build content filtering for conversation detail levels.
//!
//! Applied to a [`SessionArchive`] after the builder assembles it and before
//! a renderer consumes it.  Controls how much detail is kept for tool calls
//! and subagent internals without removing entire sections.

use std::collections::HashSet;

use crate::document::SessionArchive;
use crate::options::ContentDetailOptions;
use tracepilot_core::models::conversation::ConversationTurn;

/// Apply content-detail filtering to every session in the archive.
///
/// When both flags are `true` (the default), this is a no-op.
pub fn apply_content_filters(archive: &mut SessionArchive, options: &ContentDetailOptions) {
    if options.include_subagent_internals && options.include_tool_details {
        return; // Nothing to filter — full tool results are handled by the builder
    }

    for session in &mut archive.sessions {
        if let Some(ref mut conversation) = session.conversation {
            // Collect subagent IDs across ALL turns first — child tool calls
            // often land in different turns than the subagent entry itself.
            let subagent_ids: HashSet<String> = if !options.include_subagent_internals {
                conversation
                    .iter()
                    .flat_map(|turn| &turn.tool_calls)
                    .filter(|tc| tc.is_subagent)
                    .filter_map(|tc| tc.tool_call_id.clone())
                    .collect()
            } else {
                HashSet::new()
            };

            for turn in conversation.iter_mut() {
                if !options.include_subagent_internals {
                    collapse_subagent_internals(turn, &subagent_ids);
                }
                if !options.include_tool_details {
                    strip_tool_details(turn);
                }
            }
        }
    }
}

/// Remove child tool calls, reasoning, and assistant messages that belong to
/// subagents, keeping only the top-level subagent entry with its final result.
///
/// `subagent_ids` must be collected across ALL turns in the conversation,
/// since child events often land in different turns than the subagent entry.
fn collapse_subagent_internals(turn: &mut ConversationTurn, subagent_ids: &HashSet<String>) {
    if subagent_ids.is_empty() {
        return;
    }

    // Remove tool calls that are children of a subagent
    turn.tool_calls.retain(|tc| {
        tc.parent_tool_call_id
            .as_ref()
            .is_none_or(|pid| !subagent_ids.contains(pid))
    });

    // Remove assistant messages attributed to subagents
    turn.assistant_messages.retain(|msg| {
        msg.parent_tool_call_id
            .as_ref()
            .is_none_or(|pid| !subagent_ids.contains(pid))
    });

    // Remove reasoning texts attributed to subagents
    turn.reasoning_texts.retain(|msg| {
        msg.parent_tool_call_id
            .as_ref()
            .is_none_or(|pid| !subagent_ids.contains(pid))
    });
}

/// Strip verbose fields from tool calls, keeping only name, status, and summaries.
fn strip_tool_details(turn: &mut ConversationTurn) {
    for tc in &mut turn.tool_calls {
        tc.arguments = None;
        tc.result_content = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{minimal_session, test_archive};
    use tracepilot_core::models::conversation::{AttributedMessage, TurnToolCall};

    fn make_turn_with_subagent() -> ConversationTurn {
        ConversationTurn {
            turn_index: 0,
            event_index: None,
            turn_id: None,
            interaction_id: None,
            user_message: Some("Test".into()),
            assistant_messages: vec![
                AttributedMessage {
                    content: "Main response".into(),
                    parent_tool_call_id: None,
                    agent_display_name: None,
                    event_index: None,
                },
                AttributedMessage {
                    content: "Subagent response".into(),
                    parent_tool_call_id: Some("sub-1".into()),
                    agent_display_name: Some("Explore Agent".into()),
                    event_index: None,
                },
            ],
            model: None,
            timestamp: None,
            end_timestamp: None,
            tool_calls: vec![
                // Regular tool call
                TurnToolCall {
                    tool_call_id: Some("tc-1".into()),
                    parent_tool_call_id: None,
                    tool_name: "read_file".into(),
                    event_index: None,
                    arguments: Some(serde_json::json!({"path": "foo.rs"})),
                    success: Some(true),
                    error: None,
                    started_at: None,
                    completed_at: None,
                    duration_ms: Some(100),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                    is_complete: true,
                    is_subagent: false,
                    agent_display_name: None,
                    agent_description: None,
                    model: None,
                    requested_model: None,
                    intention_summary: Some("Read foo.rs".into()),
                    total_tokens: None,
                    total_tool_calls: None,
                    result_content: Some("file contents here".into()),
                    args_summary: Some("path: foo.rs".into()),
                },
                // Subagent entry
                TurnToolCall {
                    tool_call_id: Some("sub-1".into()),
                    parent_tool_call_id: None,
                    tool_name: "Explore Agent".into(),
                    event_index: None,
                    arguments: None,
                    success: Some(true),
                    error: None,
                    started_at: None,
                    completed_at: None,
                    duration_ms: Some(5000),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                    is_complete: true,
                    is_subagent: true,
                    agent_display_name: Some("Explore Agent".into()),
                    agent_description: Some("Explores codebase".into()),
                    model: None,
                    requested_model: None,
                    intention_summary: Some("Searching for auth logic".into()),
                    total_tokens: None,
                    total_tool_calls: None,
                    result_content: Some("Found auth.rs".into()),
                    args_summary: None,
                },
                // Child tool call of the subagent
                TurnToolCall {
                    tool_call_id: Some("tc-child-1".into()),
                    parent_tool_call_id: Some("sub-1".into()),
                    tool_name: "grep".into(),
                    event_index: None,
                    arguments: Some(serde_json::json!({"pattern": "auth"})),
                    success: Some(true),
                    error: None,
                    started_at: None,
                    completed_at: None,
                    duration_ms: Some(50),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                    is_complete: true,
                    is_subagent: false,
                    agent_display_name: None,
                    agent_description: None,
                    model: None,
                    requested_model: None,
                    intention_summary: Some("Grep for auth".into()),
                    total_tokens: None,
                    total_tool_calls: None,
                    result_content: Some("auth.rs:10: fn authenticate".into()),
                    args_summary: Some("pattern: auth".into()),
                },
            ],
            duration_ms: Some(6000),
            is_complete: true,
            reasoning_texts: vec![
                AttributedMessage {
                    content: "Main reasoning".into(),
                    parent_tool_call_id: None,
                    agent_display_name: None,
                    event_index: None,
                },
                AttributedMessage {
                    content: "Subagent reasoning".into(),
                    parent_tool_call_id: Some("sub-1".into()),
                    agent_display_name: Some("Explore Agent".into()),
                    event_index: None,
                },
            ],
            output_tokens: None,
            transformed_user_message: None,
            attachments: None,
            session_events: vec![],
            system_messages: vec![],
        }
    }

    fn archive_with_turn(turn: ConversationTurn) -> SessionArchive {
        let mut session = minimal_session();
        session.conversation = Some(vec![turn]);
        test_archive(session)
    }

    #[test]
    fn noop_when_all_detail_enabled() {
        let turn = make_turn_with_subagent();
        let mut archive = archive_with_turn(turn);
        let original_tool_count = archive.sessions[0].conversation.as_ref().unwrap()[0]
            .tool_calls
            .len();

        apply_content_filters(&mut archive, &ContentDetailOptions::default());

        let filtered_tool_count = archive.sessions[0].conversation.as_ref().unwrap()[0]
            .tool_calls
            .len();
        assert_eq!(original_tool_count, filtered_tool_count);
    }

    #[test]
    fn collapse_subagent_removes_child_tool_calls() {
        let turn = make_turn_with_subagent();
        let mut archive = archive_with_turn(turn);

        let opts = ContentDetailOptions {
            include_subagent_internals: false,
            include_tool_details: true,
            include_full_tool_results: false,
        };
        apply_content_filters(&mut archive, &opts);

        let conv = archive.sessions[0].conversation.as_ref().unwrap();
        let tool_calls = &conv[0].tool_calls;

        // Should keep regular tool call + subagent entry, but remove the child
        assert_eq!(tool_calls.len(), 2);
        assert_eq!(tool_calls[0].tool_name, "read_file");
        assert_eq!(tool_calls[1].tool_name, "Explore Agent");
        assert!(tool_calls[1].is_subagent);
    }

    #[test]
    fn collapse_subagent_removes_attributed_messages() {
        let turn = make_turn_with_subagent();
        let mut archive = archive_with_turn(turn);

        let opts = ContentDetailOptions {
            include_subagent_internals: false,
            include_tool_details: true,
            include_full_tool_results: false,
        };
        apply_content_filters(&mut archive, &opts);

        let conv = archive.sessions[0].conversation.as_ref().unwrap();

        // Only main assistant message should remain
        assert_eq!(conv[0].assistant_messages.len(), 1);
        assert_eq!(conv[0].assistant_messages[0].content, "Main response");

        // Only main reasoning should remain
        assert_eq!(conv[0].reasoning_texts.len(), 1);
        assert_eq!(conv[0].reasoning_texts[0].content, "Main reasoning");
    }

    #[test]
    fn strip_tool_details_removes_args_and_results() {
        let turn = make_turn_with_subagent();
        let mut archive = archive_with_turn(turn);

        let opts = ContentDetailOptions {
            include_subagent_internals: true,
            include_tool_details: false,
            include_full_tool_results: false,
        };
        apply_content_filters(&mut archive, &opts);

        let conv = archive.sessions[0].conversation.as_ref().unwrap();
        for tc in &conv[0].tool_calls {
            assert!(tc.arguments.is_none(), "arguments should be stripped");
            assert!(
                tc.result_content.is_none(),
                "result_content should be stripped"
            );
            // Summaries should be preserved
            if tc.tool_name == "read_file" {
                assert_eq!(tc.intention_summary.as_deref(), Some("Read foo.rs"));
                assert_eq!(tc.args_summary.as_deref(), Some("path: foo.rs"));
            }
        }
    }

    #[test]
    fn both_filters_combined() {
        let turn = make_turn_with_subagent();
        let mut archive = archive_with_turn(turn);

        let opts = ContentDetailOptions {
            include_subagent_internals: false,
            include_tool_details: false,
            include_full_tool_results: false,
        };
        apply_content_filters(&mut archive, &opts);

        let conv = archive.sessions[0].conversation.as_ref().unwrap();
        // Subagent child removed: 2 tool calls remain
        assert_eq!(conv[0].tool_calls.len(), 2);
        // All tool calls have args/results stripped
        for tc in &conv[0].tool_calls {
            assert!(tc.arguments.is_none());
            assert!(tc.result_content.is_none());
        }
    }

    #[test]
    fn no_subagents_is_noop_for_collapse() {
        let mut turn = make_turn_with_subagent();
        // Remove subagent entries
        turn.tool_calls
            .retain(|tc| !tc.is_subagent && tc.parent_tool_call_id.is_none());
        turn.assistant_messages
            .retain(|m| m.parent_tool_call_id.is_none());
        turn.reasoning_texts
            .retain(|m| m.parent_tool_call_id.is_none());
        let mut archive = archive_with_turn(turn);

        let opts = ContentDetailOptions {
            include_subagent_internals: false,
            include_tool_details: true,
            include_full_tool_results: false,
        };
        apply_content_filters(&mut archive, &opts);

        let conv = archive.sessions[0].conversation.as_ref().unwrap();
        assert_eq!(conv[0].tool_calls.len(), 1);
        assert_eq!(conv[0].tool_calls[0].tool_name, "read_file");
    }
}
