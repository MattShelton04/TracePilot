// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Indexing several sources in one pass: synthetic Claude Code sessions next
//! to the Copilot corpus. Each source is indexed, searched and pruned on its
//! own, and a source whose inventory is incomplete is never pruned.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;
use tracepilot_core::error::Result as CoreResult;
use tracepilot_core::ids::SessionId;
use tracepilot_core::parsing::snapshot::check_cancelled;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{
    CopilotProvider, Liveness, ProviderRegistry, ProviderSnapshot, SessionLocator, SessionProvider,
    SessionSource, SourceCapabilities, SourceFingerprint,
};
use tracepilot_indexer::index_db::{CURRENT_EXTRACTOR_VERSION, IndexDb};
use tracepilot_indexer::{
    IndexScope, SearchFilters, SourceGenerations, ensure_complete_inventory, reindex_all_scoped,
    reindex_incremental_scoped, reindex_search_content_scoped,
};
use tracepilot_test_support::claude::{OPUS, Transcript, Usage, image, text, thinking, tool_use};
use tracepilot_test_support::copilot_corpus::write_copilot_corpus;

const CLAUDE_A: &str = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAUDE_B: &str = "aaaaaaaa-0000-4000-8000-000000000002";

/// A Claude session holding one sentinel word per kind of content.
fn claude_transcript(prefix: &str) -> Vec<u8> {
    let mut t = Transcript::main();
    t.prompt(&format!("{prefix}prompt please"));
    t.call(
        "msg_1",
        OPUS,
        vec![
            thinking(&format!("{prefix}reasoning about it")),
            text(&format!("{prefix}reply here")),
            tool_use(
                "toolu_1",
                "Bash",
                json!({"command": format!("echo {prefix}command")}),
            ),
            tool_use("toolu_2", "ToolSearch", json!({"query": "select:Monitor"})),
        ],
        Usage::new(10, 100, 0, 20),
        "tool_use",
    );
    let output = format!("{prefix}output text");
    t.tool_result("toolu_1", json!(output), json!(output), false);
    let loaded = format!("{prefix}loadedtool");
    t.tool_result(
        "toolu_2",
        json!([{"type": "tool_reference", "tool_name": loaded}]),
        json!({"matches": [loaded]}),
        false,
    );
    t.record(
        "attachment",
        json!({"attachment": {"type": "edited_text_file",
            "filename": format!("{prefix}attachedfile.ts")}}),
    );
    t.user(json!({"message": {"role": "user", "content": [
        image("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"),
        text(&format!("{prefix}caption text")),
    ]}}));
    t.bookkeeping(json!({"type": "ai-title", "aiTitle": format!("{prefix}bookkeeping title")}));
    t.call(
        "msg_2",
        OPUS,
        vec![text("Done.")],
        Usage::new(5, 120, 0, 10),
        "end_turn",
    );
    t.to_bytes()
}

struct Fixture {
    _temp: TempDir,
    copilot_root: PathBuf,
    claude_config: PathBuf,
    copilot_ids: Vec<String>,
    db_path: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let copilot_root = temp.path().join("session-state");
        std::fs::create_dir_all(&copilot_root).unwrap();
        let copilot_ids = write_copilot_corpus(&copilot_root)
            .into_iter()
            .map(|(_, path)| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        let claude_config = temp.path().join("claude");
        for (id, project, prefix) in [
            (CLAUDE_A, "C--work-alpha", "alphaz"),
            (CLAUDE_B, "C--work-beta", "betaz"),
        ] {
            let dir = claude_config.join("projects").join(project);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(format!("{id}.jsonl")), claude_transcript(prefix)).unwrap();
        }
        let db_path = temp.path().join("index.db");
        Self {
            _temp: temp,
            copilot_root,
            claude_config,
            copilot_ids,
            db_path,
        }
    }

    fn registry(&self) -> ProviderRegistry {
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(CopilotProvider::new(&self.copilot_root)));
        registry.register(Arc::new(ClaudeCodeProvider::new(&self.claude_config)));
        registry
    }

    fn scope(&self) -> IndexScope {
        IndexScope::standalone(self.registry())
    }

    fn index(&self, scope: &IndexScope) {
        reindex_all_scoped(scope, &self.db_path, |_| {}).unwrap();
        reindex_search_content_scoped(scope, &self.db_path, |_| {}, || false).unwrap();
    }

    fn ids(&self, source: &str) -> Vec<String> {
        let conn = rusqlite::Connection::open(&self.db_path).unwrap();
        let mut stmt = conn
            .prepare("SELECT id FROM sessions WHERE source = ?1 ORDER BY id")
            .unwrap();
        stmt.query_map([source], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    /// Ids of the sessions whose search content matches `query`.
    fn search(&self, query: &str) -> Vec<String> {
        let db = IndexDb::open_or_create(&self.db_path).unwrap();
        let mut ids: Vec<_> = db
            .query_content(Some(query), &SearchFilters::default())
            .unwrap()
            .into_iter()
            .map(|hit| hit.session_id)
            .collect();
        ids.sort();
        ids.dedup();
        ids
    }

    fn sorted_copilot_ids(&self) -> Vec<String> {
        let mut ids = self.copilot_ids.clone();
        ids.sort();
        ids
    }
}

#[test]
fn claude_sessions_index_and_search_next_to_copilot() {
    let fixture = Fixture::new();
    fixture.index(&fixture.scope());

    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A, CLAUDE_B]);
    assert_eq!(fixture.ids("copilot"), fixture.sorted_copilot_ids());

    // Prompts, messages, visible reasoning and tool text are searchable.
    for word in [
        "alphazprompt",
        "alphazreply",
        "alphazreasoning",
        "alphazcommand",
        "alphazoutput",
        "alphazcaption",
        "alphazloadedtool",
    ] {
        assert_eq!(fixture.search(word), [CLAUDE_A], "{word}");
    }
    // Attachments and bookkeeping never are.
    for word in ["alphazattachedfile", "alphazbookkeeping", "iVBORw0KGgo"] {
        assert!(fixture.search(word).is_empty(), "{word}");
    }

    // A second pass finds nothing stale in either source.
    let (indexed, skipped) =
        reindex_incremental_scoped(&fixture.scope(), &fixture.db_path, |_| {}).unwrap();
    assert_eq!(indexed, 0);
    assert_eq!(skipped, fixture.copilot_ids.len() + 2);
    let (searched, _) =
        reindex_search_content_scoped(&fixture.scope(), &fixture.db_path, |_| {}, || false)
            .unwrap();
    assert_eq!(searched, 0);
}

