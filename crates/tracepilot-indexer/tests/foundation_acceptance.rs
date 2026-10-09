// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Q1 foundation acceptance (architecture.md §7): a test-only provider that
//! emits a hand-written canonical event stream gets through discovery,
//! indexing, search, Conversation and analytics next to the Copilot corpus.
//!
//! The provider is written here, outside `tracepilot-core`, against public
//! APIs only. That it needs nothing else is the point: a new source such as
//! Codex is a provider module plus fixtures, with no change to the indexer,
//! search or analytics. There is no third `SessionSource` yet, so it stands
//! in for `claudeCode`, the only non-Copilot source.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Value, json};
use tempfile::TempDir;
use tracepilot_core::analytics::types::AnalyticsData;
use tracepilot_core::error::{Result as CoreResult, TracePilotError};
use tracepilot_core::ids::SessionId;
use tracepilot_core::parsing::events::parse_typed_events;
use tracepilot_core::parsing::snapshot::{FileFingerprint, check_cancelled, ensure_unchanged};
use tracepilot_core::provider::{
    CopilotProvider, Liveness, ProviderRegistry, ProviderSnapshot, SessionLocator, SessionProvider,
    SessionRole, SessionSource, SourceCapabilities, SourceFingerprint,
};
use tracepilot_core::summary::summary_from_events;
use tracepilot_core::turns::prepare_turns_for_ipc;
use tracepilot_indexer::index_db::IndexDb;
use tracepilot_indexer::{
    IndexScope, SearchFilters, reindex_all_scoped, reindex_search_content_scoped,
};
use tracepilot_test_support::copilot_corpus::write_copilot_corpus;

const FIXTURE_ID: &str = "f1f1f1f1-0000-4000-8000-000000000001";
const MODEL: &str = "fixture-model-1";

/// Sessions stored as canonical event logs: `<root>/<id>.jsonl`.
struct FixtureProvider {
    root: PathBuf,
}

impl FixtureProvider {
    fn locator(&self, path: PathBuf) -> Option<SessionLocator> {
        // Only a UUID-shaped name is a session.
        let stem = path.file_stem()?.to_str()?;
        let uuid_shaped =
            stem.len() == 36 && stem.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
        Some(SessionLocator {
            source: SessionSource::ClaudeCode,
            id: SessionId::from_validated(uuid_shaped.then_some(stem)?),
            source_bytes_hint: std::fs::metadata(&path).map_or(0, |m| m.len()),
            primary_path: path,
            parent_id: None,
            role: SessionRole::Primary,
        })
    }
}

impl SessionProvider for FixtureProvider {
    fn source(&self) -> SessionSource {
        SessionSource::ClaudeCode
    }

    fn capabilities(&self) -> SourceCapabilities {
        SourceCapabilities::default()
    }

    fn discover(&self, is_cancelled: &dyn Fn() -> bool) -> CoreResult<Vec<SessionLocator>> {
        let mut sessions = Vec::new();
        for entry in std::fs::read_dir(&self.root)? {
            check_cancelled(&is_cancelled)?;
            let path = entry?.path();
            if path.extension().is_some_and(|ext| ext == "jsonl") {
                sessions.extend(self.locator(path));
            }
        }
        Ok(sessions)
    }

    fn fingerprint(&self, session: &SessionLocator) -> CoreResult<SourceFingerprint> {
        let path = session.primary_path.clone();
        let file = FileFingerprint::read(&path)?;
        Ok(SourceFingerprint::new(vec![(path, file)], None))
    }

    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<ProviderSnapshot> {
        check_cancelled(&is_cancelled)?;
        let fingerprint = self.fingerprint(session)?;
        let parsed = parse_typed_events(&session.primary_path)?;
        if strict && parsed.diagnostics.malformed_lines > 0 {
            return Err(TracePilotError::ParseError {
                context: "incomplete fixture log".into(),
                source: None,
            });
        }
        let (mut summary, turns) = summary_from_events(&session.id, &parsed.events);
        summary.summary = turns.iter().find_map(|turn| turn.user_message.clone());
        if strict {
            ensure_unchanged(
                &fingerprint,
                &self.fingerprint(session)?,
                &session.primary_path,
            )?;
        }
        Ok(ProviderSnapshot {
            summary,
            events: Some(parsed.events),
            turns: Some(turns),
            metrics: None,
            diagnostics: Some(parsed.diagnostics),
            format: None,
            fingerprint,
        })
    }

    fn liveness(&self, _session: &SessionLocator) -> Liveness {
        Liveness::Unknown
    }

    fn root(&self) -> Option<&Path> {
        Some(&self.root)
    }

