//! Session totals from a `session.usage_checkpoint` written after the last
//! shutdown.
//!
//! Copilot CLI writes a checkpoint whenever the agent goes idle. Its
//! `totalNanoAiu` and `totalPremiumRequests` are the session's observed
//! totals so far: like a cumulative shutdown, they restore the shutdown before
//! them when a session resumes. A session that is still running, or that ended
//! without a shutdown record, has newer totals in its latest checkpoint than in
//! any shutdown.
//!
//! Only those two session-level totals are taken. A checkpoint has no
//! per-model split, token counts or API time, so model rows and segments stay
//! shutdown-only and the running run's credits stay unattributed to a model.

use chrono::{DateTime, Utc};

use crate::models::event_types::{SessionEventType, ShutdownData, UsageCheckpointData};
use crate::parsing::events::{TypedEvent, TypedEventData};

/// The main agent's latest checkpoint, when no main-agent shutdown follows it.
pub(super) fn trailing_checkpoint(
    events: &[TypedEvent],
) -> Option<(&UsageCheckpointData, Option<DateTime<Utc>>)> {
    for event in events.iter().rev().filter(|e| e.raw.agent_id.is_none()) {
        match &event.typed_data {
            TypedEventData::SessionUsageCheckpoint(data) => {
                return Some((data, event.raw.timestamp));
            }
            _ if event.event_type == SessionEventType::SessionShutdown => return None,
            _ => {}
        }
    }
    None
}

/// Totals for a session that has a checkpoint but no shutdown yet.
pub(super) fn checkpoint_only_data(
    checkpoint: &UsageCheckpointData,
    timestamp: Option<DateTime<Utc>>,
) -> ShutdownData {
    ShutdownData {
        total_nano_aiu: Some(checkpoint.total_nano_aiu),
        total_premium_requests: checkpoint.total_premium_requests,
        metrics_timestamp: timestamp,
        ..ShutdownData::default()
    }
}

