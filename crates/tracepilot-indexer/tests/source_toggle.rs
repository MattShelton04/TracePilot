// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Disabling or moving a source while it is being indexed (README §5,
//! architecture §3.4). The settings change bumps the source's generation,
//! then purges its rows; a pass holding the old configuration must never
//! write any back. Copilot rows are never touched.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, Once};
use std::time::Duration;

use tempfile::TempDir;
use tracepilot_core::error::Result as CoreResult;
use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{
    CopilotProvider, Liveness, ProviderRegistry, ProviderSnapshot, SessionLocator, SessionProvider,
    SessionSource, SourceCapabilities, SourceFingerprint,
};
use tracepilot_indexer::index_db::IndexDb;
use tracepilot_indexer::{
    IndexScope, SearchFilters, SourceGenerations, reindex_all_scoped, reindex_search_content_scoped,
};
use tracepilot_test_support::claude::{OPUS, Transcript, Usage, text};
use tracepilot_test_support::copilot_corpus::write_copilot_corpus;

const CLAUDE_A: &str = "aaaaaaaa-0000-4000-8000-00000000000a";
const CLAUDE_B: &str = "aaaaaaaa-0000-4000-8000-00000000000b";
const CLAUDE_C: &str = "aaaaaaaa-0000-4000-8000-00000000000c";

fn transcript(word: &str) -> Vec<u8> {
    let mut t = Transcript::main();
    t.prompt(&format!("{word} please"));
    t.call(
        "msg_1",
        OPUS,
        vec![text("Done.")],
        Usage::new(5, 100, 0, 10),
        "end_turn",
    );
    t.to_bytes()
}

fn write_claude_root(root: &Path, sessions: &[(&str, &str)]) {
    for (id, word) in sessions {
        let dir = root.join("projects").join("C--work-demo");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{id}.jsonl")), transcript(word)).unwrap();
    }
}

struct Fixture {
    _temp: TempDir,
    copilot_root: PathBuf,
    claude_root: PathBuf,
    db_path: PathBuf,
    generations: Arc<SourceGenerations>,
}

impl Fixture {
    /// Copilot's corpus and Claude sessions A and B, all indexed.
    fn indexed() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let copilot_root = temp.path().join("session-state");
        std::fs::create_dir_all(&copilot_root).unwrap();
        write_copilot_corpus(&copilot_root);
        let claude_root = temp.path().join("claude");
        write_claude_root(
            &claude_root,
            &[(CLAUDE_A, "alphazword"), (CLAUDE_B, "betazword")],
        );
        let fixture = Self {
            db_path: temp.path().join("index.db"),
            _temp: temp,
            copilot_root,
            claude_root,
            generations: Arc::new(SourceGenerations::new()),
        };
        fixture.index(&fixture.scope(claude(&fixture.claude_root)));
        assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A, CLAUDE_B]);
        fixture
    }

    fn scope(&self, claude: Arc<dyn SessionProvider>) -> IndexScope {
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(CopilotProvider::new(&self.copilot_root)));
        registry.register(claude);
        IndexScope::new(registry, Arc::clone(&self.generations))
    }

    fn copilot_scope(&self) -> IndexScope {
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(CopilotProvider::new(&self.copilot_root)));
        IndexScope::new(registry, Arc::clone(&self.generations))
    }

    fn index(&self, scope: &IndexScope) {
        reindex_all_scoped(scope, &self.db_path, |_| {}).unwrap();
        reindex_search_content_scoped(scope, &self.db_path, |_| {}, || false).unwrap();
    }

    /// What disabling Claude Code in Settings does to the index.
    fn disable_claude(&self) {
        self.generations.bump(SessionSource::ClaudeCode);
        let db = IndexDb::open_or_create(&self.db_path).unwrap();
        db.purge_source(SessionSource::ClaudeCode, &|| true)
            .unwrap();
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

    /// Rows of `source`'s sessions in every table keyed by session.
    fn child_rows(&self, source: &str) -> i64 {
        let conn = rusqlite::Connection::open(&self.db_path).unwrap();
        let mut total = 0;
        for table in [
            "search_content",
            "session_model_metrics",
            "session_activity",
        ] {
            total += conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM {table} WHERE session_id IN \
                         (SELECT id FROM sessions WHERE source = ?1)"
                    ),
                    [source],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
        }
        // Orphans would mean a delete that did not cascade.
        total
            + conn
                .query_row(
                    "SELECT COUNT(*) FROM search_content \
                     WHERE session_id NOT IN (SELECT id FROM sessions)",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap()
    }

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

    /// Copilot's ids and child rows, to show a change never touched them.
    fn copilot_state(&self) -> (Vec<String>, i64) {
        (self.ids("copilot"), self.child_rows("copilot"))
    }
}

