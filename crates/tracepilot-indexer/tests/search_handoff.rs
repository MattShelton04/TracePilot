// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! A refresh that indexes a few sessions hands their search content, taken
//! from the events it parsed, to the search writer instead of parsing them
//! again. The handed-off rows must be the rows a search pass would write.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{CopilotProvider, ProviderRegistry};
use tracepilot_indexer::{
    IndexScope, reindex_incremental_covered, reindex_incremental_with_search,
    reindex_search_content_covered, write_search_handoff,
};
use tracepilot_test_support::claude::{OPUS, Transcript, Usage, text, tool_use};
use tracepilot_test_support::copilot_corpus::write_copilot_corpus;

const CLAUDE: &str = "aaaaaaaa-0000-4000-8000-000000000003";

fn claude_transcript(word: &str) -> Vec<u8> {
    let mut t = Transcript::main();
    t.prompt(&format!("{word} prompt please"));
    t.call(
        "msg_1",
        OPUS,
        vec![
            text(&format!("{word} reply")),
            tool_use(
                "toolu_1",
                "Bash",
                json!({"command": format!("echo {word}")}),
            ),
        ],
        Usage::new(10, 100, 0, 20),
        "tool_use",
    );
    let output = format!("{word} output");
    t.tool_result("toolu_1", json!(output), json!(output), false);
    t.to_bytes()
}

struct Fixture {
    _temp: TempDir,
    copilot_root: PathBuf,
    claude_config: PathBuf,
    transcript: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let copilot_root = temp.path().join("session-state");
        std::fs::create_dir_all(&copilot_root).unwrap();
        write_copilot_corpus(&copilot_root);
        let claude_config = temp.path().join("claude");
        let project = claude_config.join("projects").join("C--work-gamma");
        std::fs::create_dir_all(&project).unwrap();
        let transcript = project.join(format!("{CLAUDE}.jsonl"));
        std::fs::write(&transcript, claude_transcript("first")).unwrap();
        Self {
            _temp: temp,
            copilot_root,
            claude_config,
            transcript,
        }
    }

    fn scope(&self) -> IndexScope {
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(CopilotProvider::new(&self.copilot_root)));
        registry.register(Arc::new(ClaudeCodeProvider::new(&self.claude_config)));
        IndexScope::standalone(registry)
    }

    fn db(&self, name: &str) -> PathBuf {
        self._temp.path().join(name)
    }

    /// A different session file, of a different size.
    fn rewrite_transcript(&self, word: &str) {
        std::fs::write(&self.transcript, claude_transcript(word)).unwrap();
    }
}

type Row = (
    String,
    String,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<String>,
    String,
    Option<String>,
);

fn search_rows(db: &Path) -> Vec<Row> {
    let conn = rusqlite::Connection::open(db).unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT session_id, content_type, turn_number, event_index, timestamp_unix,
                    tool_name, content, metadata_json
             FROM search_content ORDER BY session_id, id",
        )
        .unwrap();
    stmt.query_map([], |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
        ))
    })
    .unwrap()
    .collect::<rusqlite::Result<_>>()
    .unwrap()
}

/// Each session's search freshness columns.
fn search_state(db: &Path) -> Vec<(String, Option<String>, Option<i64>)> {
    let conn = rusqlite::Connection::open(db).unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, search_source_fingerprint, search_extractor_version
             FROM sessions ORDER BY id",
        )
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

#[test]
fn handed_off_rows_match_what_the_search_pass_writes() {
    let fixture = Fixture::new();
    let scope = fixture.scope();

    let searched = fixture.db("searched.db");
    reindex_incremental_covered(&scope, &searched, |_| {}).unwrap();
    reindex_search_content_covered(&scope, &searched, |_| {}, || false).unwrap();

    let handed = fixture.db("handed.db");
    let (pass, handoff) = reindex_incremental_with_search(&scope, &handed, |_| {}).unwrap();
    let handoff = handoff.expect("a complete pass hands off its sessions");
    assert!(pass.complete);
    assert_eq!(handoff.len(), pass.indexed);
    let written = write_search_handoff(handoff, &scope, &handed, || false).unwrap();
    assert!(written.complete, "{written:?}");
    assert_eq!(written.indexed, pass.indexed);

    assert!(!search_rows(&handed).is_empty());
    assert_eq!(search_rows(&handed), search_rows(&searched));
    assert_eq!(search_state(&handed), search_state(&searched));
    let rerun = reindex_search_content_covered(&scope, &handed, |_| {}, || false).unwrap();
    assert_eq!(rerun.indexed, 0, "the handoff left nothing stale");
}

#[test]
fn a_refresh_hands_off_only_the_sessions_it_indexed() {
    let fixture = Fixture::new();
    let scope = fixture.scope();
    let db = fixture.db("index.db");
    reindex_incremental_covered(&scope, &db, |_| {}).unwrap();
    reindex_search_content_covered(&scope, &db, |_| {}, || false).unwrap();

    fixture.rewrite_transcript("second");
    let (pass, handoff) = reindex_incremental_with_search(&scope, &db, |_| {}).unwrap();
    assert_eq!(pass.indexed, 1);
    let handoff = handoff.unwrap();
    assert_eq!(handoff.len(), 1);
    assert!(
        write_search_handoff(handoff, &scope, &db, || false)
            .unwrap()
            .complete
    );

    let contents: Vec<String> = search_rows(&db)
        .into_iter()
        .filter(|row| row.0 == CLAUDE)
        .map(|row| row.6)
        .collect();
    assert!(
        contents.iter().any(|c| c.contains("second")),
        "{contents:?}"
    );
    assert!(
        !contents.iter().any(|c| c.contains("first")),
        "{contents:?}"
    );
    let rerun = reindex_search_content_covered(&scope, &db, |_| {}, || false).unwrap();
    assert_eq!(rerun.indexed, 0);
}

#[test]
fn a_session_that_changes_again_is_left_to_the_search_pass() {
    let fixture = Fixture::new();
    let scope = fixture.scope();
    let db = fixture.db("index.db");
    reindex_incremental_covered(&scope, &db, |_| {}).unwrap();
    reindex_search_content_covered(&scope, &db, |_| {}, || false).unwrap();

    fixture.rewrite_transcript("second");
    let (_, handoff) = reindex_incremental_with_search(&scope, &db, |_| {}).unwrap();
    fixture.rewrite_transcript("third version");
    let written = write_search_handoff(handoff.unwrap(), &scope, &db, || false).unwrap();
    assert!(!written.complete, "{written:?}");
    assert_eq!(written.indexed, 0);

    let rerun = reindex_search_content_covered(&scope, &db, |_| {}, || false).unwrap();
    assert_eq!(rerun.indexed, 1);
    let contents: Vec<String> = search_rows(&db)
        .into_iter()
        .filter(|row| row.0 == CLAUDE)
        .map(|row| row.6)
        .collect();
    assert!(contents.iter().any(|c| c.contains("third")), "{contents:?}");
}

#[test]
fn a_cancelled_handoff_is_incomplete() {
    let fixture = Fixture::new();
    let scope = fixture.scope();
    let db = fixture.db("index.db");
    let (_, handoff) = reindex_incremental_with_search(&scope, &db, |_| {}).unwrap();
    let written = write_search_handoff(handoff.unwrap(), &scope, &db, || true).unwrap();
    assert!(!written.complete);
    assert_eq!(written.indexed, 0);
}
