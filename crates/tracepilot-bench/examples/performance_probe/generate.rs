use std::path::Path;

use tracepilot_indexer::reindex_all;

use super::events::write_events;
use super::model::{
    AnyError, FIXTURE_VERSION, FixtureManifest, MANIFEST_FILE, MARKER_FILE, ManifestSession,
    ManifestTotals, SEARCH_SENTINEL, STRESS_LABEL, Scale, StableSentinels,
};
use super::plan::{MASSIVE_MAX_SESSION_BYTES, MASSIVE_MIN_SOURCE_BYTES, SessionSpec, build_specs};
use super::validate::{count_files, create_new_json, create_new_text, fail};

pub(super) fn generate_corpus(root: &Path, scale: Scale) -> Result<FixtureManifest, AnyError> {
    ensure_empty_target(root)?;
    std::fs::create_dir_all(root)?;
    create_new_text(
        &root.join(MARKER_FILE),
        &format!("tracepilot-performance-corpus\nfixture-version={FIXTURE_VERSION}\n"),
    )?;

    let sessions_root = root.join("copilot").join("session-state");
    let tracepilot_root = root.join("tracepilot");
    std::fs::create_dir_all(&sessions_root)?;
    std::fs::create_dir_all(&tracepilot_root)?;

    let specs = build_specs(scale)?;
    let mut sessions = Vec::with_capacity(specs.len());
    for (index, spec) in specs.iter().enumerate() {
        let session_dir = sessions_root.join(&spec.id);
        std::fs::create_dir(&session_dir)?;
        create_new_text(
            &session_dir.join("workspace.yaml"),
            &workspace_yaml(spec, index),
        )?;
        let stats = write_events(&session_dir.join("events.jsonl"), spec, index)?;
        if matches!(scale, Scale::Massive) && stats.source_bytes > MASSIVE_MAX_SESSION_BYTES {
            return fail(format!(
                "massive session {} was {} bytes; limit is {}",
                spec.id, stats.source_bytes, MASSIVE_MAX_SESSION_BYTES
            ));
        }
        sessions.push(ManifestSession {
            id: spec.id.clone(),
            title: spec.title.clone(),
            profile: spec.profile.to_string(),
            event_count: spec.event_count,
            turn_count: spec.turn_count,
            tool_call_count: spec.tool_call_count,
            expected_search_matches: spec.turn_count,
            stress_bytes: stats.stress_bytes,
            source_bytes: stats.source_bytes,
        });
    }

    let source_bytes = sessions.iter().map(|session| session.source_bytes).sum();
    if matches!(scale, Scale::Massive) && source_bytes < MASSIVE_MIN_SOURCE_BYTES {
        return fail(format!(
            "massive corpus was {source_bytes} source bytes; minimum is {MASSIVE_MIN_SOURCE_BYTES}"
        ));
    }

    create_new_text(&tracepilot_root.join("config.toml"), &config_toml(root))?;
    initialize_index(scale, &sessions_root, &tracepilot_root, sessions.len())?;

    // SQLite schema migrations retain versioned safety backups. Count the
    // files actually produced by this fixture version, plus the manifest that
    // is written immediately below, rather than assuming only one DB file.
    let generated_file_count = count_files(root)? + 1;
    let totals = ManifestTotals {
        session_count: sessions.len(),
        event_count: sessions.iter().map(|s| s.event_count).sum(),
        turn_count: sessions.iter().map(|s| s.turn_count).sum(),
        tool_call_count: sessions.iter().map(|s| s.tool_call_count).sum(),
        expected_search_matches: sessions.iter().map(|s| s.expected_search_matches).sum(),
        stress_bytes: sessions.iter().map(|s| s.stress_bytes).sum(),
        source_bytes,
        file_count: generated_file_count,
    };
    let manifest = FixtureManifest {
        fixture_version: FIXTURE_VERSION,
        generator: "tracepilot-bench/performance_probe".to_string(),
        scale: scale.name().to_string(),
        root: root.to_string_lossy().to_string(),
        stable_sentinels: StableSentinels {
            search_term: SEARCH_SENTINEL.to_string(),
            stress_label: STRESS_LABEL.to_string(),
        },
        sessions,
        totals,
    };
    create_new_json(&root.join(MANIFEST_FILE), &manifest)?;

    let actual_files = count_files(root)?;
    if actual_files != manifest.totals.file_count {
        return fail(format!(
            "generated file count {actual_files} did not match manifest {}",
            manifest.totals.file_count
        ));
    }
    Ok(manifest)
}