fn claude(root: &Path) -> Arc<dyn SessionProvider> {
    Arc::new(ClaudeCodeProvider::new(root))
}

/// Claude Code with a settings change injected at one point of a pass.
struct Hooked {
    inner: ClaudeCodeProvider,
    on_discover: Option<Box<dyn Fn() + Send + Sync>>,
    on_load: Option<Box<dyn Fn() + Send + Sync>>,
    after_load: Option<Box<dyn Fn() + Send + Sync>>,
    once: Once,
}

impl Hooked {
    fn on_discover(root: &Path, hook: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            on_discover: Some(Box::new(hook)),
            ..Self::plain(root)
        })
    }

    fn on_load(root: &Path, hook: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            on_load: Some(Box::new(hook)),
            ..Self::plain(root)
        })
    }

    /// Fires once a session has loaded successfully, so its prepared result
    /// is complete when the settings change lands.
    fn after_load(root: &Path, hook: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            after_load: Some(Box::new(hook)),
            ..Self::plain(root)
        })
    }

    fn plain(root: &Path) -> Self {
        Self {
            inner: ClaudeCodeProvider::new(root),
            on_discover: None,
            on_load: None,
            after_load: None,
            once: Once::new(),
        }
    }
}

impl SessionProvider for Hooked {
    fn source(&self) -> SessionSource {
        self.inner.source()
    }
    fn capabilities(&self) -> SourceCapabilities {
        self.inner.capabilities()
    }
    fn discover(&self, is_cancelled: &dyn Fn() -> bool) -> CoreResult<Vec<SessionLocator>> {
        if let Some(hook) = &self.on_discover {
            self.once.call_once(hook);
        }
        self.inner.discover(is_cancelled)
    }
    fn fingerprint(&self, session: &SessionLocator) -> CoreResult<SourceFingerprint> {
        self.inner.fingerprint(session)
    }
    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<ProviderSnapshot> {
        if let Some(hook) = &self.on_load {
            self.once.call_once(hook);
        }
        let snapshot = self.inner.load_snapshot(session, strict, is_cancelled)?;
        if let Some(hook) = &self.after_load {
            self.once.call_once(hook);
        }
        Ok(snapshot)
    }
    fn liveness(&self, session: &SessionLocator) -> Liveness {
        self.inner.liveness(session)
    }
    fn root(&self) -> Option<&Path> {
        self.inner.root()
    }
    fn owns(&self, session: &SessionLocator) -> bool {
        self.inner.owns(session)
    }
    fn resolve(&self, id: &SessionId) -> CoreResult<Option<SessionLocator>> {
        self.inner.resolve(id)
    }
}

/// Claude Code whose sessions all look oversized, so each is its own batch,
/// and whose loads wait until `expected` of them are in flight together.
/// The settings change then lands while they are all being prepared.
struct Concurrent {
    inner: ClaudeCodeProvider,
    expected: usize,
    loads: Mutex<Loads>,
    all_in_flight: Condvar,
    hook: Box<dyn Fn() + Send + Sync>,
    once: Once,
}

/// Loads in flight now, and the most that ever were at once.
#[derive(Default)]
struct Loads {
    in_flight: usize,
    peak: usize,
}

