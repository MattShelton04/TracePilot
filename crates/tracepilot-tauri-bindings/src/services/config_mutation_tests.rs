use super::*;
use std::path::Path;
use std::sync::{Arc, RwLock};

fn configured(root: &Path) -> TracePilotConfig {
    let mut config = TracePilotConfig::default();
    config.paths.copilot_home = root.join("copilot").to_string_lossy().into();
    config.paths.session_state_dir = root.join("copilot/session-state").to_string_lossy().into();
    config.paths.tracepilot_home = root.join("tracepilot").to_string_lossy().into();
    std::fs::create_dir_all(&config.paths.tracepilot_home).unwrap();
    config.normalize_paths();
    config
}

#[test]
fn failed_migration_copy_never_publishes_a_partial_file_and_can_retry() {
    use std::io::Write;
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("request.json");
    let target = temp.path().join("migrated/request.json");
    std::fs::write(&source, br#"{"messages":[]}"#).unwrap();
    let error = copy_file_if_absent_with(&source, &target, |_, file| {
        file.write_all(b"{")?;
        Err(std::io::Error::other("injected interrupted copy"))
    });
    assert!(error.is_err());
    assert!(!target.exists());
    copy_file_if_absent(&source, &target).unwrap();
    assert_eq!(
        std::fs::read(source).unwrap(),
        std::fs::read(target).unwrap()
    );
}

#[tokio::test]
async fn concurrent_patches_merge_against_latest_committed_config() {
    let temp = tempfile::tempdir().unwrap();
    let initial = configured(temp.path());
    let state = Arc::new(RwLock::new(Some(initial)));
    let gates = Arc::new(IndexingSemaphores::new());
    let coordinator = Arc::new(ConfigCoordinator::default());
    let path = temp.path().join("config.toml");
    let barrier = Arc::new(tokio::sync::Barrier::new(3));
    let mut tasks = Vec::new();
    for json in [
        serde_json::json!({"ui": {"theme": "light"}}),
        serde_json::json!({"general": {"autoIndexOnLaunch": false}}),
    ] {
        let state = state.clone();
        let gates = gates.clone();
        let coordinator = coordinator.clone();
        let path = path.clone();
        let barrier = barrier.clone();
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            mutate_config(
                &state,
                gates,
                &coordinator,
                ConfigMutation::Patch(serde_json::from_value(json).unwrap()),
                move |config| config.save_to(&path),
            )
            .await
            .unwrap();
        }));
    }
    barrier.wait().await;
    for task in tasks {
        task.await.unwrap();
    }
    let disk = TracePilotConfig::load_from(&path).unwrap();
    let memory = read_config(&state);
    assert_eq!(disk.ui.theme, "light");
    assert!(!disk.general.auto_index_on_launch);
    assert_eq!(
        serde_json::to_value(disk).unwrap(),
        serde_json::to_value(memory).unwrap()
    );
}

#[tokio::test]
async fn failed_save_does_not_publish_config() {
    let temp = tempfile::tempdir().unwrap();
    let initial = configured(temp.path());
    let state = Arc::new(RwLock::new(Some(initial.clone())));
    let patch = serde_json::from_value(serde_json::json!({"ui": {"theme": "light"}})).unwrap();
    let result = mutate_config(
        &state,
        Arc::new(IndexingSemaphores::new()),
        &ConfigCoordinator::default(),
        ConfigMutation::Patch(patch),
        |_| Err(BindingsError::Internal("injected write failure".into())),
    )
    .await;
    assert!(result.is_err());
    assert_eq!(read_config(&state).ui.theme, initial.ui.theme);
}

#[tokio::test]
async fn cancelled_caller_cannot_release_ordering_during_disk_write() {
    let temp = tempfile::tempdir().unwrap();
    let state = Arc::new(RwLock::new(Some(configured(temp.path()))));
    let coordinator = Arc::new(ConfigCoordinator::default());
    let new_root = temp.path().join("relocated").to_string_lossy().to_string();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (finish_tx, finish_rx) = std::sync::mpsc::channel();
    let task = {
        let state = state.clone();
        let coordinator = coordinator.clone();
        tokio::spawn(async move {
            mutate_config(
                &state,
                Arc::new(IndexingSemaphores::new()),
                &coordinator,
                ConfigMutation::Patch(
                    serde_json::from_value(serde_json::json!({
                        "ui": {"theme": "light"}, "paths": {"tracepilotHome": new_root}
                    }))
                    .unwrap(),
                ),
                move |_| {
                    started_tx.send(()).unwrap();
                    finish_rx.recv().unwrap();
                    Ok(())
                },
            )
            .await
        })
    };
    started_rx.await.unwrap();
    task.abort();
    let _ = task.await;
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(25), coordinator.mutation())
            .await
            .is_err()
    );
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_millis(25),
            coordinator.root_read()
        )
        .await
        .is_err()
    );
    finish_tx.send(()).unwrap();
    let _guard = tokio::time::timeout(std::time::Duration::from_secs(2), coordinator.mutation())
        .await
        .unwrap();
    assert_eq!(read_config(&state).ui.theme, "light");
}

