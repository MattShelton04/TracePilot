//! Sessions resumed after a custom range, through the repository, source and
//! hide-empty filters: the headline usage, the day charts, the model mix and
//! the per-source split all count the same runs, in the index and in the
//! disk fallback alike.

use std::path::Path;
use std::sync::Arc;

use tracepilot_core::analytics::types::AnalyticsData;
use tracepilot_core::analytics::{compute_analytics_in_range, load_full_sessions_active_in_range};
use tracepilot_core::provider::{SessionProvider, SessionSource, claude_code::ClaudeCodeProvider};
use tracepilot_test_support::claude_metrics;

use super::range_totals::{chart_tokens, resume};
use super::segment_totals::shutdown;
use crate::index_db::{IndexDb, session_writer};

const NANO: u64 = 1_000_000_000;

/// A Copilot session in `repo`, last active at `updated_at`, with one run
/// per `(end day, tokens)`; `prompt` adds a user message, so a turn.
fn copilot(
    root: &Path,
    id: &str,
    repo: &str,
    updated_at: &str,
    prompt: bool,
    runs: &[(&str, u64)],
) -> std::path::PathBuf {
    let dir = root.join(id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {id}\nsummary: \"Range\"\nrepository: \"{repo}\"\nbranch: main\ncwd: 'C:\\test'\nhost_type: cli\ncreated_at: \"2026-09-18T08:00:00Z\"\nupdated_at: \"{updated_at}\"\n"
        ),
    )
    .unwrap();
    let mut body = String::new();
    if prompt {
        body.push_str(
            r#"{"type":"user.message","data":{"content":"go","interactionId":"int-1"},"id":"u1","timestamp":"2026-09-18T08:00:01Z"}"#,
        );
        body.push('\n');
    }
    for (i, (day, tokens)) in runs.iter().enumerate() {
        if i > 0 {
            body.push_str(&resume(&format!("r{i}"), &format!("{day}T09:00:00Z")));
            body.push('\n');
        }
        let units = *tokens as f64;
        let run = shutdown(
            &format!("s{i}"),
            &format!("{day}T10:00:00Z"),
            *tokens,
            tokens * NANO,
            units,
            "",
        );
        body.push_str(&run);
        body.push('\n');
    }
    std::fs::write(dir.join("events.jsonl"), body).unwrap();
    dir
}

/// Copilot sessions in a temp root (for the disk fallback) indexed next to
/// one Claude Code session resumed across 09-20, 09-21 and 09-22.
fn indexed(root: &Path) -> IndexDb {
    let db = IndexDb::open_or_create(&root.join("index.db")).unwrap();
    let a = "org/a";
    let sessions = [
        // Resumed after a closed range: last active 09-23.
        (
            "aaaaaaaa-0000-4000-8000-000000000001",
            a,
            "2026-09-23T10:00:00Z",
            true,
            vec![("2026-09-20", 100), ("2026-09-23", 400)],
        ),
        // Last active in the range, with an earlier run before it.
        (
            "aaaaaaaa-0000-4000-8000-000000000002",
            a,
            "2026-09-21T10:00:00Z",
            true,
            vec![("2026-09-19", 50), ("2026-09-21", 200)],
        ),
        // No runs, last active after the closed range.
        (
            "aaaaaaaa-0000-4000-8000-000000000003",
            a,
            "2026-09-24T10:00:00Z",
            true,
            vec![],
        ),
        // Resumed, but no run ends in the closed range.
        (
            "aaaaaaaa-0000-4000-8000-000000000004",
            a,
            "2026-09-24T10:00:00Z",
            true,
            vec![("2026-09-18", 30), ("2026-09-24", 70)],
        ),
        // Resumed after the range, in another repository.
        (
            "aaaaaaaa-0000-4000-8000-000000000005",
            "org/b",
            "2026-09-23T10:00:00Z",
            true,
            vec![("2026-09-21", 10), ("2026-09-23", 20)],
        ),
        // Last active after the range, with no turns (hidden as empty).
        (
            "aaaaaaaa-0000-4000-8000-000000000006",
            a,
            "2026-09-23T10:00:00Z",
            false,
            vec![("2026-09-20", 5)],
        ),
    ];
    for (id, repo, updated_at, prompt, runs) in &sessions {
        let path = copilot(root, id, repo, updated_at, *prompt, runs);
        db.upsert_session(&path).unwrap();
    }

    let claude = claude_metrics::resumed_across_days(true);
    let provider: Arc<dyn SessionProvider> = Arc::new(ClaudeCodeProvider::new(claude.root.path()));
    let locator = provider.discover(&|| false).unwrap().remove(0);
    let prepared = session_writer::prepare_snapshot(&provider, &locator, &|| false).unwrap();
    db.write_prepared_session(&prepared).unwrap();
    db
}