    fn resolve(&self, id: &SessionId) -> CoreResult<Option<SessionLocator>> {
        let path = self.root.join(format!("{}.jsonl", id.as_str()));
        Ok(path.is_file().then(|| self.locator(path)).flatten())
    }
}

/// Two prompts, two model calls (a 5-minute cache write, then a read two
/// minutes later), a tool with a native name and a denial warning.
fn fixture_log() -> String {
    let events: [(&str, &str, Value); 14] = [
        (
            "session.start",
            "10:00:00",
            json!({"sessionId": FIXTURE_ID, "producer": "fixture",
            "selectedModel": MODEL, "context": {"cwd": "C:\\fixture\\nebula",
            "repository": "fixture/nebula", "branch": "main"}}),
        ),
        (
            "user.message",
            "10:00:01",
            json!({"content": "Chart the fixturequasar orbit.",
            "interactionId": "i1"}),
        ),
        (
            "assistant.turn_start",
            "10:00:02",
            json!({"turnId": "t1", "model": MODEL,
            "interactionId": "i1"}),
        ),
        (
            "tracepilot.model_call",
            "10:00:02",
            json!({"model": MODEL, "requestId": "r1",
            "inputTokens": 1200, "cacheReadTokens": 1000, "cacheWriteTokens": 150,
            "cacheWriteByTtl": {"300": 150}, "outputTokens": 80, "reasoningTokens": 0,
            "stopReason": "tool_use"}),
        ),
        (
            "assistant.message",
            "10:00:03",
            json!({"messageId": "m1",
            "content": "Plotting the fixturenebula path.", "interactionId": "i1"}),
        ),
        (
            "tool.execution_start",
            "10:00:04",
            json!({"toolCallId": "c1", "toolName": "view",
            "arguments": {"path": "orbit.txt"}, "nativeToolName": "open_file"}),
        ),
        (
            "tool.execution_complete",
            "10:00:05",
            json!({"toolCallId": "c1", "success": true,
            "result": {"content": "fixtureorbitdata"}}),
        ),
        (
            "session.warning",
            "10:00:06",
            json!({"warningType": "tool_denied",
            "message": "Tool use rejected by the user"}),
        ),
        ("assistant.turn_end", "10:00:07", json!({"turnId": "t1"})),
        (
            "user.message",
            "10:02:00",
            json!({"content": "Summarize it.", "interactionId": "i2"}),
        ),
        (
            "assistant.turn_start",
            "10:02:01",
            json!({"turnId": "t2", "model": MODEL,
            "interactionId": "i2"}),
        ),
        (
            "tracepilot.model_call",
            "10:02:01",
            json!({"model": MODEL, "requestId": "r2",
            "inputTokens": 1300, "cacheReadTokens": 1150, "cacheWriteTokens": 0,
            "outputTokens": 40, "reasoningTokens": 0, "stopReason": "end_turn"}),
        ),
        (
            "assistant.message",
            "10:02:02",
            json!({"messageId": "m2", "content": "Done.",
            "interactionId": "i2"}),
        ),
        ("assistant.turn_end", "10:02:03", json!({"turnId": "t2"})),
    ];
    let mut parent: Option<String> = None;
    let mut lines = String::new();
    for (index, (kind, time, data)) in events.into_iter().enumerate() {
        let id = format!("fx-{index}");
        let line = json!({"type": kind, "data": data, "id": id,
            "timestamp": format!("2026-09-21T{time}.000Z"), "parentId": parent});
        lines.push_str(&line.to_string());
        lines.push('\n');
        parent = Some(id);
    }
    lines
}

struct Corpus {
    _temp: TempDir,
    copilot_root: PathBuf,
    fixture_root: PathBuf,
    db_dir: PathBuf,
}

impl Corpus {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let copilot_root = temp.path().join("session-state");
        std::fs::create_dir_all(&copilot_root).unwrap();
        write_copilot_corpus(&copilot_root);
        let fixture_root = temp.path().join("fixture");
        std::fs::create_dir_all(&fixture_root).unwrap();
        std::fs::write(
            fixture_root.join(format!("{FIXTURE_ID}.jsonl")),
            fixture_log(),
        )
        .unwrap();
        let db_dir = temp.path().join("db");
        std::fs::create_dir_all(&db_dir).unwrap();
        Self {
            copilot_root,
            fixture_root,
            db_dir,
            _temp: temp,
        }
    }

    fn registry(&self, with_fixture: bool) -> ProviderRegistry {
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(CopilotProvider::new(&self.copilot_root)));
        if with_fixture {
            registry.register(Arc::new(FixtureProvider {
                root: self.fixture_root.clone(),
            }));
        }
        registry
    }

    /// Index and search-index every registered source into a fresh database.
    fn index(&self, with_fixture: bool) -> IndexDb {
        let path = self.db_dir.join(format!("index-{with_fixture}.db"));
        let scope = IndexScope::standalone(self.registry(with_fixture));
        reindex_all_scoped(&scope, &path, |_| {}).unwrap();
        reindex_search_content_scoped(&scope, &path, |_| {}, || false).unwrap();
        IndexDb::open_or_create(&path).unwrap()
    }
}

