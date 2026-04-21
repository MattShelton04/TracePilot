use std::time::Duration;

use super::*;
use crate::index_db::SessionIndexInfo;

#[test]
fn new_tracker_starts_at_zero() {
    let tracker = ProgressTracker::new(10);
    assert_eq!(tracker.current, 0);
    assert_eq!(tracker.total, 10);
    assert_eq!(tracker.running_tokens, 0);
    assert_eq!(tracker.running_events, 0);
    assert_eq!(tracker.seen_repos.len(), 0);
}

#[test]
fn accumulate_updates_metrics() {
    let mut tracker = ProgressTracker::new(10);
    let info = SessionIndexInfo {
        repository: Some("test/repo".into()),
        branch: None,
        current_model: None,
        total_tokens: 1000,
        event_count: 50,
        turn_count: 10,
    };
    tracker.accumulate(&info);
    assert_eq!(tracker.running_tokens, 1000);
    assert_eq!(tracker.running_events, 50);
    assert_eq!(tracker.seen_repos.len(), 1);
    assert!(tracker.seen_repos.contains("test/repo"));
}

#[test]
fn accumulate_deduplicates_repos() {
    let mut tracker = ProgressTracker::new(10);
    let info = SessionIndexInfo {
        repository: Some("test/repo".into()),
        branch: None,
        current_model: None,
        total_tokens: 100,
        event_count: 10,
        turn_count: 5,
    };
    tracker.accumulate(&info);
    tracker.accumulate(&info); // Same repo
    assert_eq!(tracker.seen_repos.len(), 1); // Still 1
    assert_eq!(tracker.running_tokens, 200); // But tokens accumulate
    assert_eq!(tracker.running_events, 20); // And events accumulate
}

#[test]
fn accumulate_handles_none_repository() {
    let mut tracker = ProgressTracker::new(10);
    let info = SessionIndexInfo {
        repository: None,
        branch: None,
        current_model: None,
        total_tokens: 100,
        event_count: 10,
        turn_count: 5,
    };
    tracker.accumulate(&info);
    assert_eq!(tracker.seen_repos.len(), 0);
    assert_eq!(tracker.running_tokens, 100);
    assert_eq!(tracker.running_events, 10);
}

#[test]
fn increment_advances_current() {
    let mut tracker = ProgressTracker::new(10);
    assert_eq!(tracker.current, 0);
    tracker.increment();
    assert_eq!(tracker.current, 1);
    tracker.increment();
    assert_eq!(tracker.current, 2);
}

#[test]
fn should_emit_when_complete() {
    let mut tracker = ProgressTracker::new(1);
    tracker.increment();
    assert!(tracker.should_emit()); // current == total
}

#[test]
fn should_emit_respects_throttle_initially() {
    let mut tracker = ProgressTracker::new(100);
    tracker.increment();
    // Just started, not enough time elapsed
    assert!(!tracker.should_emit());
}

#[test]
fn should_emit_after_throttle_duration() {
    let mut tracker = ProgressTracker::new(100);
    tracker.throttle = Duration::from_millis(10);
    tracker.increment();
    std::thread::sleep(Duration::from_millis(15));
    assert!(tracker.should_emit());
}

#[test]
fn is_complete_checks_current_vs_total() {
    let mut tracker = ProgressTracker::new(5);
    assert!(!tracker.is_complete());
    tracker.current = 4;
    assert!(!tracker.is_complete());
    tracker.current = 5;
    assert!(tracker.is_complete());
    tracker.current = 6; // Even if over
    assert!(tracker.is_complete());
}

#[test]
fn emit_updates_last_emit_timestamp() {
    let mut tracker = ProgressTracker::new(10);
    let start = tracker.last_emit;
    std::thread::sleep(Duration::from_millis(5));

    let mut called = false;
    tracker.emit(
        &mut |_| {
            called = true;
        },
        None,
    );

    assert!(called);
    assert!(tracker.last_emit > start);
}

#[test]
fn emit_if_ready_respects_throttle() {
    let mut tracker = ProgressTracker::new(100);
    tracker.throttle = Duration::from_secs(10);
    tracker.increment();

    let mut call_count = 0;
    let emitted = tracker.emit_if_ready(
        &mut |_| {
            call_count += 1;
        },
        None,
    );

    assert!(!emitted);
    assert_eq!(call_count, 0);
}

