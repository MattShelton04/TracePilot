//! Config readers and `SessionListItem` constructors.

use crate::config::{SharedConfig, TracePilotConfig};
use crate::error::CmdResult;
use crate::providers::registry_for;
use crate::types::{ProviderRunState, SessionListItem};
use std::path::{Path, PathBuf};
use tracepilot_core::SessionId;
use tracepilot_core::provider::{Liveness, ProviderRegistry, SessionLocator, SessionRole};
use tracepilot_indexer::index_db::IndexedSession;

/// Read config from shared state, falling back to defaults.
pub(crate) fn read_config(state: &SharedConfig) -> TracePilotConfig {
    match state.read() {
        Ok(guard) => guard.clone().unwrap_or_default(),
        Err(poisoned) => {
            tracing::error!("Config RwLock poisoned — recovering inner value");
            poisoned.into_inner().clone().unwrap_or_default()
        }
    }
}

pub(crate) fn summary_to_list_item(
    summary: tracepilot_core::SessionSummary,
    session_path: &Path,
) -> SessionListItem {
    // The disk-scan fallback lists Copilot sessions only, whose liveness is
    // this lock-file check.
    let is_running = tracepilot_core::session::discovery::has_lock_file(session_path);
    SessionListItem {
        id: SessionId::from_validated(summary.id),
        // The disk-scan fallback only discovers Copilot sessions.
        source: tracepilot_core::provider::SessionSource::Copilot,
        metrics_status: None,
        summary: summary.summary,
        repository: summary.repository,
        branch: summary.branch,
        cwd: summary.cwd,
        host_type: summary.host_type,
        created_at: summary.created_at.map(|d| d.to_rfc3339()),
        updated_at: summary.updated_at.map(|d| d.to_rfc3339()),
        event_count: summary.event_count,
        turn_count: summary.turn_count,
        current_model: summary.current_model.or_else(|| {
            summary
                .shutdown_metrics
                .as_ref()
                .and_then(|metrics| metrics.current_model.clone())
        }),
        copilot_version: None,
        is_running,
        run_state: None,
        error_count: None,
        rate_limit_count: None,
        compaction_count: None,
        truncation_count: None,
    }
}

pub(crate) fn load_summary_list_item(session_path: &Path) -> CmdResult<SessionListItem> {
    let summary = tracepilot_core::summary::load_session_summary(session_path)?;
    Ok(summary_to_list_item(summary, session_path))
}

fn maybe_i64_to_usize(value: Option<i64>) -> Option<usize> {
    value.and_then(|v| usize::try_from(v).ok())
}

/// List items for index rows. Each row's running state comes from its
/// source's provider, asked once for all of that source's rows; a row whose
/// source is not enabled is not running.
pub(crate) fn indexed_sessions_to_list_items(
    config: &TracePilotConfig,
    sessions: Vec<IndexedSession>,
) -> Vec<SessionListItem> {
    let liveness = indexed_liveness(&registry_for(config), &sessions);
    sessions
        .into_iter()
        .zip(liveness)
        .map(|(session, liveness)| indexed_session_to_list_item(session, liveness))
        .collect()
}

fn indexed_liveness(registry: &ProviderRegistry, sessions: &[IndexedSession]) -> Vec<Liveness> {
    let mut liveness = vec![Liveness::Idle; sessions.len()];
    for provider in registry.providers() {
        let (rows, locators): (Vec<usize>, Vec<SessionLocator>) = sessions
            .iter()
            .enumerate()
            .filter(|(_, session)| session.source == provider.source())
            .map(|(row, session)| (row, row_locator(session)))
            .unzip();
        if rows.is_empty() {
            continue;
        }
        for (row, state) in rows.into_iter().zip(provider.liveness_many(&locators)) {
            liveness[row] = state;
        }
    }
    liveness
}

/// The locator an index row names. Liveness needs only its source, id and
/// path; the path is the one the list read before providers existed.
fn row_locator(session: &IndexedSession) -> SessionLocator {
    SessionLocator {
        source: session.source,
        id: SessionId::from_validated(session.id.clone()),
        primary_path: PathBuf::from(&session.path),
        parent_id: None,
        role: SessionRole::Primary,
        source_bytes_hint: 0,
    }
}

