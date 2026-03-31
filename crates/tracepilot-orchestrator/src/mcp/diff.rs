//! MCP configuration diff/merge utilities.
//!
//! Computes diffs between two MCP configurations (e.g., local vs imported)
//! and provides merge operations for conflict resolution.

use crate::mcp::types::McpServerConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single change in a configuration diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiffEntry {
    pub server_name: String,
    pub change_type: McpDiffChangeType,
    /// The local (current) config, if it exists.
    pub local: Option<McpServerConfig>,
    /// The incoming (imported) config, if it exists.
    pub incoming: Option<McpServerConfig>,
}

/// The type of change detected in a diff.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpDiffChangeType {
    /// Server exists only in incoming config.
    Added,
    /// Server exists only in local config.
    Removed,
    /// Server exists in both but differs.
    Modified,
    /// Server is identical in both.
    Unchanged,
}

/// Complete diff between two configurations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigDiff {
    pub entries: Vec<McpDiffEntry>,
    pub added_count: usize,
    pub removed_count: usize,
    pub modified_count: usize,
    pub unchanged_count: usize,
}

/// Compute the diff between local and incoming server configurations.
pub fn compute_diff(
    local: &HashMap<String, McpServerConfig>,
    incoming: &HashMap<String, McpServerConfig>,
) -> McpConfigDiff {
    let mut entries = Vec::new();
    let mut added = 0;
    let mut removed = 0;
    let mut modified = 0;
    let mut unchanged = 0;

    // Check all local servers
    for (name, local_cfg) in local {
        if let Some(incoming_cfg) = incoming.get(name) {
            if configs_equal(local_cfg, incoming_cfg) {
                unchanged += 1;
                entries.push(McpDiffEntry {
                    server_name: name.clone(),
                    change_type: McpDiffChangeType::Unchanged,
                    local: Some(local_cfg.clone()),
                    incoming: Some(incoming_cfg.clone()),
                });
            } else {
                modified += 1;
                entries.push(McpDiffEntry {
                    server_name: name.clone(),
                    change_type: McpDiffChangeType::Modified,
                    local: Some(local_cfg.clone()),
                    incoming: Some(incoming_cfg.clone()),
                });
            }
        } else {
            removed += 1;
            entries.push(McpDiffEntry {
                server_name: name.clone(),
                change_type: McpDiffChangeType::Removed,
                local: Some(local_cfg.clone()),
                incoming: None,
            });
        }
    }

    // Check for servers only in incoming
    for (name, incoming_cfg) in incoming {
        if !local.contains_key(name) {
            added += 1;
            entries.push(McpDiffEntry {
                server_name: name.clone(),
                change_type: McpDiffChangeType::Added,
                local: None,
                incoming: Some(incoming_cfg.clone()),
            });
        }
    }

    entries.sort_by(|a, b| a.server_name.cmp(&b.server_name));

    McpConfigDiff {
        entries,
        added_count: added,
        removed_count: removed,
        modified_count: modified,
        unchanged_count: unchanged,
    }
}

/// Compare two server configs for semantic equality.
/// Uses serde_json::to_value which normalizes HashMap key order.
fn configs_equal(a: &McpServerConfig, b: &McpServerConfig) -> bool {
    let a_val = serde_json::to_value(a).unwrap_or_default();
    let b_val = serde_json::to_value(b).unwrap_or_default();
    a_val == b_val
}

/// Apply selected diff entries to a local configuration.
///
/// For each selected entry:
/// - Added: insert the incoming server
/// - Modified: replace local with incoming
/// - Removed: remove the server (only if selected for removal)
pub fn apply_diff_selections(
    local: &mut HashMap<String, McpServerConfig>,
    selections: &[McpDiffSelection],
) {
    for sel in selections {
        match sel.action {
            McpDiffAction::Accept => {
                if let Some(incoming) = &sel.incoming {
                    local.insert(sel.server_name.clone(), incoming.clone());
                }
            }
            McpDiffAction::Reject => {
                // Keep local as-is (no-op)
            }
            McpDiffAction::Remove => {
                local.remove(&sel.server_name);
            }
        }
    }
}

/// A user's decision on a single diff entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiffSelection {
    pub server_name: String,
    pub action: McpDiffAction,
    pub incoming: Option<McpServerConfig>,
}