#[test]
fn emit_if_ready_emits_when_complete() {
    let mut tracker = ProgressTracker::new(2);
    tracker.increment();
    tracker.increment();

    let mut call_count = 0;
    let emitted = tracker.emit_if_ready(
        &mut |_| {
            call_count += 1;
        },
        None,
    );

    assert!(emitted);
    assert_eq!(call_count, 1);
}

#[test]
fn emit_if_ready_emits_after_throttle_elapsed() {
    let mut tracker = ProgressTracker::new(100);
    tracker.throttle = Duration::from_millis(10);
    tracker.increment();

    std::thread::sleep(Duration::from_millis(15));

    let mut call_count = 0;
    let emitted = tracker.emit_if_ready(
        &mut |_| {
            call_count += 1;
        },
        None,
    );

    assert!(emitted);
    assert_eq!(call_count, 1);
}

#[test]
fn progress_data_correct() {
    let mut tracker = ProgressTracker::new(10);
    tracker.increment();
    tracker.running_tokens = 5000;
    tracker.running_events = 100;
    tracker.seen_repos.insert("repo1".into());
    tracker.seen_repos.insert("repo2".into());

    let mut received_progress = None;
    tracker.emit(
        &mut |progress| {
            received_progress = Some(progress.clone());
        },
        None,
    );

    let progress = received_progress.unwrap();
    assert_eq!(progress.current, 1);
    assert_eq!(progress.total, 10);
    assert_eq!(progress.running_tokens, 5000);
    assert_eq!(progress.running_events, 100);
    assert_eq!(progress.running_repos, 2);
    assert!(progress.session_info.is_none());
}

#[test]
fn progress_includes_session_info_when_provided() {
    let mut tracker = ProgressTracker::new(10);
    tracker.increment();

    let info = SessionIndexInfo {
        repository: Some("test/repo".into()),
        branch: Some("main".into()),
        current_model: Some("claude-sonnet-4".into()),
        total_tokens: 500,
        event_count: 25,
        turn_count: 8,
    };

    let mut received_progress = None;
    tracker.emit(
        &mut |progress| {
            received_progress = Some(progress.clone());
        },
        Some(info.clone()),
    );

    let progress = received_progress.unwrap();
    assert!(progress.session_info.is_some());
    let session_info = progress.session_info.unwrap();
    assert_eq!(session_info.total_tokens, 500);
    assert_eq!(session_info.event_count, 25);
    assert_eq!(session_info.repository, Some("test/repo".into()));
}

#[test]
fn zero_sessions_doesnt_panic() {
    let mut tracker = ProgressTracker::new(0);
    tracker.emit(&mut |_| {}, None);
    assert!(tracker.is_complete());
    assert_eq!(tracker.current, 0);
    assert_eq!(tracker.total, 0);
}

#[test]
fn single_session_workflow() {
    let mut tracker = ProgressTracker::new(1);
    let mut emissions = Vec::new();

    // Initial emit
    tracker.emit(&mut |p| emissions.push(p.current), None);
    assert_eq!(emissions.len(), 1);
    assert_eq!(emissions[0], 0);

    // Process session
    tracker.increment();
    tracker.emit_if_ready(&mut |p| emissions.push(p.current), None);

    // Should have emitted because current == total
    assert_eq!(emissions.len(), 2);
    assert_eq!(emissions[1], 1);
}

#[test]
fn multiple_emissions_track_progress() {
    let mut tracker = ProgressTracker::new(5);
    tracker.throttle = Duration::from_millis(1); // Very short for testing

    let mut emissions = Vec::new();

    for _ in 0..5 {
        tracker.increment();
        std::thread::sleep(Duration::from_millis(2)); // Ensure throttle passes
        tracker.emit_if_ready(&mut |p| emissions.push(p.current), None);
    }

    // Should have emitted all 5 because throttle is short
    assert_eq!(emissions.len(), 5);
    assert_eq!(emissions, vec![1, 2, 3, 4, 5]);
}

#[test]
fn throttling_reduces_emission_count() {
    let mut tracker = ProgressTracker::new(100);
    tracker.throttle = Duration::from_secs(10); // Very long

    let mut emissions = 0;

    for _ in 0..99 {
        tracker.increment();
        if tracker.emit_if_ready(&mut |_| emissions += 1, None) {
            // Progress emitted
        }
    }

    // Should not have emitted for any of the first 99 (throttle not elapsed)
    assert_eq!(emissions, 0);

    // But the 100th should emit (complete)
    tracker.increment();
    tracker.emit_if_ready(&mut |_| emissions += 1, None);
    assert_eq!(emissions, 1);
}
