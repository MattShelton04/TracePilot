use super::*;

#[test]
fn parses_lock_file_names() {
    assert_eq!(parse_lock_pid("inuse.10552.lock"), Some(10552));
    assert_eq!(parse_lock_pid("inuse.10552.hold"), None);
    assert_eq!(parse_lock_pid("inuse..lock"), None);
    assert_eq!(parse_lock_pid("events.jsonl"), None);
}

#[test]
fn lock_holder_pids_reads_session_directory() {
    let dir = tempfile::tempdir().unwrap();
    for name in [
        "inuse.42.lock",
        "inuse.42.hold",
        "inuse.7.lock",
        "events.jsonl",
    ] {
        std::fs::write(dir.path().join(name), "").unwrap();
    }
    assert_eq!(lock_holder_pids(dir.path()), vec![7, 42]);
    assert!(lock_holder_pids(&dir.path().join("missing")).is_empty());
}

#[test]
fn parses_netstat_listeners_regardless_of_locale() {
    let output = "
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1200
  TCP    127.0.0.1:54618        0.0.0.0:0              ABHÖREN         10552
  TCP    127.0.0.1:54618        127.0.0.1:60001        ESTABLISHED     10552
  TCP    192.168.1.5:7000       0.0.0.0:0              LISTENING       900
  TCP    [::1]:61000            [::]:0                 LISTENING       10552
  TCP    [::]:445               [::]:0                 LISTENING       4
  UDP    0.0.0.0:5353           *:*                                    77
";
    let map = parse_netstat(output);
    assert_eq!(
        map.get(&10552),
        Some(&vec![
            "127.0.0.1:54618".to_string(),
            "[::1]:61000".to_string()
        ])
    );
    assert_eq!(map.get(&1200), Some(&vec!["127.0.0.1:135".to_string()]));
    // An IPv6-only listener is reached over IPv6.
    assert_eq!(map.get(&4), Some(&vec!["[::1]:445".to_string()]));
    assert!(
        !map.contains_key(&900),
        "non-loopback listeners are ignored"
    );
    assert!(!map.contains_key(&77), "UDP is ignored");
}

#[test]
fn parses_lsof_field_output() {
    let output = "p311\nf13\nn[::1]:54619\nf12\nn127.0.0.1:54618\np400\nf3\nn10.0.0.2:22\n";
    let map = parse_lsof(output);
    // IPv4 first, even when listed second.
    assert_eq!(
        map.get(&311),
        Some(&vec![
            "127.0.0.1:54618".to_string(),
            "[::1]:54619".to_string()
        ])
    );
    assert!(!map.contains_key(&400));
}

#[test]
fn classifies_hosting_states() {
    let listening = PortMap::from([(10552_u32, vec!["127.0.0.1:54618".to_string()])]);

    let attachable = classify("s1", &[3, 10552], true, &listening, None);
    assert_eq!(attachable.state, LiveHostState::Attachable);
    assert_eq!(attachable.pid, Some(10552));
    assert_eq!(attachable.address.as_deref(), Some("127.0.0.1:54618"));

    let running = classify("s2", &[18024], true, &listening, None);
    assert_eq!(running.state, LiveHostState::Running);
    assert_eq!(running.pid, Some(18024));
    assert_eq!(running.address, None);

    // A stale lock (no recent activity) with no listener is idle.
    let stale = classify("s3", &[18024], false, &listening, None);
    assert_eq!(stale.state, LiveHostState::Idle);
    assert_eq!(stale.pid, None);

    let idle = classify("s4", &[], false, &listening, None);
    assert_eq!(idle.state, LiveHostState::Idle);
}

#[test]
fn a_lock_held_by_a_dead_process_is_idle() {
    let listening = HashMap::new();
    let alive = HashSet::from([4_u32, 18024]);

    let crashed = classify("s", &[999], true, &listening, Some(&alive));
    assert_eq!(crashed.state, LiveHostState::Idle);

    let running = classify("s", &[999, 18024], true, &listening, Some(&alive));
    assert_eq!(running.state, LiveHostState::Running);
    assert_eq!(running.pid, Some(18024));
}

#[test]
fn parses_process_lists() {
    assert_eq!(parse_ps_pids("  1\n 311\nbogus\n"), HashSet::from([1, 311]));
}

#[tokio::test]
async fn locate_sessions_rejects_path_like_ids_and_reports_idle() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("idle-session")).unwrap();
    let hosts = locate_sessions(
        dir.path(),
        &["idle-session".to_string(), "../escape".to_string()],
    )
    .await
    .expect("no lock holders, so no probe is needed");
    assert_eq!(hosts.len(), 2);
    assert!(hosts.iter().all(|h| h.state == LiveHostState::Idle));
}

#[cfg(windows)]
#[test]
fn hold_file_liveness_follows_open_handles() {
    let dir = tempfile::tempdir().unwrap();
    let hold = dir.path().join("inuse.1.hold");
    std::fs::write(&hold, "").unwrap();
    assert_eq!(hold_file_held(&hold), Some(false));
    let handle = std::fs::File::open(&hold).unwrap();
    assert_eq!(hold_file_held(&hold), Some(true));
    drop(handle);
    assert_eq!(hold_file_held(&hold), Some(false));
    assert_eq!(hold_file_held(&dir.path().join("missing.hold")), None);
}

#[test]
fn a_stale_or_dead_holder_is_never_attachable() {
    // A crashed CLI's PID reused by an unrelated loopback listener.
    let listening = PortMap::from([(4242, vec!["127.0.0.1:5000".to_string()])]);
    let stale = classify("s", &[4242], false, &listening, None);
    assert_eq!(stale.state, LiveHostState::Idle);
    let alive = HashSet::from([1]);
    let dead = classify("s", &[4242], true, &listening, Some(&alive));
    assert_eq!(dead.state, LiveHostState::Idle);
    let live = HashSet::from([4242]);
    let ok = classify("s", &[4242], true, &listening, Some(&live));
    assert_eq!(ok.state, LiveHostState::Attachable);
}