impl Concurrent {
    fn new(root: &Path, expected: usize, hook: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            inner: ClaudeCodeProvider::new(root),
            expected,
            loads: Mutex::default(),
            all_in_flight: Condvar::new(),
            hook: Box::new(hook),
            once: Once::new(),
        })
    }

    /// Whether `expected` loads were in flight at the same time, where the
    /// pipeline's Rayon pool can run two at once.
    fn overlapped(&self) -> bool {
        rayon::current_num_threads() < 2 || self.loads.lock().unwrap().peak >= self.expected
    }
}

impl SessionProvider for Concurrent {
    fn source(&self) -> SessionSource {
        self.inner.source()
    }
    fn capabilities(&self) -> SourceCapabilities {
        self.inner.capabilities()
    }
    fn discover(&self, is_cancelled: &dyn Fn() -> bool) -> CoreResult<Vec<SessionLocator>> {
        let mut sessions = self.inner.discover(is_cancelled)?;
        for session in &mut sessions {
            session.source_bytes_hint = 17 * 1024 * 1024;
        }
        Ok(sessions)
    }
    fn fingerprint(&self, session: &SessionLocator) -> CoreResult<SourceFingerprint> {
        self.inner.fingerprint(session)
    }
    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<ProviderSnapshot> {
        let mut loads = self.loads.lock().unwrap();
        loads.in_flight += 1;
        loads.peak = loads.peak.max(loads.in_flight);
        self.all_in_flight.notify_all();
        // Sequential loads never raise the peak, so they time out here.
        let (loads, _) = self
            .all_in_flight
            .wait_timeout_while(loads, Duration::from_secs(10), |loads| {
                loads.peak < self.expected && rayon::current_num_threads() > 1
            })
            .unwrap();
        drop(loads);
        self.once.call_once(&self.hook);
        let snapshot = self.inner.load_snapshot(session, strict, is_cancelled);
        self.loads.lock().unwrap().in_flight -= 1;
        snapshot
    }
    fn liveness(&self, session: &SessionLocator) -> Liveness {
        self.inner.liveness(session)
    }
    fn root(&self) -> Option<&Path> {
        self.inner.root()
    }
    fn owns(&self, session: &SessionLocator) -> bool {
        self.inner.owns(session)
    }
    fn resolve(&self, id: &SessionId) -> CoreResult<Option<SessionLocator>> {
        self.inner.resolve(id)
    }
}

impl Fixture {
    /// A provider that disables Claude Code once two sessions are in flight.
    fn disable_when_concurrent(&self) -> Arc<Concurrent> {
        let generations = Arc::clone(&self.generations);
        let db_path = self.db_path.clone();
        Concurrent::new(&self.claude_root, 2, move || {
            generations.bump(SessionSource::ClaudeCode);
            IndexDb::open_or_create(&db_path)
                .unwrap()
                .purge_source(SessionSource::ClaudeCode, &|| true)
                .unwrap();
        })
    }
}

#[test]
fn disabling_while_sessions_are_prepared_concurrently_writes_none_back() {
    let fixture = Fixture::indexed();
    let copilot = fixture.copilot_state();
    write_claude_root(&fixture.claude_root, &[(CLAUDE_C, "gammazword")]);

    let provider = fixture.disable_when_concurrent();
    reindex_all_scoped(&fixture.scope(provider.clone()), &fixture.db_path, |_| {}).unwrap();
    assert!(
        provider.overlapped(),
        "the sessions were not prepared together"
    );

    assert!(fixture.ids("claudeCode").is_empty());
    assert_eq!(fixture.child_rows("claudeCode"), 0);
    assert_eq!(fixture.copilot_state(), copilot);
}

#[test]
fn disabling_while_search_content_is_prepared_concurrently_writes_none_back() {
    let fixture = Fixture::indexed();
    let copilot = fixture.copilot_state();
    // Three sessions whose search content is stale.
    write_claude_root(
        &fixture.claude_root,
        &[
            (CLAUDE_A, "alphazedited"),
            (CLAUDE_B, "betazedited"),
            (CLAUDE_C, "gammazword"),
        ],
    );
    let scope = fixture.scope(claude(&fixture.claude_root));
    reindex_all_scoped(&scope, &fixture.db_path, |_| {}).unwrap();

    let provider = fixture.disable_when_concurrent();
    let scope = fixture.scope(provider.clone());
    reindex_search_content_scoped(&scope, &fixture.db_path, |_| {}, || false).unwrap();
    assert!(
        provider.overlapped(),
        "the sessions were not prepared together"
    );

    assert!(fixture.ids("claudeCode").is_empty());
    assert_eq!(fixture.child_rows("claudeCode"), 0);
    for word in ["alphazword", "alphazedited", "betazedited", "gammazword"] {
        assert!(fixture.search(word).is_empty(), "{word}");
    }
    assert_eq!(fixture.copilot_state(), copilot);
}