fn search(db: &IndexDb, query: &str) -> Vec<String> {
    let mut ids: Vec<_> = db
        .query_content(Some(query), &SearchFilters::default())
        .unwrap()
        .into_iter()
        .map(|hit| hit.session_id)
        .collect();
    ids.dedup();
    ids
}

fn dashboard(db: &IndexDb) -> AnalyticsData {
    db.query_analytics(None, None, None, false, None).unwrap()
}

#[test]
fn a_new_provider_reaches_every_consumer_through_the_seam() {
    let corpus = Corpus::new();
    let copilot_only = corpus.index(false);
    let db = corpus.index(true);

    // Discovery and indexing: the fixture session is listed with its source,
    // summary and partial totals, and every Copilot row is still there.
    let sessions = db.list_sessions(None, None, None, false).unwrap();
    let copilot_sessions = copilot_only.list_sessions(None, None, None, false).unwrap();
    assert_eq!(sessions.len(), copilot_sessions.len() + 1);
    let fixture = sessions.iter().find(|s| s.id == FIXTURE_ID).unwrap();
    assert_eq!(fixture.source, SessionSource::ClaudeCode);
    assert_eq!(
        fixture.summary.as_deref(),
        Some("Chart the fixturequasar orbit.")
    );
    assert_eq!(fixture.repository.as_deref(), Some("fixture/nebula"));
    assert_eq!(fixture.turn_count, Some(2));
    assert_eq!(fixture.metrics_partial, Some(true));
    assert!(
        sessions
            .iter()
            .filter(|s| s.id != FIXTURE_ID)
            .all(|s| s.source == SessionSource::Copilot)
    );

    // Search: prompt, message and tool output.
    for word in ["fixturequasar", "fixturenebula", "fixtureorbitdata"] {
        assert_eq!(search(&db, word), [FIXTURE_ID], "{word}");
    }

    // Conversation: the IPC path resolves the stored locator through the
    // registry, loads events from the provider and reconstructs turns.
    let id = SessionId::from_validated(FIXTURE_ID);
    let stored = db.get_session_locator(&id).unwrap().unwrap();
    let registry = corpus.registry(true);
    let session = registry.locate(&id, Some(stored)).unwrap().unwrap();
    let events = session
        .provider
        .load_events(&session.locator, &|| false)
        .unwrap()
        .unwrap();
    let mut turns = tracepilot_core::reconstruct_turns(&events);
    prepare_turns_for_ipc(&mut turns);
    assert_eq!(turns.len(), 2);
    assert_eq!(
        turns[0].assistant_messages[0].content,
        "Plotting the fixturenebula path."
    );
    let tool = &turns[0].tool_calls[0];
    assert_eq!(
        (tool.tool_name.as_str(), tool.native_tool_name.as_deref()),
        ("view", Some("open_file"))
    );
    let usage = turns[0].usage.unwrap();
    assert_eq!((usage.model_calls, usage.input_tokens), (1, 1200));
    assert_eq!(turns[0].output_tokens, Some(80));
    let warning = turns[0]
        .session_events
        .iter()
        .find(|e| e.event_type == "session.warning")
        .unwrap();
    assert_eq!(warning.summary, "Tool use rejected by the user");

    // Analytics: everything the fixture adds, and nothing else.
    let (with, without) = (dashboard(&db), dashboard(&copilot_only));
    assert_eq!(with.total_sessions, without.total_sessions + 1);
    assert_eq!(
        with.total_tokens,
        without.total_tokens + 1200 + 80 + 1300 + 40
    );
    let model = with
        .model_distribution
        .iter()
        .find(|m| m.model == MODEL)
        .unwrap();
    assert_eq!((model.input_tokens, model.output_tokens), (2500, 120));
    assert_eq!(model.cache_read_tokens, 2150);
    assert_eq!(
        with.prompt_cache.warm_resumes,
        without.prompt_cache.warm_resumes + 1
    );
    let tools = |db: &IndexDb| {
        db.query_tool_analysis(None, None, None, false, None)
            .unwrap()
    };
    assert_eq!(tools(&db).total_calls, tools(&copilot_only).total_calls + 1);
    let conn = rusqlite::Connection::open(corpus.db_dir.join("index-true.db")).unwrap();
    let incidents: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM session_incidents WHERE session_id = ?1",
            [FIXTURE_ID],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(incidents, 1);
}
