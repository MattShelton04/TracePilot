//! Tests for the Search tool filter's names ([`IndexDb::search_tool_names`]).

use crate::index_db::IndexDb;

fn build_db_with_fixture(sql: &str) -> IndexDb {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(sql).unwrap();
    IndexDb { conn }
}

/// Copilot and Claude Code rows sharing, and not sharing, canonical tools.
fn tool_names_fixture() -> IndexDb {
    build_db_with_fixture(
        r#"CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL);
         CREATE TABLE search_content (
             id INTEGER PRIMARY KEY,
             session_id TEXT NOT NULL,
             tool_name TEXT,
             content TEXT NOT NULL,
             metadata_json TEXT
         );
         CREATE INDEX idx_search_content_session ON search_content(session_id);
         CREATE INDEX idx_search_content_tool ON search_content(tool_name);
         INSERT INTO sessions VALUES ('c1', 'copilot'), ('c2', 'copilot'),
             ('k1', 'claudeCode'), ('k2', 'claudeCode');
         INSERT INTO search_content (session_id, tool_name, content, metadata_json) VALUES
             ('c1', NULL, 'prompt', NULL),
             ('c1', 'powershell', 'ls', NULL),
             ('k1', 'powershell', 'ls', '{"nativeToolName":"PowerShell"}'),
             ('k1', 'shell', 'ls', '{"nativeToolName":"Bash"}'),
             ('k2', 'shell', 'pwd', '{"nativeToolName":"Bash"}'),
             ('k1', 'create', 'a.ts', '{"nativeToolName":"Write"}'),
             ('k2', 'apply_patch', 'b.ts', '{"nativeToolName":"Write"}'),
             ('k2', 'apply_patch', 'c.ts', '{"nativeToolName":"MultiEdit"}'),
             ('c2', 'apply_patch', 'd.ts', NULL),
             ('c2', 'view', 'e.ts', NULL),
             ('k1', 'Monitor', 'watch', '{"nativeToolName":"Monitor"}'),
             ('k2', 'task', 'explore', NULL);"#,
    )
}

#[test]
fn search_tool_names_report_native_names_and_sources_per_canonical_tool() {
    use super::SearchToolName;
    use tracepilot_core::provider::SessionSource::{ClaudeCode, Copilot};

    let tool = |name: &str, natives: &[&str], sources| SearchToolName {
        name: name.to_string(),
        native_names: natives.iter().map(|n| n.to_string()).collect(),
        sources,
    };
    assert_eq!(
        tool_names_fixture().search_tool_names().unwrap(),
        [
            tool("Monitor", &["Monitor"], vec![ClaudeCode]),
            tool(
                "apply_patch",
                &["MultiEdit", "Write"],
                vec![Copilot, ClaudeCode]
            ),
            tool("create", &["Write"], vec![ClaudeCode]),
            tool("powershell", &["PowerShell"], vec![Copilot, ClaudeCode]),
            tool("shell", &["Bash"], vec![ClaudeCode]),
            tool("task", &[], vec![ClaudeCode]),
            tool("view", &[], vec![Copilot]),
        ]
    );
}

#[test]
fn search_tool_names_match_a_full_scan_of_every_tool_row() {
    use std::collections::{BTreeMap, BTreeSet};

    // The straightforward query this replaced, which read every tool row.
    let db = tool_names_fixture();
    let mut expected: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)> = BTreeMap::new();
    let mut stmt = db
        .conn
        .prepare(
            "SELECT sc.tool_name, s.source,
                    json_extract(sc.metadata_json, '$.nativeToolName')
             FROM search_content sc JOIN sessions s ON s.id = sc.session_id
             WHERE sc.tool_name IS NOT NULL",
        )
        .unwrap();
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .unwrap();
    for row in rows {
        let (name, source, native) = row.unwrap();
        let entry = expected.entry(name).or_default();
        entry.0.insert(source);
        entry.1.extend(native);
    }

    let actual: BTreeMap<_, _> = db
        .search_tool_names()
        .unwrap()
        .into_iter()
        .map(|tool| {
            let sources = tool
                .sources
                .iter()
                .map(|s| s.as_str().to_string())
                .collect();
            (
                tool.name,
                (sources, tool.native_names.into_iter().collect()),
            )
        })
        .collect();
    assert_eq!(actual, expected);
}