#[test]
fn search_rows_carry_their_source_and_tools_their_native_names() {
    let fixture = Fixture::new();
    fixture.index(&fixture.scope());
    let db = IndexDb::open_readonly(&fixture.db_path).unwrap();
    let filters = SearchFilters::default();

    let hits = db.query_content(None, &filters).unwrap();
    assert!(!hits.is_empty());
    for hit in &hits {
        let expected = if [CLAUDE_A, CLAUDE_B].contains(&hit.session_id.as_str()) {
            SessionSource::ClaudeCode
        } else {
            SessionSource::Copilot
        };
        assert_eq!(hit.source, expected, "{}", hit.session_id);
    }

    // The filter keeps canonical names; Claude rows add their native names.
    let tools = db.search_tool_names().unwrap();
    let shell = tools.iter().find(|tool| tool.name == "shell").unwrap();
    assert_eq!(shell.native_names, ["Bash"]);
    assert!(shell.sources.contains(&SessionSource::ClaudeCode));
    for tool in tools
        .iter()
        .filter(|tool| tool.sources == [SessionSource::Copilot])
    {
        assert!(tool.native_names.is_empty(), "{}", tool.name);
    }

    // Expanded results show the native name of neighbouring tool rows too.
    let output = db
        .query_content(Some("alphazoutput"), &filters)
        .unwrap()
        .remove(0);
    let (before, _) = db.get_result_context(output.id, 10).unwrap();
    let call = before
        .iter()
        .find(|row| row.tool_name.as_deref() == Some("shell"))
        .unwrap();
    assert_eq!(call.native_tool_name.as_deref(), Some("Bash"));
}

#[test]
fn a_claude_search_version_bump_re_extracts_only_claude_sessions() {
    let fixture = Fixture::new();
    fixture.index(&fixture.scope());
    // Every session as extracted before the Claude-only bump.
    rusqlite::Connection::open(&fixture.db_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET search_extractor_version = ?1",
            [CURRENT_EXTRACTOR_VERSION],
        )
        .unwrap();
    let (searched, skipped) =
        reindex_search_content_scoped(&fixture.scope(), &fixture.db_path, |_| {}, || false)
            .unwrap();
    assert_eq!(searched, 2, "both Claude sessions");
    assert_eq!(skipped, fixture.copilot_ids.len(), "no Copilot session");
    assert_eq!(fixture.search("alphazloadedtool"), [CLAUDE_A]);
}

#[test]
fn each_source_prunes_independently() {
    let fixture = Fixture::new();
    fixture.index(&fixture.scope());

    std::fs::remove_file(
        fixture
            .claude_config
            .join("projects/C--work-beta")
            .join(format!("{CLAUDE_B}.jsonl")),
    )
    .unwrap();
    fixture.index(&fixture.scope());
    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A]);
    assert_eq!(fixture.ids("copilot"), fixture.sorted_copilot_ids());
    assert!(fixture.search("betazprompt").is_empty());

    let removed = &fixture.copilot_ids[0];
    std::fs::remove_dir_all(fixture.copilot_root.join(removed)).unwrap();
    fixture.index(&fixture.scope());
    assert!(!fixture.ids("copilot").contains(removed));
    assert_eq!(fixture.ids("copilot").len(), fixture.copilot_ids.len() - 1);
    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A]);
}

