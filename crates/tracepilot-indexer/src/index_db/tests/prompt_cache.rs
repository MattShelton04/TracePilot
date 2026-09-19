//! Prompt-cache window extraction, aggregate figures and the TTL registry.

use std::fs;
use std::path::{Path, PathBuf};

use crate::index_db::IndexDb;

const FIXTURE: &str =
    include_str!("../../../../tracepilot-core/tests/fixtures/versions/v1_0_83_prompt_cache.jsonl");

fn write_raw_session(root: &Path, session_id: &str, repo: &str, events: &str) -> PathBuf {
    let dir = root.join(session_id);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {session_id}\nsummary: \"Cache session\"\nrepository: \"{repo}\"\n\
             created_at: \"2026-09-12T00:00:00Z\"\nupdated_at: \"2026-09-12T01:05:00Z\"\n"
        ),
    )
    .unwrap();
    fs::write(dir.join("events.jsonl"), events).unwrap();
    dir
}

/// A minimal log whose checkpoints all report `ttl` for `model`.
fn checkpoint_log(model: &str, ttl: u64, checkpoints: usize) -> String {
    let mut lines = vec![format!(
        r#"{{"type":"session.start","data":{{"selectedModel":"{model}"}},"id":"e0","timestamp":"2026-09-12T00:00:00Z","parentId":null}}"#
    )];
    for i in 0..checkpoints {
        lines.push(format!(
            r#"{{"type":"user.message","data":{{"content":"hi","interactionId":"i{i}"}},"id":"u{i}","timestamp":"2026-09-12T00:0{i}:00Z","parentId":null}}"#
        ));
        lines.push(format!(
            r#"{{"type":"session.usage_checkpoint","data":{{"totalNanoAiu":{i},"modelCacheState":[{{"modelId":"{model}","cacheExpiresAt":"2026-09-12T01:00:00Z","cacheTtlSeconds":{ttl}}}]}},"id":"c{i}","timestamp":"2026-09-12T00:0{i}:30Z","parentId":null}}"#
        ));
    }
    lines.join("\n") + "\n"
}

fn count(db: &IndexDb, table: &str) -> i64 {
    db.conn
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn indexing_stores_predicted_windows_and_ttls_once() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session = write_raw_session(
        tmp.path(),
        "c3333333-3333-3333-3333-333333333333",
        "org/cache",
        FIXTURE,
    );

    db.upsert_session(&session).unwrap();
    // Re-indexing replaces the child rows rather than appending to them.
    db.upsert_session(&session).unwrap();

    assert_eq!(count(&db, "session_cache_windows"), 3);
    let (outcome, kinds): (String, Option<String>) = db
        .conn
        .query_row(
            "SELECT outcome, change_kinds FROM session_cache_windows WHERE window_index = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(outcome, "expired");
    assert_eq!(kinds.as_deref(), Some("history"));

    let ttls = db.query_observed_cache_ttls().unwrap();
    assert_eq!(ttls.len(), 1);
    assert_eq!(ttls[0].model, "gpt-5.6-luna");
    assert_eq!(ttls[0].ttl_seconds, 1800);
    assert_eq!(ttls[0].observations, 3);
}

#[test]
fn dashboard_reports_resumes_after_expiry_and_change_causes() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session = write_raw_session(
        tmp.path(),
        "c3333333-3333-3333-3333-333333333333",
        "org/cache",
        FIXTURE,
    );
    db.upsert_session(&session).unwrap();

    let cache = db
        .query_analytics(None, None, None, false)
        .unwrap()
        .prompt_cache;
    assert_eq!(cache.sessions_with_predicted, 1);
    assert_eq!(cache.resumed_windows, 3);
    assert_eq!(cache.warm_resumes, 1);
    assert_eq!(cache.resumes_after_expiry, 2);
    assert_eq!(cache.resent_prefix_tokens, 30_000);
    let by_model: Vec<_> = cache
        .resent_prefix_tokens_by_model
        .iter()
        .map(|m| (m.model.as_str(), m.tokens))
        .collect();
    assert_eq!(
        by_model,
        vec![("gpt-5.6-luna", 21_000), ("claude-sonnet-5", 9_000)]
    );
    assert_eq!(cache.median_idle_seconds, Some(579));
    let kinds: Vec<_> = cache
        .top_change_kinds
        .iter()
        .map(|k| (k.kind.as_str(), k.count))
        .collect();
    assert_eq!(kinds, vec![("history", 1), ("model", 1), ("tools", 1)]);

    let other_repo = db
        .query_analytics(None, None, Some("org/other"), false)
        .unwrap()
        .prompt_cache;
    assert_eq!(other_repo.resumed_windows, 0);
    assert!(other_repo.observed_ttls.is_empty());
}

#[test]
fn ttl_registry_uses_the_most_common_value_and_breaks_ties_short() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let a = write_raw_session(
        tmp.path(),
        "a1111111-1111-1111-1111-111111111111",
        "org/a",
        &checkpoint_log("model-x", 3600, 2),
    );
    let b = write_raw_session(
        tmp.path(),
        "b2222222-2222-2222-2222-222222222222",
        "org/b",
        &checkpoint_log("model-x", 1800, 2),
    );
    db.upsert_session(&a).unwrap();
    db.upsert_session(&b).unwrap();
    assert_eq!(db.query_observed_cache_ttls().unwrap()[0].ttl_seconds, 1800);

    let c = write_raw_session(
        tmp.path(),
        "c3333333-3333-3333-3333-333333333333",
        "org/c",
        &checkpoint_log("model-x", 3600, 1),
    );
    db.upsert_session(&c).unwrap();
    let ttls = db.query_observed_cache_ttls().unwrap();
    assert_eq!(ttls[0].ttl_seconds, 3600);
    assert_eq!(ttls[0].observations, 3);
}
