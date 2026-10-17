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
fn unreadable_sources_are_not_missing_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    assert!(
        load_event_snapshot(&path, &|| false)
            .unwrap()
            .parsed
            .is_none()
    );
    // Nothing to recover: fail, so the index keeps its last good rows.
    for bytes in [&b"{broken"[..], &[0xff, 0xfe]] {
        std::fs::write(&path, bytes).unwrap();
        assert!(load_event_snapshot(&path, &|| false).is_err());
    }
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(load_event_snapshot(&path, &|| false).is_err());
}

/// A CLI killed mid-append leaves a cut line, which a resumed CLI follows
/// with more lines. The snapshot keeps every other event and counts the
/// skipped lines, whether the cut ends in a partial character or not.
#[test]
fn cut_lines_are_skipped_not_fatal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    let cut_in_char = "{\"type\":\"user.message\",\"data\":{\"content\":\"✅".as_bytes();
    let cut_in_char = &cut_in_char[..cut_in_char.len() - 2];
    for cut in [&b"{\"type\":\"user.mess"[..], cut_in_char] {
        let mut bytes = EVENT.as_bytes().to_vec();
        bytes.extend_from_slice(cut);
        std::fs::write(&path, &bytes).unwrap();
        let tail = load_event_snapshot(&path, &|| false).unwrap();
        let parsed = tail.parsed.unwrap();
        assert_eq!(
            (parsed.events.len(), parsed.diagnostics.malformed_lines),
            (1, 1)
        );
        assert_eq!(
            tail.fingerprint.unwrap().size,
            bytes.len() as u64,
            "the fingerprint covers the cut bytes, so finishing them changes it"
        );

        bytes.extend_from_slice(b"\n");
        bytes.extend_from_slice(EVENT.as_bytes());
        std::fs::write(&path, &bytes).unwrap();
        let parsed = load_event_snapshot(&path, &|| false)
            .unwrap()
            .parsed
            .unwrap();
        assert_eq!(
            (parsed.events.len(), parsed.diagnostics.malformed_lines),
            (2, 1)
        );
    }
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
