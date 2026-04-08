//! IPC preparation utilities for turn reconstruction.
//!
//! This module contains functions to optimize turn data for transfer to the frontend
//! via Tauri IPC, including computing human-readable argument summaries and stripping
//! unused fields to reduce payload size.

use crate::models::conversation::ConversationTurn;

/// Compute a short human-readable summary of tool call arguments.
///
/// Mirrors the frontend `formatArgsSummary()` from `packages/ui/src/utils/toolCall.ts`.
pub fn compute_args_summary(tool_name: &str, args: &serde_json::Value) -> String {
    let obj = match args.as_object() {
        Some(o) => o,
        None => return String::new(),
    };

    let get_str = |key: &str| obj.get(key).and_then(|v| v.as_str()).map(String::from);

    match tool_name {
        "view" | "edit" | "create" => {
            if let Some(p) = get_str("path") {
                return p;
            }
        }
        "grep" => {
            if let Some(pattern) = get_str("pattern") {
                let path_suffix = get_str("path")
                    .map(|p| format!(" in {}", p))
                    .unwrap_or_default();
                return format!("/{}/{}", pattern, path_suffix);
            }
        }
        "glob" => {
            if let Some(p) = get_str("pattern") {
                return p;
            }
        }
        "powershell" => {
            if let Some(cmd) = get_str("command") {
                if cmd.len() > 150 {
                    let truncated: String = cmd.chars().take(150).collect();
                    return format!("{}…", truncated);
                }
                return cmd;
            }
        }
        "task" | "sql" => {
            if let Some(d) = get_str("description") {
                return d;
            }
        }
        "read_agent" => {
            if let Some(id) = get_str("agent_id")
                .or_else(|| get_str("agent_name"))
                .or_else(|| get_str("name"))
            {
                return id;
            }
        }
        "report_intent" => {
            if let Some(i) = get_str("intent") {
                return i;
            }
        }
        "web_search" => {
            if let Some(q) = get_str("query") {
                return q;
            }
        }
        "web_fetch" => {
            if let Some(u) = get_str("url") {
                return u;
            }
        }
        name if name.starts_with("github-mcp-server") => {
            if let Some(m) = get_str("method") {
                return m;
            }
        }
        _ => {}
    }

    String::new()
}

/// Prepare turns for IPC transfer: compute args summaries and strip
/// `transformed_user_message` (never displayed, saves ~10-20% payload).
///
/// PERF: Mutates in place to avoid cloning. Iterates all turns × tool calls.
/// Lock scope on TurnCache should be minimized — clone data, drop lock, then call this.
#[tracing::instrument(skip_all, fields(turn_count = turns.len()))]
pub fn prepare_turns_for_ipc(turns: &mut [ConversationTurn]) {
    for turn in turns.iter_mut() {
        turn.transformed_user_message = None;

        for tc in turn.tool_calls.iter_mut() {
            if tc.args_summary.is_none()
                && let Some(ref args) = tc.arguments
            {
                let summary = compute_args_summary(&tc.tool_name, args);
                if !summary.is_empty() {
                    tc.args_summary = Some(summary);
                }
            }
        }
    }
}