#[test]
fn a_missing_root_keeps_its_sources_sessions() {
    let fixture = Fixture::new();
    fixture.index(&fixture.scope());

    assert!(ensure_complete_inventory(&fixture.scope()).is_ok());
    // Claude: the config directory itself is gone (an unmounted drive).
    std::fs::rename(
        &fixture.claude_config,
        fixture.claude_config.with_extension("moved"),
    )
    .unwrap();
    fixture.index(&fixture.scope());
    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A, CLAUDE_B]);
    assert_eq!(fixture.search("alphazprompt"), [CLAUDE_A]);
    // A full rebuild, which deletes the index first, must refuse.
    assert!(ensure_complete_inventory(&fixture.scope()).is_err());

    // Copilot: its session-state directory is gone too. Neither source is
    // pruned.
    std::fs::rename(
        &fixture.copilot_root,
        fixture.copilot_root.with_extension("moved"),
    )
    .unwrap();
    reindex_all_scoped(&fixture.scope(), &fixture.db_path, |_| {}).unwrap();
    assert_eq!(fixture.ids("copilot"), fixture.sorted_copilot_ids());
    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A, CLAUDE_B]);

    // With Claude back, Claude indexes and Copilot's rows stay.
    std::fs::rename(
        fixture.claude_config.with_extension("moved"),
        &fixture.claude_config,
    )
    .unwrap();
    fixture.index(&fixture.scope());
    assert_eq!(fixture.ids("copilot"), fixture.sorted_copilot_ids());
    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A, CLAUDE_B]);
}

/// A provider whose discovery is interrupted part way, as a cancelled or
/// failed scan is.
struct InterruptedDiscovery(ClaudeCodeProvider);

impl SessionProvider for InterruptedDiscovery {
    fn source(&self) -> SessionSource {
        self.0.source()
    }
    fn capabilities(&self) -> SourceCapabilities {
        self.0.capabilities()
    }
    fn discover(&self, _is_cancelled: &dyn Fn() -> bool) -> CoreResult<Vec<SessionLocator>> {
        check_cancelled(&|| true)?;
        unreachable!()
    }
    fn fingerprint(&self, session: &SessionLocator) -> CoreResult<SourceFingerprint> {
        self.0.fingerprint(session)
    }
    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<ProviderSnapshot> {
        self.0.load_snapshot(session, strict, is_cancelled)
    }
    fn liveness(&self, session: &SessionLocator) -> Liveness {
        self.0.liveness(session)
    }
    fn resolve(&self, id: &SessionId) -> CoreResult<Option<SessionLocator>> {
        self.0.resolve(id)
    }
}

#[test]
fn an_interrupted_discovery_skips_only_that_source() {
    let fixture = Fixture::new();
    fixture.index(&fixture.scope());

    // Copilot loses a session in the meantime; it is still pruned.
    let removed = &fixture.copilot_ids[0];
    std::fs::remove_dir_all(fixture.copilot_root.join(removed)).unwrap();
    let mut registry = ProviderRegistry::new();
    registry.register(Arc::new(CopilotProvider::new(&fixture.copilot_root)));
    registry.register(Arc::new(InterruptedDiscovery(ClaudeCodeProvider::new(
        &fixture.claude_config,
    ))));
    fixture.index(&IndexScope::standalone(registry));

    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A, CLAUDE_B]);
    assert_eq!(fixture.search("betazprompt"), [CLAUDE_B]);
    assert!(!fixture.ids("copilot").contains(removed));
}

#[test]
fn a_bumped_generation_stops_only_that_source() {
    let fixture = Fixture::new();
    let generations = Arc::new(SourceGenerations::new());
    let scope = IndexScope::new(fixture.registry(), Arc::clone(&generations));
    generations.bump(SessionSource::ClaudeCode);

    fixture.index(&scope);
    assert!(fixture.ids("claudeCode").is_empty());
    assert_eq!(fixture.ids("copilot"), fixture.sorted_copilot_ids());

    // A stale source is skipped, not a failure, even when it is the only one.
    let mut claude_only = ProviderRegistry::new();
    claude_only.register(Arc::new(ClaudeCodeProvider::new(&fixture.claude_config)));
    let stale_only = IndexScope::new(claude_only, Arc::clone(&generations));
    generations.bump(SessionSource::ClaudeCode);
    assert_eq!(
        reindex_all_scoped(&stale_only, &fixture.db_path, |_| {}).unwrap(),
        0
    );

    // A scope captured after the change indexes it.
    fixture.index(&IndexScope::new(fixture.registry(), generations));
    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A, CLAUDE_B]);
}