fn indexed_session_to_list_item(session: IndexedSession, liveness: Liveness) -> SessionListItem {
    let (is_running, run_state) = match liveness {
        Liveness::Running { status, .. } => (
            true,
            status.map(|run_status| ProviderRunState { run_status }),
        ),
        Liveness::Idle | Liveness::Unknown => (false, None),
    };
    SessionListItem {
        id: SessionId::from_validated(session.id),
        source: session.source,
        metrics_status: session
            .metrics_partial
            .map(|metrics_partial| crate::types::ProviderMetricsStatus { metrics_partial }),
        summary: session.summary,
        repository: session.repository,
        branch: session.branch,
        cwd: session.cwd,
        host_type: session.host_type,
        created_at: session.created_at,
        updated_at: session.updated_at,
        event_count: maybe_i64_to_usize(session.event_count),
        turn_count: maybe_i64_to_usize(session.turn_count),
        current_model: session.current_model,
        copilot_version: session.copilot_version,
        is_running,
        run_state,
        error_count: maybe_i64_to_usize(session.error_count),
        rate_limit_count: maybe_i64_to_usize(session.rate_limit_count),
        compaction_count: maybe_i64_to_usize(session.compaction_count),
        truncation_count: maybe_i64_to_usize(session.truncation_count),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
    use tracepilot_core::provider::{CopilotProvider, SessionSource};

    const RUNNING: &str = "11111111-1111-4111-8111-111111111111";
    const REUSED_PID: &str = "22222222-2222-4222-8222-222222222222";
    const GONE_PID: &str = "33333333-3333-4333-8333-333333333333";
    const COPILOT: &str = "44444444-4444-4444-8444-444444444444";
    /// Never a Windows pid (those are multiples of 4) and above Linux's limit.
    const DEAD_PID: u32 = 4_294_967_291;

    fn row(source: SessionSource, id: &str, path: &Path) -> IndexedSession {
        IndexedSession {
            id: id.to_string(),
            path: path.display().to_string(),
            summary: None,
            repository: None,
            branch: None,
            cwd: None,
            host_type: None,
            created_at: None,
            updated_at: None,
            event_count: None,
            turn_count: None,
            current_model: None,
            copilot_version: None,
            error_count: None,
            rate_limit_count: None,
            compaction_count: None,
            truncation_count: None,
            source,
            metrics_partial: None,
        }
    }

    /// `sessions/<name>.json`. Claude Code names it after the pid; a stale
    /// file left by an earlier process with a reused pid needs another name.
    fn write_pid_file(config_dir: &Path, name: &str, pid: u32, session: &str, started: &str) {
        let dir = config_dir.join("sessions");
        std::fs::create_dir_all(&dir).unwrap();
        let record = serde_json::json!({"pid": pid, "sessionId": session,
            "procStart": started, "status": "busy", "kind": "interactive"});
        std::fs::write(dir.join(format!("{name}.json")), record.to_string()).unwrap();
    }

    /// A running session (this test process), a stale file whose pid now
    /// belongs to another process start, and one whose process is gone.
    fn claude_fixture(started: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let own = std::process::id();
        write_pid_file(dir.path(), &own.to_string(), own, RUNNING, started);
        write_pid_file(dir.path(), "earlier", own, REUSED_PID, "1");
        write_pid_file(
            dir.path(),
            &DEAD_PID.to_string(),
            DEAD_PID,
            GONE_PID,
            started,
        );
        dir
    }

    fn claude_rows(dir: &Path) -> Vec<IndexedSession> {
        [RUNNING, REUSED_PID, GONE_PID]
            .iter()
            .map(|id| {
                row(
                    SessionSource::ClaudeCode,
                    id,
                    &dir.join(format!("{id}.jsonl")),
                )
            })
            .collect()
    }

    fn items(registry: &ProviderRegistry, rows: Vec<IndexedSession>) -> Vec<serde_json::Value> {
        let liveness = indexed_liveness(registry, &rows);
        rows.into_iter()
            .zip(liveness)
            .map(|(row, liveness)| {
                serde_json::to_value(indexed_session_to_list_item(row, liveness)).unwrap()
            })
            .collect()
    }

    fn running(item: &serde_json::Value) -> (bool, Option<&str>) {
        (
            item["isRunning"].as_bool().unwrap(),
            item.get("runStatus").map(|status| status.as_str().unwrap()),
        )
    }

    #[test]
    fn claude_rows_are_running_only_with_a_verified_pid_file() {
        let own = std::process::id();
        let dir = claude_fixture("134000000000000000");
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(
            ClaudeCodeProvider::new(dir.path()).with_process_start(Arc::new(move |pid| {
                (pid == own).then(|| "134000000000000000".to_string())
            })),
        ));
        let listed = items(&registry, claude_rows(dir.path()));
        let states: Vec<_> = listed.iter().map(running).collect();
        assert_eq!(
            states,
            [(true, Some("busy")), (false, None), (false, None)],
            "running, pid reused, pid gone"
        );
    }

    #[test]
    fn copilot_rows_take_running_state_from_the_lock_file() {
        let root = tempfile::tempdir().unwrap();
        let session = root.path().join(COPILOT);
        std::fs::create_dir_all(&session).unwrap();
        std::fs::write(session.join("events.jsonl"), "").unwrap();
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(CopilotProvider::new(root.path())));
        // A Claude pid file naming the same id must not matter to Copilot.
        let claude = claude_fixture("1");
        write_pid_file(claude.path(), "8", 8, COPILOT, "1");
        registry.register(Arc::new(
            ClaudeCodeProvider::new(claude.path()).with_process_start(Arc::new(|_| None)),
        ));
        let rows = || vec![row(SessionSource::Copilot, COPILOT, &session)];

        let idle = items(&registry, rows());
        assert_eq!(running(&idle[0]), (false, None));
        std::fs::write(session.join("inuse.4242.lock"), "").unwrap();
        assert!(tracepilot_core::session::discovery::has_lock_file(&session));
        let live = items(&registry, rows());
        assert_eq!(running(&live[0]), (true, None));
        assert!(
            live[0].get("runStatus").is_none(),
            "Copilot wire output unchanged"
        );
    }

    #[test]
    fn rows_of_a_disabled_source_are_not_running() {
        let dir = claude_fixture("1");
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(CopilotProvider::new(dir.path())));
        let listed = items(&registry, claude_rows(dir.path()));
        assert!(listed.iter().all(|item| running(item) == (false, None)));
    }

    /// The app's own lookup, through `registry_for`, against this process.
    #[test]
    fn the_app_registry_verifies_pid_files_against_real_processes() {
        let own = std::process::id();
        let started = tracepilot_orchestrator::process::process_start_time(own).unwrap();
        let dir = claude_fixture(&started);
        let mut config = TracePilotConfig::default();
        config.features.claude_code_sessions = true;
        config.sources.claude_code.config_dir = dir.path().display().to_string();
        let listed = indexed_sessions_to_list_items(&config, claude_rows(dir.path()));
        let states: Vec<_> = listed
            .iter()
            .map(|item| {
                (
                    item.is_running,
                    item.run_state.as_ref().map(|s| s.run_status),
                )
            })
            .collect();
        use tracepilot_core::provider::RunStatus;
        assert_eq!(
            states,
            [(true, Some(RunStatus::Busy)), (false, None), (false, None)]
        );
    }

    #[test]
    fn provider_status_is_flattened_and_absent_from_copilot_wire_output() {
        let summary = serde_json::from_value(serde_json::json!({"id":"synthetic"})).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut item = summary_to_list_item(summary, dir.path());
        let copilot = serde_json::to_value(&item).unwrap();
        assert!(copilot.get("metricsPartial").is_none());
        assert!(copilot.get("metricsStatus").is_none());
        item.metrics_status = Some(crate::types::ProviderMetricsStatus {
            metrics_partial: true,
        });
        let claude = serde_json::to_value(&item).unwrap();
        assert_eq!(
            claude.get("metricsPartial"),
            Some(&serde_json::Value::Bool(true))
        );
        assert!(claude.get("metricsStatus").is_none());
    }
}
