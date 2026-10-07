//! Enabling, disabling and moving Claude Code through a settings change.

use super::*;
use crate::providers::registry_for;
use std::path::Path;
use std::sync::{Arc, RwLock};
use tracepilot_core::provider::SessionSource;
use tracepilot_indexer::IndexScope;
use tracepilot_indexer::index_db::IndexDb;

const COPILOT: &str = "cccccccc-0000-4000-8000-000000000001";
const CLAUDE: &str = "aaaaaaaa-0000-4000-8000-000000000001";

fn configured(root: &Path) -> TracePilotConfig {
    let mut config = TracePilotConfig::default();
    config.paths.copilot_home = root.join("copilot").to_string_lossy().into();
    config.paths.session_state_dir = root.join("copilot/session-state").to_string_lossy().into();
    config.paths.tracepilot_home = root.join("tracepilot").to_string_lossy().into();
    config.sources.claude_code.config_dir = root.join("claude").to_string_lossy().into();
    config.features.claude_code_sessions = true;
    std::fs::create_dir_all(&config.paths.tracepilot_home).unwrap();
    config.normalize_paths();
    config
}

fn insert(index: &Path, id: &str, source: &str) {
    IndexDb::open_or_create(index).unwrap();
    let conn = rusqlite::Connection::open(index).unwrap();
    conn.execute(
        "INSERT INTO sessions (id, path, source) VALUES (?1, ?2, ?3)",
        [id, &format!("/sessions/{id}"), source],
    )
    .unwrap();
}

fn ids(index: &Path) -> Vec<(String, String)> {
    let conn = rusqlite::Connection::open(index).unwrap();
    let mut stmt = conn
        .prepare("SELECT source, id FROM sessions ORDER BY source, id")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

fn row(source: &str, id: &str) -> (String, String) {
    (source.to_string(), id.to_string())
}

struct Harness {
    temp: tempfile::TempDir,
    state: SharedConfig,
    gates: Arc<IndexingSemaphores>,
    coordinator: ConfigCoordinator,
}

impl Harness {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let config = configured(temp.path());
        insert(&config.index_db_path(), COPILOT, "copilot");
        insert(&config.index_db_path(), CLAUDE, "claudeCode");
        Self {
            state: Arc::new(RwLock::new(Some(config))),
            temp,
            gates: Arc::new(IndexingSemaphores::new()),
            coordinator: ConfigCoordinator::default(),
        }
    }

    fn index(&self) -> std::path::PathBuf {
        self.state.read().unwrap().as_ref().unwrap().index_db_path()
    }

    /// A pass that captured the published configuration.
    fn pass(&self) -> IndexScope {
        let config = self.state.read().unwrap().clone().unwrap();
        IndexScope::new(
            registry_for(&config),
            Arc::clone(self.gates.jobs().source_generations()),
        )
    }

    async fn patch(&self, json: serde_json::Value) -> SourceChanges {
        let path = self.temp.path().join("config.toml");
        mutate_config(
            &self.state,
            Arc::clone(&self.gates),
            &self.coordinator,
            ConfigMutation::Patch(serde_json::from_value(json).unwrap()),
            move |config| config.save_to(&path),
        )
        .await
        .unwrap()
        .sources
    }
}

#[tokio::test]
async fn disabling_invalidates_running_passes_then_purges_only_its_rows() {
    let harness = Harness::new();
    let running = harness.pass();

    let changes = harness
        .patch(serde_json::json!({"features": {"claudeCodeSessions": false}}))
        .await;
    assert!(changes.purged_any());
    assert_eq!(changes.to_reindex().count(), 0);

    assert!(!running.is_current(SessionSource::ClaudeCode));
    assert!(running.is_current(SessionSource::Copilot));
    assert_eq!(ids(&harness.index()), [row("copilot", COPILOT)]);
    let published = harness.state.read().unwrap().clone().unwrap();
    assert!(!published.features.claude_code_sessions);
    assert_eq!(registry_for(&published).providers().len(), 1);
}

#[tokio::test]
async fn moving_the_folder_purges_and_reindexes_while_enabling_never_deletes() {
    let harness = Harness::new();
    let running = harness.pass();
    let moved = harness.temp.path().join("claude-elsewhere");
    std::fs::create_dir(&moved).unwrap();

    let changes = harness
        .patch(serde_json::json!({"sources": {"claudeCode": {"configDir": moved}}}))
        .await;
    assert!(changes.purged_any());
    assert_eq!(
        changes.to_reindex().collect::<Vec<_>>(),
        [SessionSource::ClaudeCode]
    );
    assert!(!running.is_current(SessionSource::ClaudeCode));
    assert_eq!(ids(&harness.index()), [row("copilot", COPILOT)]);

    // Off, then on: the enable bumps the generation but deletes nothing.
    harness
        .patch(serde_json::json!({"features": {"claudeCodeSessions": false}}))
        .await;
    insert(&harness.index(), CLAUDE, "claudeCode");
    let before_enable = harness.pass();
    let changes = harness
        .patch(serde_json::json!({"features": {"claudeCodeSessions": true}}))
        .await;
    assert!(!changes.purged_any());
    assert_eq!(changes.to_reindex().count(), 1);
    assert!(!before_enable.is_current(SessionSource::ClaudeCode));
    assert_eq!(ids(&harness.index()).len(), 2);
}

#[tokio::test]
async fn a_folder_that_fails_validation_is_not_saved() {
    let harness = Harness::new();
    let running = harness.pass();
    let missing = harness.temp.path().join("missing");
    let result = mutate_config(
        &harness.state,
        Arc::clone(&harness.gates),
        &harness.coordinator,
        ConfigMutation::Patch(
            serde_json::from_value(
                serde_json::json!({"sources": {"claudeCode": {"configDir": missing}}}),
            )
            .unwrap(),
        ),
        |_| panic!("an invalid folder must not be persisted"),
    )
    .await;
    assert!(matches!(result, Err(BindingsError::Validation(_))));
    assert!(running.is_current(SessionSource::ClaudeCode));
    assert_eq!(ids(&harness.index()).len(), 2);
}

#[tokio::test]
async fn unrelated_changes_leave_sources_alone() {
    let harness = Harness::new();
    let running = harness.pass();
    let changes = harness
        .patch(serde_json::json!({"ui": {"theme": "light"}}))
        .await;
    assert!(changes.is_empty());
    assert!(running.is_current(SessionSource::ClaudeCode));
    assert_eq!(ids(&harness.index()).len(), 2);
}