#[test]
fn disabling_once_search_content_is_prepared_writes_none_back() {
    let fixture = Fixture::indexed();
    let copilot = fixture.copilot_state();
    write_claude_root(
        &fixture.claude_root,
        &[(CLAUDE_A, "alphazedited"), (CLAUDE_B, "betazedited")],
    );
    let scope = fixture.scope(claude(&fixture.claude_root));
    reindex_all_scoped(&scope, &fixture.db_path, |_| {}).unwrap();

    // The first session loads in full, so a complete prepared batch is
    // waiting to be written when Claude Code is disabled.
    let generations = Arc::clone(&fixture.generations);
    let db_path = fixture.db_path.clone();
    let scope = fixture.scope(Hooked::after_load(&fixture.claude_root, move || {
        generations.bump(SessionSource::ClaudeCode);
        IndexDb::open_or_create(&db_path)
            .unwrap()
            .purge_source(SessionSource::ClaudeCode, &|| true)
            .unwrap();
    }));
    let (indexed, _) =
        reindex_search_content_scoped(&scope, &fixture.db_path, |_| {}, || false).unwrap();

    assert_eq!(indexed, 0);
    assert!(fixture.ids("claudeCode").is_empty());
    assert_eq!(fixture.child_rows("claudeCode"), 0);
    for word in ["alphazword", "alphazedited", "betazedited"] {
        assert!(fixture.search(word).is_empty(), "{word}");
    }
    assert_eq!(fixture.copilot_state(), copilot);
}

#[test]
fn disabling_while_a_batch_is_open_leaves_no_rows_behind() {
    let fixture = Fixture::indexed();
    let copilot = fixture.copilot_state();
    let scope = fixture.scope(claude(&fixture.claude_root));

    // Disable from another thread while a Claude batch transaction holds
    // the write lock: the purge waits for that batch, which sees the bumped
    // generation before committing and rolls back.
    let purge = std::sync::Mutex::new(None);
    reindex_all_scoped(&scope, &fixture.db_path, |progress| {
        let claude_batch = progress
            .source
            .as_ref()
            .is_some_and(|source| source.source == SessionSource::ClaudeCode)
            && progress.session_info.is_some();
        let mut purge = purge.lock().unwrap();
        if claude_batch && purge.is_none() {
            fixture.generations.bump(SessionSource::ClaudeCode);
            let db_path = fixture.db_path.clone();
            *purge = Some(std::thread::spawn(move || {
                IndexDb::open_or_create(&db_path)
                    .unwrap()
                    .purge_source(SessionSource::ClaudeCode, &|| true)
                    .unwrap()
            }));
        }
    })
    .unwrap();
    let purged = purge.into_inner().unwrap().expect("disabled mid-batch");
    assert_eq!(purged.join().unwrap(), 2, "the committed rows were purged");
    // The search pass that follows holds the same stale scope.
    reindex_search_content_scoped(&scope, &fixture.db_path, |_| {}, || false).unwrap();

    assert!(fixture.ids("claudeCode").is_empty());
    assert_eq!(fixture.child_rows("claudeCode"), 0);
    assert!(fixture.search("alphazword").is_empty());
    assert_eq!(fixture.copilot_state(), copilot);
}