/// Replaces the last shutdown's share of `combined` with a later checkpoint's
/// totals, as a cumulative shutdown would. A checkpoint below the last
/// shutdown's own totals is not a continuation of it and is ignored, as is one
/// that adds nothing; then the shutdown aggregate (and its timestamp) stands.
pub(super) fn apply_trailing_checkpoint(
    combined: &mut ShutdownData,
    last_shutdown: &ShutdownData,
    checkpoint: &UsageCheckpointData,
    timestamp: Option<DateTime<Utc>>,
) {
    let last_nano = last_shutdown.total_nano_aiu.unwrap_or(0);
    let nano = checkpoint.total_nano_aiu;
    let last_premium = last_shutdown.total_premium_requests.unwrap_or(0.0);
    let premium = checkpoint.total_premium_requests;
    if nano < last_nano || premium.is_some_and(|p| p < last_premium) {
        return;
    }
    let premium_grew = premium.is_some_and(|p| p > last_premium);
    if nano == last_nano && !premium_grew {
        return;
    }
    // The last shutdown is always the last source of `combined`, so this
    // leaves the earlier sources' share.
    let earlier_nano = combined
        .total_nano_aiu
        .unwrap_or(0)
        .saturating_sub(last_nano);
    combined.total_nano_aiu = Some(earlier_nano + nano);
    if let Some(premium) = premium {
        let earlier = (combined.total_premium_requests.unwrap_or(0.0) - last_premium).max(0.0);
        combined.total_premium_requests = Some(earlier + premium);
    }
    combined.metrics_timestamp = timestamp;
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use crate::parsing::events::{
        RawEvent, TypedEvent, extract_combined_shutdown_data, typed_data_from_raw,
    };

    fn event(kind: &str, agent: Option<&str>, at: &str, data: Value) -> TypedEvent {
        let mut raw: RawEvent =
            serde_json::from_value(json!({"type": kind, "data": data, "timestamp": at})).unwrap();
        raw.agent_id = agent.map(str::to_string);
        let event_type = crate::models::event_types::SessionEventType::parse_wire(kind);
        let (typed_data, warning) = typed_data_from_raw(&event_type, &raw.data);
        assert!(warning.is_none(), "{kind}");
        TypedEvent {
            raw,
            event_type,
            typed_data,
        }
    }

    fn checkpoint(at: &str, nano: u64, premium: f64) -> TypedEvent {
        event(
            "session.usage_checkpoint",
            None,
            at,
            json!({"totalNanoAiu": nano, "totalPremiumRequests": premium}),
        )
    }

    /// A legacy (per-run) shutdown.
    fn shutdown(at: &str, nano: u64, premium: f64) -> TypedEvent {
        event(
            "session.shutdown",
            None,
            at,
            json!({"shutdownType": "routine", "totalNanoAiu": nano,
                "totalPremiumRequests": premium,
                "modelMetrics": {"m": {"totalNanoAiu": nano}}}),
        )
    }

    fn totals(events: &[TypedEvent]) -> (Option<u64>, Option<f64>, Option<String>) {
        let (data, _) = extract_combined_shutdown_data(events).unwrap();
        (
            data.total_nano_aiu,
            data.total_premium_requests,
            data.metrics_timestamp.map(|t| t.to_rfc3339()),
        )
    }

    #[test]
    fn a_checkpoint_after_legacy_runs_replaces_only_the_run_it_restored() {
        let events = [
            shutdown("2026-01-01T00:00:00Z", 10, 1.0),
            shutdown("2026-01-02T00:00:00Z", 20, 2.0),
            // The resumed run restored the 20 of the shutdown before it.
            checkpoint("2026-01-03T00:00:00Z", 25, 3.0),
        ];
        assert_eq!(
            totals(&events),
            (
                Some(35),
                Some(4.0),
                Some("2026-01-03T00:00:00+00:00".into())
            )
        );
        // Model rows and segments still describe the shutdowns only.
        let (data, count) = extract_combined_shutdown_data(&events).unwrap();
        assert_eq!(count, 2);
        assert_eq!(data.model_metrics.unwrap()["m"].total_nano_aiu, Some(30));
        assert_eq!(data.session_segments.unwrap().len(), 2);
    }

    #[test]
    fn a_checkpoint_that_adds_nothing_or_goes_backwards_leaves_the_shutdown_totals() {
        let ended = "2026-01-02T00:00:00+00:00".to_string();
        for later in [
            checkpoint("2026-01-03T00:00:00Z", 20, 2.0),
            checkpoint("2026-01-03T00:00:00Z", 5, 3.0),
            checkpoint("2026-01-03T00:00:00Z", 30, 1.0),
        ] {
            let events = [shutdown("2026-01-02T00:00:00Z", 20, 2.0), later];
            assert_eq!(totals(&events), (Some(20), Some(2.0), Some(ended.clone())));
        }
    }

    #[test]
    fn only_the_main_agents_checkpoint_after_the_last_shutdown_counts() {
        let before = [
            checkpoint("2026-01-01T00:00:00Z", 50, 5.0),
            shutdown("2026-01-02T00:00:00Z", 20, 2.0),
        ];
        assert_eq!(totals(&before).0, Some(20));

        let subagent = event(
            "session.usage_checkpoint",
            Some("agent-1"),
            "2026-01-03T00:00:00Z",
            json!({"totalNanoAiu": 90}),
        );
        assert!(extract_combined_shutdown_data(&[subagent]).is_none());

        let running = [
            checkpoint("2026-01-01T00:00:00Z", 5, 1.0),
            checkpoint("2026-01-01T01:00:00Z", 8, 1.0),
        ];
        let (data, count) = extract_combined_shutdown_data(&running).unwrap();
        assert_eq!(count, 0);
        assert_eq!(
            (data.total_nano_aiu, data.total_premium_requests),
            (Some(8), Some(1.0))
        );
        assert!(data.shutdown_type.is_none() && data.model_metrics.is_none());
        assert!(data.session_segments.is_none());
    }
}
