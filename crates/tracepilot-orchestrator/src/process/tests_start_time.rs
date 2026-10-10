//! `process_start_time` against live, missing and exited processes.

use super::{process_start_time, run_hidden_stdout};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Seconds between the FILETIME epoch (1601) and the Unix epoch.
const FILETIME_UNIX_OFFSET_SECS: u64 = 11_644_473_600;

fn as_system_time(filetime: &str) -> SystemTime {
    let ticks: u64 = filetime.parse().unwrap();
    let since_1601 = Duration::from_nanos(ticks * 100);
    UNIX_EPOCH + since_1601 - Duration::from_secs(FILETIME_UNIX_OFFSET_SECS)
}

/// A child that waits on its stdin until killed.
fn idle_child() -> Child {
    Command::new("cmd")
        .args(["/d", "/c", "pause"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap()
}

#[test]
fn reads_a_live_process_and_rejects_a_missing_one() {
    let own = process_start_time(std::process::id()).expect("own start time");
    assert!(own.len() >= 17, "a FILETIME in decimal, got {own}");
    assert_eq!(process_start_time(std::process::id()), Some(own));
    // Windows hands out pids in multiples of 4, so these are never live.
    assert_eq!(process_start_time(i32::MAX as u32), None);
    assert_eq!(process_start_time(u32::MAX), None);
    // The System Idle Process (pid 0) cannot be opened.
    assert_eq!(process_start_time(0), None);
}

/// Units and epoch, against the system clock: a child started between
/// two clock reads has a start time between them.
#[test]
fn a_new_process_started_now() {
    let before = SystemTime::now();
    let mut child = idle_child();
    let after = SystemTime::now();
    let started = process_start_time(child.id()).map(|t| as_system_time(&t));
    child.kill().unwrap();
    child.wait().unwrap();
    let started = started.expect("child start time");
    // The kernel stamps creation inside CreateProcess; allow for the
    // clock's ~16 ms granularity on either side.
    let slack = Duration::from_millis(100);
    assert!(
        started + slack >= before && started <= after + slack,
        "{started:?} not within {before:?}..{after:?}"
    );
}

/// A process that has exited reads as missing, even while a handle to
/// it (here, `Child`'s) keeps its pid from being reused.
#[test]
fn an_exited_process_reads_as_missing() {
    let mut child = idle_child();
    let pid = child.id();
    assert!(process_start_time(pid).is_some());
    child.kill().unwrap();
    child.wait().unwrap();
    assert_eq!(process_start_time(pid), None);
    drop(child);
    assert_eq!(process_start_time(pid), None);
}

/// A second, independent source: .NET's `Process.StartTime`, which the
/// app used before. Ignored because it spawns PowerShell (slow on CI).
#[test]
#[ignore = "spawns PowerShell; run with --ignored"]
fn matches_powershell_process_start_time() {
    let pid = std::process::id();
    let script =
        format!("[System.Diagnostics.Process]::GetProcessById({pid}).StartTime.ToFileTimeUtc()");
    let powershell = run_hidden_stdout(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", &script],
        None,
        Some(120),
    )
    .unwrap();
    assert_eq!(process_start_time(pid), Some(powershell));
}

/// Average latency over 50 calls; run with `--ignored --nocapture`.
#[test]
#[ignore = "timing; run with --ignored --nocapture"]
#[allow(clippy::print_stdout)]
fn latency() {
    const CALLS: u32 = 50;
    let own = std::process::id();
    let timer = std::time::Instant::now();
    for _ in 0..CALLS {
        assert!(process_start_time(own).is_some());
    }
    let live = timer.elapsed() / CALLS;
    let timer = std::time::Instant::now();
    for _ in 0..CALLS {
        assert!(process_start_time(i32::MAX as u32).is_none());
    }
    let missing = timer.elapsed() / CALLS;
    println!("process_start_time over {CALLS} calls: live {live:?}/call, missing {missing:?}/call");
}