/// The headline agrees with every per-day, per-model and per-source split.
fn assert_consistent(data: &AnalyticsData, at: &str) {
    assert_eq!(chart_tokens(data), data.total_tokens, "day chart: {at}");
    let model_tokens: u64 = data.model_distribution.iter().map(|m| m.tokens).sum();
    assert_eq!(model_tokens, data.total_tokens, "model mix: {at}");
    let source_tokens: u64 = data.cost_by_source.iter().map(|e| e.tokens).sum();
    assert_eq!(source_tokens, data.total_tokens, "by source: {at}");
    let source_sessions: u32 = data.cost_by_source.iter().map(|e| e.sessions).sum();
    assert_eq!(
        source_sessions, data.total_sessions,
        "source sessions: {at}"
    );
    let day_nano: u64 = data
        .model_usage_by_day
        .iter()
        .filter_map(|d| d.total_nano_aiu)
        .sum();
    assert_eq!(day_nano, data.total_nano_aiu, "daily AI Credits: {at}");
    let day_premium: f64 = data.cost_by_day.iter().map(|d| d.cost).sum();
    assert_eq!(day_premium, data.total_premium_requests, "premium: {at}");
}

#[test]
fn resumed_sessions_add_up_through_repo_source_and_empty_filters() {
    let temp = tempfile::tempdir().unwrap();
    let db = indexed(temp.path());
    let copilot = Some(SessionSource::Copilot);
    let ranges = [
        (Some("2026-09-20"), Some("2026-09-21")),
        (Some("2026-09-21"), None),
        (None, None),
    ];
    for (from, to) in ranges {
        for repo in [None, Some("org/a")] {
            for hide_empty in [false, true] {
                for source in [None, copilot, Some(SessionSource::ClaudeCode)] {
                    let at = format!(
                        "from={from:?} to={to:?} repo={repo:?} hide_empty={hide_empty} source={source:?}"
                    );
                    let data = db
                        .query_analytics(from, to, repo, hide_empty, source)
                        .unwrap();
                    assert_consistent(&data, &at);
                    if source != copilot {
                        continue;
                    }
                    // The disk fallback reads the Copilot sessions alone.
                    let inputs =
                        load_full_sessions_active_in_range(temp.path(), from, to, repo, hide_empty)
                            .unwrap();
                    let fallback =
                        serde_json::to_value(compute_analytics_in_range(&inputs, from, to))
                            .unwrap();
                    let indexed = serde_json::to_value(&data).unwrap();
                    for field in [
                        "totalSessions",
                        "totalTokens",
                        "totalCost",
                        "totalPremiumRequests",
                        "totalNanoAiu",
                        "costBySource",
                        "modelDistribution",
                        "tokenUsageByDay",
                        "costByDay",
                        "modelUsageByDay",
                    ] {
                        assert_eq!(indexed[field], fallback[field], "{field}: {at}");
                    }
                }
            }
        }
    }

    // Copilot sessions and tokens, by hand from the runs above.
    let count = |from, to, repo, hide_empty| {
        let data = db
            .query_analytics(from, to, repo, hide_empty, copilot)
            .unwrap();
        (data.total_sessions, data.total_tokens)
    };
    let (from, to) = (Some("2026-09-20"), Some("2026-09-21"));
    // 100 (resumed) + 200 (last active in it) + 10 (org/b) + 5 (empty).
    assert_eq!(count(from, to, None, false), (4, 315));
    assert_eq!(count(from, to, Some("org/a"), false), (3, 305));
    assert_eq!(count(from, to, Some("org/a"), true), (2, 300));
    // A preset: everything since 09-21, including the run-less session.
    assert_eq!(count(Some("2026-09-21"), None, None, false), (6, 700));
    assert_eq!(count(None, None, None, false), (6, 885));
    // The Claude Code session is resumed after the closed range too.
    let all = db.query_analytics(from, to, None, false, None).unwrap();
    assert_eq!((all.total_sessions, all.total_tokens), (5, 315 + 174 + 785));
}
