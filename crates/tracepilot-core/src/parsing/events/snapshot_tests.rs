use std::cell::Cell;
use std::io::Write;

use super::load_event_snapshot;

const EVENT: &str = "{\"type\":\"user.message\",\"data\":{\"content\":\"hello\"}}\n";

#[test]
fn append_during_read_is_not_a_complete_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    std::fs::write(&path, EVENT).unwrap();
    let checks = Cell::new(0);
    let result = load_event_snapshot(&path, &|| {
        checks.set(checks.get() + 1);
        if checks.get() == 3 {
            let mut file = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            file.write_all(EVENT.as_bytes()).unwrap();
        }
        false
    });
    assert!(
        result.is_err(),
        "an append after the initial fingerprint must be retried"
    );
    assert_eq!(
        load_event_snapshot(&path, &|| false)
            .unwrap()
            .parsed
            .unwrap()
            .events
            .len(),
        2
    );
}

#[test]
fn cancellation_is_checked_inside_a_single_large_record() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    std::fs::write(
        &path,
        format!(
            "{{\"type\":\"user.message\",\"data\":{{\"content\":\"{}\"}}}}",
            "x".repeat(2 * 1024 * 1024)
        ),
    )
    .unwrap();
    let checks = Cell::new(0);
    let result = load_event_snapshot(&path, &|| {
        checks.set(checks.get() + 1);
        checks.get() == 4
    });
    assert!(result.is_err());
    assert_eq!(
        checks.get(),
        4,
        "cancellation stops reading before the whole record is buffered"
    );
}

#[test]
fn malformed_or_unreadable_sources_are_not_missing_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    assert!(
        load_event_snapshot(&path, &|| false)
            .unwrap()
            .parsed
            .is_none()
    );
    std::fs::write(&path, format!("{EVENT}{{broken")).unwrap();
    assert!(load_event_snapshot(&path, &|| false).is_err());
    std::fs::write(&path, [0xff, 0xfe]).unwrap();
    assert!(load_event_snapshot(&path, &|| false).is_err());
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(load_event_snapshot(&path, &|| false).is_err());
}

#[test]
fn fractional_nano_aiu_and_lone_surrogates_do_not_block_indexing() {
    // Both shapes come from real Copilot CLI logs (1.0.86 shutdown metrics,
    // shell output truncated inside an emoji) and previously made the whole
    // snapshot "incomplete", so the session was never indexed again.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    std::fs::write(
        &path,
        concat!(
            r#"{"type":"tool.execution_complete","data":{"toolCallId":"t1","result":{"content":"<span>\ud83d\n"}}}"#,
            "\n",
            r#"{"type":"session.shutdown","data":{"totalNanoAiu":528375599.99999994,"modelMetrics":{"gpt-5.6-luna":{"totalNanoAiu":528375599.99999994}}}}"#,
            "\n",
        ),
    )
    .unwrap();

    let parsed = load_event_snapshot(&path, &|| false)
        .unwrap()
        .parsed
        .unwrap();
    assert_eq!(parsed.events.len(), 2);
    let super::TypedEventData::SessionShutdown(shutdown) = &parsed.events[1].typed_data else {
        panic!("shutdown should decode as typed data");
    };
    assert_eq!(shutdown.total_nano_aiu, Some(528_375_600));
    assert_eq!(
        shutdown.model_metrics.as_ref().unwrap()["gpt-5.6-luna"].total_nano_aiu,
        Some(528_375_600)
    );
}
