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
        "powershell" | "shell" => {
            if let Some(cmd) = get_str("command") {
                return crate::utils::truncate_utf8_with_marker(&cmd, 150, Some("…"));
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
        "write_agent" => {
            let target = get_str("agent_id")
                .or_else(|| {
                    let count = obj.get("agent_ids")?.as_array()?.len();
                    Some(format!("{count} agents"))
                })
                .or_else(|| get_str("scope").map(|scope| format!("all {scope}")));
            let message = get_str("message").map(|m| {
                let line = m.split_whitespace().collect::<Vec<_>>().join(" ");
                crate::utils::truncate_utf8_with_marker(&line, 100, Some("…"))
            });
            let parts: Vec<String> = [target.map(|t| format!("→ {t}")), message]
                .into_iter()
                .flatten()
                .collect();
            if !parts.is_empty() {
                return parts.join(" · ");
            }
        }
        "list_agents" => {
            if let Some(scope) = get_str("scope") {
                return format!("scope: {scope}");
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
        // Mirrors `githubSummary()`: method, owner/repo, then path or query.
        name if name.starts_with("github-mcp-server") => {
            let line = |key: &str| get_str(key).map(|s| one_line(&s)).filter(|s| !s.is_empty());
            let repo = match (line("owner"), line("repo")) {
                (Some(owner), Some(repo)) => Some(format!("{owner}/{repo}")),
                (owner, repo) => owner.or(repo),
            };
            let target = line("path").or_else(|| line("query"));
            let parts: Vec<String> = [line("method"), repo, target]
                .into_iter()
                .flatten()
                .collect();
            return truncate_summary(&parts.join(" · "), 100);
        }
        _ => {}
    }

    String::new()
}

/// Collapse whitespace runs to single spaces and trim.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Mirrors the frontend `truncateSummary()`: one line, at most `max` characters plus "…".
fn truncate_summary(text: &str, max: usize) -> String {
    let line = one_line(text);
    match line.char_indices().nth(max) {
        Some((cut, _)) => format!("{}…", &line[..cut]),
        None => line,
    }
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

#[cfg(test)]
mod tests {
    use super::compute_args_summary;
    use serde_json::json;

    #[test]
    fn summarizes_agent_messages_by_target() {
        let direct = json!({ "agent_id": "beta", "message": "what is\n 6*7?" });
        assert_eq!(
            compute_args_summary("write_agent", &direct),
            "→ beta · what is 6*7?"
        );
        let multi = json!({ "agent_ids": ["a", "b"], "message": "go" });
        assert_eq!(
            compute_args_summary("write_agent", &multi),
            "→ 2 agents · go"
        );
        let scoped = json!({ "scope": "children", "message": "done?" });
        assert_eq!(
            compute_args_summary("write_agent", &scoped),
            "→ all children · done?"
        );
        let scope = json!({ "scope": "siblings" });
        assert_eq!(
            compute_args_summary("list_agents", &scope),
            "scope: siblings"
        );
        assert_eq!(compute_args_summary("list_agents", &json!({})), "");
    }

    #[test]
    fn summarizes_github_mcp_calls_like_the_frontend() {
        let summary = |tool: &str, args: serde_json::Value| compute_args_summary(tool, &args);
        assert_eq!(
            summary(
                "github-mcp-server-pull_request_read",
                json!({ "method": "get", "owner": "octo", "repo": "app", "pullNumber": 3 }),
            ),
            "get · octo/app"
        );
        assert_eq!(
            summary(
                "github-mcp-server-get_file_contents",
                json!({ "owner": "octo", "repo": "app", "path": "src/a.ts" }),
            ),
            "octo/app · src/a.ts"
        );
        assert_eq!(
            summary(
                "github-mcp-server-search_pull_requests",
                json!({ "query": "is:pr  is:open" }),
            ),
            "is:pr is:open"
        );
        assert_eq!(
            summary(
                "github-mcp-server-list_repositories",
                json!({ "owner": "octo" })
            ),
            "octo"
        );
        assert_eq!(summary("github-mcp-server-list_issues", json!({})), "");
        assert_eq!(
            summary("github-mcp-server-list_issues", json!({ "perPage": 5 })),
            ""
        );
        let long = summary(
            "github-mcp-server-search_code",
            json!({ "method": "get", "query": "x".repeat(300) }),
        );
        // 100 characters (not bytes) plus the marker, as in the frontend.
        assert_eq!(long, format!("get · {}…", "x".repeat(94)));
    }

    #[test]
    fn summarizes_every_shell_family_member_by_command() {
        let args = json!({ "command": "cargo test" });
        for tool in ["powershell", "shell"] {
            assert_eq!(compute_args_summary(tool, &args), "cargo test");
        }
    }
}