/// Action to take on a diff entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpDiffAction {
    Accept,
    Reject,
    Remove,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_server(cmd: &str) -> McpServerConfig {
        McpServerConfig {
            command: Some(cmd.to_string()),
            args: vec![],
            env: HashMap::new(),
            url: None,
            transport: None,
            headers: HashMap::new(),
            tools: vec![],
            description: None,
            tags: vec![],
            enabled: true,
        }
    }

    #[test]
    fn identical_configs_no_changes() {
        let a = HashMap::from([("s1".into(), make_server("cmd1"))]);
        let b = HashMap::from([("s1".into(), make_server("cmd1"))]);
        let diff = compute_diff(&a, &b);
        assert_eq!(diff.unchanged_count, 1);
        assert_eq!(diff.added_count, 0);
        assert_eq!(diff.removed_count, 0);
        assert_eq!(diff.modified_count, 0);
    }

    #[test]
    fn detects_added_server() {
        let a = HashMap::new();
        let b = HashMap::from([("new".into(), make_server("cmd"))]);
        let diff = compute_diff(&a, &b);
        assert_eq!(diff.added_count, 1);
        assert_eq!(diff.entries[0].change_type, McpDiffChangeType::Added);
    }

    #[test]
    fn detects_removed_server() {
        let a = HashMap::from([("old".into(), make_server("cmd"))]);
        let b = HashMap::new();
        let diff = compute_diff(&a, &b);
        assert_eq!(diff.removed_count, 1);
        assert_eq!(diff.entries[0].change_type, McpDiffChangeType::Removed);
    }

    #[test]
    fn detects_modified_server() {
        let a = HashMap::from([("s".into(), make_server("cmd1"))]);
        let b = HashMap::from([("s".into(), make_server("cmd2"))]);
        let diff = compute_diff(&a, &b);
        assert_eq!(diff.modified_count, 1);
    }

    #[test]
    fn complex_diff() {
        let a = HashMap::from([
            ("kept".into(), make_server("same")),
            ("changed".into(), make_server("old")),
            ("removed".into(), make_server("gone")),
        ]);
        let b = HashMap::from([
            ("kept".into(), make_server("same")),
            ("changed".into(), make_server("new")),
            ("added".into(), make_server("fresh")),
        ]);
        let diff = compute_diff(&a, &b);
        assert_eq!(diff.unchanged_count, 1);
        assert_eq!(diff.modified_count, 1);
        assert_eq!(diff.removed_count, 1);
        assert_eq!(diff.added_count, 1);
    }

    #[test]
    fn apply_accept_inserts_server() {
        let mut local = HashMap::new();
        let server = make_server("cmd");
        apply_diff_selections(
            &mut local,
            &[McpDiffSelection {
                server_name: "new".into(),
                action: McpDiffAction::Accept,
                incoming: Some(server.clone()),
            }],
        );
        assert!(local.contains_key("new"));
    }

    #[test]
    fn apply_reject_keeps_local() {
        let mut local = HashMap::from([("s".into(), make_server("original"))]);
        apply_diff_selections(
            &mut local,
            &[McpDiffSelection {
                server_name: "s".into(),
                action: McpDiffAction::Reject,
                incoming: Some(make_server("replacement")),
            }],
        );
        assert_eq!(local.get("s").unwrap().command.as_deref(), Some("original"));
    }

    #[test]
    fn apply_remove_deletes_server() {
        let mut local = HashMap::from([("s".into(), make_server("cmd"))]);
        apply_diff_selections(
            &mut local,
            &[McpDiffSelection {
                server_name: "s".into(),
                action: McpDiffAction::Remove,
                incoming: None,
            }],
        );
        assert!(!local.contains_key("s"));
    }

    #[test]
    fn entries_sorted_by_name() {
        let a = HashMap::from([
            ("z-server".into(), make_server("z")),
            ("a-server".into(), make_server("a")),
        ]);
        let b = HashMap::from([("m-server".into(), make_server("m"))]);
        let diff = compute_diff(&a, &b);
        let names: Vec<_> = diff.entries.iter().map(|e| &e.server_name).collect();
        assert_eq!(names, vec!["a-server", "m-server", "z-server"]);
    }
}