fn initialize_index(
    scale: Scale,
    sessions_root: &Path,
    tracepilot_root: &Path,
    session_count: usize,
) -> Result<(), AnyError> {
    let db_path = tracepilot_root.join("index.db");
    if matches!(scale, Scale::Massive) {
        // Keep massive generation bounded to a single event/output buffer.
        // The real app or `probe` command owns the intentionally expensive
        // schema migration, full indexing, and search indexing passes.
        return Ok(());
    }

    let indexed = reindex_all(sessions_root, &db_path)?;
    if indexed != session_count {
        return fail(format!(
            "initial full index handled {indexed} sessions, expected {session_count}"
        ));
    }
    let (search_indexed, search_skipped) =
        tracepilot_indexer::reindex_search_content(sessions_root, &db_path, |_| {}, || false)?;
    if (search_indexed, search_skipped) != (session_count, 0) {
        return fail(format!(
            "initial search index result was ({search_indexed}, {search_skipped}), expected ({session_count}, 0)"
        ));
    }
    Ok(())
}

fn ensure_empty_target(root: &Path) -> Result<(), AnyError> {
    if !root.exists() {
        return Ok(());
    }
    if !root.is_dir() {
        return fail(format!(
            "target exists and is not a directory: {}",
            root.display()
        ));
    }
    if std::fs::read_dir(root)?.next().is_some() {
        return fail(format!(
            "refusing to overwrite non-empty target; choose a new corpus root: {}",
            root.display()
        ));
    }
    Ok(())
}

fn workspace_yaml(spec: &SessionSpec, index: usize) -> String {
    let day = index % 28 + 1;
    format!(
        "id: {}\nname: {:?}\nuser_named: false\nsummary_count: 0\ncwd: C:/synthetic/tracepilot-workload\ngit_root: C:/synthetic/tracepilot-workload\nrepository: github.com/example/tracepilot-synthetic\nbranch: perf-fixture\nhost_type: cli\ncreated_at: \"2026-01-{day:02}T08:00:00Z\"\nupdated_at: \"2026-01-{day:02}T09:00:00Z\"\n",
        spec.id, spec.title
    )
}

fn config_toml(root: &Path) -> String {
    let copilot_home = root.join("copilot");
    let sessions = copilot_home.join("session-state");
    let tracepilot_home = root.join("tracepilot");
    let index = tracepilot_home.join("index.db");
    format!(
        "version = 11\n\n[paths]\ncopilotHome = {}\ntracepilotHome = {}\nsessionStateDir = {}\nindexDbPath = {}\n\n[general]\nautoIndexOnLaunch = false\ncliCommand = \"copilot\"\nsetupComplete = true\n\n[ui]\ntheme = \"dark\"\nhideEmptySessions = true\nautoRefreshEnabled = false\nautoRefreshIntervalSeconds = 5\ncheckForUpdates = false\nfavouriteModels = []\nrecentRepoPaths = []\ncontentMaxWidth = 1600\nuiScale = 1.0\n\n[features]\nexportView = false\nsessionReplay = false\nrenderMarkdown = true\nmcpServers = false\nskills = true\ncopilotSdk = false\nexactContextCapture = false\nconfigInjector = false\npromptCacheInsights = true\nagents = true\n",
        toml_string(&copilot_home),
        toml_string(&tracepilot_home),
        toml_string(&sessions),
        toml_string(&index)
    )
}

fn toml_string(path: &Path) -> String {
    serde_json::to_string(&path.to_string_lossy()).unwrap_or_else(|_| "\"\"".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn massive_initialization_leaves_database_for_native_first_setup() {
        let root = tempfile::tempdir().unwrap();
        let sessions_root = root.path().join("copilot").join("session-state");
        let tracepilot_root = root.path().join("tracepilot");
        std::fs::create_dir_all(&sessions_root).unwrap();
        std::fs::create_dir_all(&tracepilot_root).unwrap();

        initialize_index(Scale::Massive, &sessions_root, &tracepilot_root, 500).unwrap();

        assert!(!tracepilot_root.join("index.db").exists());
        assert!(!tracepilot_root.join("backups").exists());
    }
}