#[tokio::test]
async fn relocation_includes_a_capture_completed_while_waiting_for_the_root() {
    let temp = tempfile::tempdir().unwrap();
    let config = configured(temp.path());
    let capture_path = config
        .tracepilot_home()
        .join("context-captures/fixture/request.json");
    let new_root = temp.path().join("relocated");
    let state = Arc::new(RwLock::new(Some(config)));
    let coordinator = Arc::new(ConfigCoordinator::default());
    let capture = coordinator.root_read().await;
    let task = {
        let state = state.clone();
        let coordinator = coordinator.clone();
        let patch =
            serde_json::from_value(serde_json::json!({"paths": {"tracepilotHome": new_root}}))
                .unwrap();
        tokio::spawn(async move {
            mutate_config(
                &state,
                Arc::new(IndexingSemaphores::new()),
                &coordinator,
                ConfigMutation::Patch(patch),
                |_| Ok(()),
            )
            .await
        })
    };
    tokio::task::yield_now().await;
    assert!(!task.is_finished());
    tracepilot_core::utils::fs::ensure_parent_dir(&capture_path).unwrap();
    std::fs::write(&capture_path, "{}").unwrap();
    drop(capture);
    task.await.unwrap().unwrap();
    assert_eq!(
        std::fs::read_to_string(new_root.join("context-captures/fixture/request.json")).unwrap(),
        "{}"
    );
}

#[test]
fn relocation_preserves_readable_session_and_benchmark_captures() {
    use tracepilot_core::paths::TracePilotPaths;
    use tracepilot_orchestrator::context_capture::{BENCHMARK_CAPTURE_COLLECTION_ID, get_capture};
    let temp = tempfile::tempdir().unwrap();
    let old = TracePilotPaths::from_root(temp.path().join("old"));
    let new = TracePilotPaths::from_root(temp.path().join("new"));
    let session_id = uuid::Uuid::new_v4().to_string();
    for collection in [session_id.as_str(), BENCHMARK_CAPTURE_COLLECTION_ID] {
        let capture_id = uuid::Uuid::new_v4().to_string();
        let source = old.context_capture_dir(collection, &capture_id);
        std::fs::create_dir_all(&source).unwrap();
        let manifest = serde_json::json!({
            "schemaVersion": 2, "captureId": capture_id, "sourceSessionId": collection,
            "capturedAt": "2026-09-27T00:00:00Z",
            "sourceEventsFingerprint": {"bytes": 0, "modifiedUnixMs": 0, "sha256": ""},
            "cliVersion": "fixture", "captureProfile": "isolated",
            "protocol": "openAiChatCompletions", "protocolDetectionSource": "test",
            "requestPath": "/fixture", "contentType": "application/json",
            "rawBodySha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
            "rawBodyBytes": 2, "rawBodyCharacters": 2, "estimatedTokens": 1,
            "probeNonce": "fixture", "fidelityManifest": {
                "profile": "isolated", "includedResources": [], "omittedResources": [],
                "workingDirectory": "fixture", "workingDirectoryFallback": false,
                "sourceUnchanged": true
            }, "warnings": [], "safeHeaderNames": [], "saved": true
        });
        std::fs::write(source.join("request.json"), "{}").unwrap();
        std::fs::write(
            source.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let before = get_capture(old.root(), collection, &capture_id).unwrap();
        copy_tracepilot_home_if_moved(old.root(), new.root()).unwrap();
        // A retry after a interrupted/failed config publication is idempotent.
        copy_tracepilot_home_if_moved(old.root(), new.root()).unwrap();
        let after = get_capture(new.root(), collection, &capture_id).unwrap();
        assert_eq!(before, after);
    }
}