#[test]
fn a_root_change_during_indexing_keeps_only_the_new_root() {
    let fixture = Fixture::indexed();
    let copilot = fixture.copilot_state();
    let new_root = fixture.claude_root.with_file_name("claude-new");
    write_claude_root(&new_root, &[(CLAUDE_C, "gammazword")]);
    // Old-root sessions changed on disk, so the old pass rewrites them.
    write_claude_root(
        &fixture.claude_root,
        &[(CLAUDE_A, "alphazedited"), (CLAUDE_B, "betazedited")],
    );

    // The move lands while the old pass is loading its first session.
    let generations = Arc::clone(&fixture.generations);
    let db_path = fixture.db_path.clone();
    let old = fixture.scope(Hooked::on_load(&fixture.claude_root, move || {
        generations.bump(SessionSource::ClaudeCode);
        IndexDb::open_or_create(&db_path)
            .unwrap()
            .purge_source(SessionSource::ClaudeCode, &|| true)
            .unwrap();
    }));
    fixture.index(&old);
    assert!(fixture.ids("claudeCode").is_empty());

    // The enable half: a pass captured after the move indexes the new root.
    fixture.index(&fixture.scope(claude(&new_root)));
    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_C]);
    assert_eq!(fixture.search("gammazword"), [CLAUDE_C]);
    for word in ["alphazword", "alphazedited", "betazedited"] {
        assert!(fixture.search(word).is_empty(), "{word}");
    }
    assert_eq!(fixture.copilot_state(), copilot);
}

#[test]
fn a_disable_that_interrupts_discovery_writes_nothing_back() {
    let fixture = Fixture::indexed();
    let copilot = fixture.copilot_state();
    // Settings change while Claude's root is being listed: the scan sees
    // the stale generation and stops, so the source is neither indexed nor
    // pruned by this pass.
    let generations = Arc::clone(&fixture.generations);
    let db_path = fixture.db_path.clone();
    let scope = fixture.scope(Hooked::on_discover(&fixture.claude_root, move || {
        generations.bump(SessionSource::ClaudeCode);
        IndexDb::open_or_create(&db_path)
            .unwrap()
            .purge_source(SessionSource::ClaudeCode, &|| true)
            .unwrap();
    }));
    fixture.index(&scope);

    assert!(fixture.ids("claudeCode").is_empty());
    assert_eq!(fixture.child_rows("claudeCode"), 0);
    assert_eq!(fixture.copilot_state(), copilot);
}

#[test]
fn an_unreadable_root_is_skipped_and_still_purged_on_disable() {
    let fixture = Fixture::indexed();
    let copilot = fixture.copilot_state();
    // The configured folder becomes a file: discovery fails, and the
    // source keeps its rows rather than being pruned against nothing.
    let moved = fixture.claude_root.with_extension("moved");
    std::fs::rename(&fixture.claude_root, &moved).unwrap();
    std::fs::write(&fixture.claude_root, b"not a directory").unwrap();
    fixture.index(&fixture.scope(claude(&fixture.claude_root)));
    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A, CLAUDE_B]);
    assert_eq!(fixture.copilot_state(), copilot);

    // Disabling needs no readable root.
    fixture.disable_claude();
    fixture.index(&fixture.copilot_scope());
    assert!(fixture.ids("claudeCode").is_empty());
    assert_eq!(fixture.child_rows("claudeCode"), 0);
    assert_eq!(fixture.copilot_state(), copilot);

    // Enabling an unreadable root indexes nothing and fails nothing.
    fixture.generations.bump(SessionSource::ClaudeCode);
    fixture.index(&fixture.scope(claude(&fixture.claude_root)));
    assert!(fixture.ids("claudeCode").is_empty());
    assert_eq!(fixture.copilot_state(), copilot);
}

#[test]
fn a_stale_purge_rolls_back() {
    let fixture = Fixture::indexed();
    let db = IndexDb::open_or_create(&fixture.db_path).unwrap();
    assert!(
        db.purge_source(SessionSource::ClaudeCode, &|| false)
            .is_err()
    );
    assert_eq!(fixture.ids("claudeCode"), [CLAUDE_A, CLAUDE_B]);
    assert_eq!(
        db.purge_source(SessionSource::ClaudeCode, &|| true)
            .unwrap(),
        2
    );
    assert_eq!(
        db.purge_source(SessionSource::ClaudeCode, &|| true)
            .unwrap(),
        0
    );
}
