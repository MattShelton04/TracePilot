#![allow(clippy::unwrap_used, clippy::expect_used)]
//! C5 public provider contract: no synthetic shutdown, exact accounting.

use serde_json::json;
use tracepilot_core::provider::{SessionProvider, claude_code::ClaudeCodeProvider};
use tracepilot_test_support::claude::{
    HAIKU, OPUS, SessionFiles, Transcript, Usage, text, write_session,
};
use tracepilot_test_support::claude_metrics;
use tracepilot_test_support::claude_scenarios;

fn load(files: &SessionFiles) -> tracepilot_core::provider::ProviderSnapshot {
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider.discover(&|| false).unwrap().remove(0);
    provider.load_snapshot(&locator, true, &|| false).unwrap()
}

#[test]
fn snapshot_tokens_reach_the_consuming_summary() {
    let files = claude_metrics::snapshot_and_tail(false);
    let loaded = load(&files);
    let metrics = loaded
        .summary
        .shutdown_metrics
        .as_ref()
        .expect("C5 summary metrics");
    let usage = metrics.model_metrics[OPUS].usage.as_ref().unwrap();
    assert_eq!(usage.input_tokens, Some(444)); // 4 + 40 + 400
    assert_eq!(usage.output_tokens, Some(6));
    assert_eq!(metrics.cost_amount, Some(1.25));
    assert_eq!(
        metrics.cost_unit,
        Some(tracepilot_core::provider::CostUnit::Usd)
    );
    assert_eq!(
        metrics.cost_basis,
        Some(tracepilot_core::provider::CostBasis::ProviderEstimate)
    );
    assert!(metrics.coverage.as_ref().unwrap().partial);
    let converted: tracepilot_core::ShutdownMetrics = loaded.metrics.clone().unwrap().into();
    assert_eq!(
        serde_json::to_value(&converted).unwrap(),
        serde_json::to_value(metrics).unwrap()
    );
    assert!(loaded.metrics.is_some());
    assert!(
        !loaded
            .events
            .unwrap()
            .iter()
            .any(|e| e.raw.event_type == "session.shutdown")
    );
}

fn assert_usage(metrics: &tracepilot_core::ShutdownMetrics, model: &str, expected: [u64; 5]) {
    let usage = metrics.model_metrics[model].usage.as_ref().unwrap();
    assert_eq!(
        [
            usage.input_tokens.unwrap(),
            usage.cache_read_tokens.unwrap(),
            usage.cache_write_tokens.unwrap(),
            usage.output_tokens.unwrap(),
            metrics.model_metrics[model]
                .requests
                .as_ref()
                .and_then(|r| r.count)
                .unwrap_or(0)
        ],
        expected
    );
    assert!(
        metrics.model_metrics[model]
            .requests
            .as_ref()
            .is_none_or(|r| r.cost.is_none())
    );
    assert!(metrics.model_metrics[model].total_nano_aiu.is_none());
}

#[test]
fn snapshot_plus_tail_counts_only_new_main_and_launched_child_calls() {
    let loaded = load(&claude_metrics::snapshot_and_tail(true));
    let m = loaded.summary.shutdown_metrics.as_ref().unwrap();
    // Covered inclusive 444 + main tail 777 + child tail 999 = 2220.
    assert_usage(m, OPUS, [2220, 200, 2000, 24, 4]);
    assert_usage(m, HAIKU, [555, 50, 500, 6, 0]);
    assert!(m.model_metrics[HAIKU].requests.is_none());
    assert_eq!(m.total_api_duration_ms, Some(1000));
    assert_eq!(m.total_api_duration_without_retries_ms, Some(900));
    assert_eq!(m.total_tool_duration_ms, Some(800));
    assert_eq!(m.total_duration_ms, Some(2100)); // latest duplicate, not sum
    assert_eq!(m.code_changes.as_ref().unwrap().lines_added, Some(12));
    assert_eq!(m.code_changes.as_ref().unwrap().lines_removed, Some(3));
    assert!(m.cost_amount.is_some());
    assert_eq!(m.cost_unit, Some(tracepilot_core::provider::CostUnit::Usd));
    assert_eq!(
        m.cost_basis,
        Some(tracepilot_core::provider::CostBasis::TracepilotEstimate)
    );
    let coverage = m.coverage.as_ref().unwrap();
    assert!(coverage.partial);
    assert_eq!(coverage.recorded_calls, 4);
    assert_eq!(coverage.tail_calls, 2);
    assert_eq!(coverage.snapshot_cost.unwrap().amount, 1.25);
    assert!(m.shutdown_count.is_none());
    assert!(m.shutdown_type.is_none());
    assert!(m.total_nano_aiu.is_none());
    assert!(m.total_premium_requests.is_none());
}

#[test]
fn no_snapshot_prices_deduplicated_calls_and_orphans() {
    let loaded = load(&claude_metrics::recorded_only());
    let m = loaded.summary.shutdown_metrics.unwrap();
    assert_usage(&m, OPUS, [32, 20, 10, 4, 1]);
    assert_usage(&m, HAIKU, [55, 50, 0, 6, 1]);
    assert_eq!(
        m.model_metrics[OPUS]
            .usage
            .as_ref()
            .unwrap()
            .reasoning_tokens,
        Some(1)
    );
    let coverage = m.coverage.as_ref().unwrap();
    assert!(coverage.partial);
    assert_eq!(coverage.snapshot_line, None);
    assert_eq!(coverage.tail_calls, 2);
    assert!(coverage.snapshot_cost.is_none());
    assert!((m.cost_amount.unwrap() - 0.000203).abs() < 1e-12);
    // Without a snapshot, durations are estimated from transcript timestamps.
    assert!(m.total_api_duration_ms.is_some_and(|ms| ms > 0));
    assert!(m.total_duration_ms.is_some_and(|ms| ms > 0));
}

#[test]
fn resumed_ended_and_resumed_running_use_last_cumulative_snapshot_once() {
    for running in [false, true] {
        let loaded = load(&claude_scenarios::resumed(running));
        let m = loaded.summary.shutdown_metrics.unwrap();
        let coverage = m.coverage.as_ref().unwrap();
        assert!(coverage.partial, "a snapshot never proves a session ended");
        let expected = if running {
            [780, 600, 120, 23, 3]
        } else {
            [390, 300, 60, 12, 2]
        };
        assert_usage(&m, OPUS, expected);
        assert_eq!(coverage.tail_calls, usize::from(running));
        assert!(m.cost_amount.is_some());
    }
}

#[test]
fn a_calls_first_record_controls_coverage_even_if_usage_repeats_after_snapshot() {
    let mut t = Transcript::main();
    t.prompt("Start.");
    let u = Usage::new(1, 10, 100, 2);
    t.call("same", OPUS, vec![text("One.")], u, "end_turn");
    t.cost_state(&[(OPUS, u, 0.5)]);
    t.call("same", OPUS, vec![text("Repeated.")], u, "end_turn");
    let loaded = load(&write_session(&t, &[]));
    let m = loaded.summary.shutdown_metrics.unwrap();
    assert_usage(&m, OPUS, [111, 10, 100, 2, 1]);
    assert_eq!(m.coverage.as_ref().unwrap().tail_calls, 0);
    assert_eq!(m.cost_amount, Some(0.5));
}

#[test]
fn missing_recorded_cost_is_absent_even_with_snapshot_tokens() {
    let mut t = Transcript::main();
    t.prompt("Start.");
    t.bookkeeping(json!({"type":"cost-state","modelUsage":{
        OPUS:{"inputTokens":1,"outputTokens":2,"cacheReadInputTokens":3,
            "cacheCreationInputTokens":4,"thinkingTokens":1}
    }}));
    let m = load(&write_session(&t, &[]))
        .summary
        .shutdown_metrics
        .unwrap();
    assert_usage(&m, OPUS, [8, 3, 4, 2, 0]);
    assert!(m.cost_amount.is_none());
    assert!(m.coverage.unwrap().snapshot_cost.is_none());
}

#[test]
fn metadata_fallbacks_use_latest_title_then_name_then_first_human_prompt() {
    for title in [false, true] {
        for name in [false, true] {
            for origin in [false, true] {
                for pr in [false, true] {
                    let mut t = Transcript::main();
                    t.meta("Internal context.", None);
                    t.prompt("First human prompt.");
                    t.prompt("Later prompt.");
                    if name {
                        t.bookkeeping(json!({"type":"agent-name","agentName":"Earlier name"}));
                        t.bookkeeping(json!({"type":"agent-name","agentName":"Latest name"}));
                    }
                    if title {
                        t.bookkeeping(json!({"type":"ai-title","aiTitle":"Earlier title"}));
                        t.bookkeeping(json!({"type":"ai-title","aiTitle":"Latest title"}));
                        t.bookkeeping(json!({"type":"ai-title","aiTitle":"  "}));
                    }
                    if origin {
                        t.user(json!({"isMeta":true,"serverClassifierContext":{"context":{
                            "git_state":{"visibility":{"origin":{"remote":"acme/origin"}}}}},
                            "message":{"role":"user","content":"Metadata."}}));
                    }
                    if pr {
                        t.bookkeeping(json!({"type":"pr-link","prRepository":"acme/pr"}));
                    }
                    t.at(12).system(
                        "turn_duration",
                        json!({"cwd":"C:\\work\\resumed",
                        "gitBranch":"feature"}),
                    );
                    let files = write_session(&t, &[]);
                    let summary = load(&files).summary;
                    assert_eq!(
                        summary.summary.as_deref(),
                        Some(if title {
                            "Latest title"
                        } else if name {
                            "Latest name"
                        } else {
                            "First human prompt."
                        })
                    );
                    assert_eq!(
                        summary.repository.as_deref(),
                        if origin {
                            Some("acme/origin")
                        } else if pr {
                            Some("acme/pr")
                        } else {
                            None
                        }
                    );
                    assert_eq!(summary.branch.as_deref(), Some("feature"));
                    assert_eq!(summary.cwd.as_deref(), Some("C:\\work\\resumed"));
                    assert_eq!(
                        summary.created_at.unwrap().to_rfc3339(),
                        "2026-09-20T10:00:01+00:00"
                    );
                    assert_eq!(
                        summary.updated_at.unwrap().to_rfc3339(),
                        "2026-09-20T10:00:12+00:00"
                    );
                    // The detail consumer calls the trait's summary_from_events path.
                    let provider = ClaudeCodeProvider::new(files.root.path());
                    let locator = provider.discover(&|| false).unwrap().remove(0);
                    assert_eq!(
                        provider.summary_from_events(&locator, &[]).unwrap().summary,
                        summary.summary
                    );
                }
            }
        }
    }
}

#[test]
fn no_recorded_usage_means_no_fabricated_metrics() {
    let t = Transcript::main();
    let loaded = load(&write_session(&t, &[]));
    assert!(loaded.metrics.is_none());
    assert!(loaded.summary.shutdown_metrics.is_none());
    assert!(loaded.summary.created_at.is_none());
    assert!(loaded.summary.updated_at.is_none());
}

#[test]
fn recorded_modified_files_are_distinct_and_failed_edits_are_excluded() {
    use tracepilot_test_support::claude::tool_use;
    let mut t = Transcript::main();
    t.prompt("Edit files.");
    let u = Usage::new(1, 0, 0, 1);
    t.call(
        "edit",
        OPUS,
        vec![
            tool_use("edit", "Edit", json!({"file_path":"src/a.rs"})),
            tool_use("failed", "Edit", json!({"file_path":"src/failed.rs"})),
        ],
        u,
        "tool_use",
    );
    t.tool_result(
        "edit",
        json!("Edited."),
        json!({"filePath":"src/a.rs"}),
        false,
    );
    t.tool_result(
        "failed",
        json!("Failed."),
        json!({"filePath":"src/failed.rs"}),
        true,
    );
    t.record(
        "attachment",
        json!({"attachment":{"type":"edited_text_file","filename":"src/a.rs"}}),
    );
    t.record(
        "attachment",
        json!({"attachment":{"type":"edited_text_file","filename":"src/b.rs"}}),
    );
    let m = load(&write_session(&t, &[]))
        .summary
        .shutdown_metrics
        .unwrap();
    let code = m.code_changes.unwrap();
    assert_eq!(
        code.files_modified,
        Some(vec!["src/a.rs".into(), "src/b.rs".into()])
    );
    assert!(code.lines_added.is_none());
    assert!(code.lines_removed.is_none());
}

#[test]
fn modified_files_include_successful_edits_on_rewound_branches() {
    let loaded = load(&claude_metrics::rewound_edit());
    let metrics = loaded.summary.shutdown_metrics.unwrap();
    assert_usage(&metrics, OPUS, [3, 0, 0, 3, 3]);
    let files = metrics.code_changes.and_then(|code| code.files_modified);
    assert_eq!(files, Some(vec!["src/rewound.rs".into()]));
    assert!(loaded.events.unwrap().iter().any(|event| {
        event.raw.event_type == "user"
            && event
                .raw
                .native
                .as_ref()
                .is_some_and(|native| native.data["toolUseResult"]["filePath"] == "src/rewound.rs")
    }));
    assert!(
        !serde_json::to_string(&loaded.turns)
            .unwrap()
            .contains("src/rewound.rs")
    );
}

#[test]
fn modified_files_exclude_existing_plans_without_editing_calls() {
    let loaded = load(&claude_metrics::existing_plan());
    let metrics = loaded.summary.shutdown_metrics.unwrap();
    assert_usage(&metrics, OPUS, [1, 0, 0, 1, 1]);
    assert!(metrics.code_changes.is_none());
}

#[test]
fn a_subagent_launched_by_a_later_block_of_a_covered_call_is_tail_usage() {
    use tracepilot_test_support::claude::{Subagent, subagent_meta, tool_use};
    let mut t = Transcript::main();
    t.prompt("Launch later.");
    let u = Usage::new(1, 10, 100, 2);
    t.call("same", OPUS, vec![text("Plan.")], u, "tool_use");
    t.cost_state(&[(OPUS, u, 0.5)]);
    t.call(
        "same",
        OPUS,
        vec![tool_use("later", "Agent", json!({"prompt":"Check."}))],
        u,
        "tool_use",
    );
    let mut child = Transcript::subagent("later", 4);
    child.prompt("Check.");
    child.call(
        "child",
        OPUS,
        vec![text("Done.")],
        Usage::new(3, 30, 300, 4),
        "end_turn",
    );
    let files = write_session(
        &t,
        &[Subagent {
            agent_id: "later",
            transcript: &child,
            meta: Some(subagent_meta("later", "general-purpose", 1)),
        }],
    );
    let m = load(&files).summary.shutdown_metrics.unwrap();
    assert_usage(&m, OPUS, [444, 40, 400, 6, 2]);
    assert_eq!(m.coverage.as_ref().unwrap().tail_calls, 1);
    assert!(m.cost_amount.is_some());
}

#[test]
fn rewound_subagent_launches_keep_their_billed_tail_usage_and_stay_hidden() {
    use tracepilot_test_support::claude::{Subagent, subagent_meta, tool_use};
    let mut t = Transcript::main();
    t.prompt("First.");
    t.call(
        "first",
        OPUS,
        vec![text("First answer.")],
        Usage::new(1, 10, 100, 2),
        "end_turn",
    );
    let fork = t.last_uuid().unwrap();
    t.cost_state(&[(OPUS, Usage::new(1, 10, 100, 2), 0.5)]);
    t.prompt("Abandoned prompt.");
    t.call(
        "abandoned",
        OPUS,
        vec![tool_use(
            "abandoned_child",
            "Agent",
            json!({"prompt":"Check."}),
        )],
        Usage::new(3, 30, 300, 4),
        "tool_use",
    );
    let mut child = Transcript::subagent("abandoned_child", 5);
    child.prompt("Check.");
    child.call(
        "child",
        OPUS,
        vec![text("Hidden child answer.")],
        Usage::new(9, 90, 900, 10),
        "end_turn",
    );
    t.parent_next(Some(&fork));
    t.prompt("Replacement.");
    t.call(
        "replacement",
        OPUS,
        vec![text("Replacement answer.")],
        Usage::new(5, 50, 500, 6),
        "end_turn",
    );
    let files = write_session(
        &t,
        &[Subagent {
            agent_id: "abandoned_child",
            transcript: &child,
            meta: Some(subagent_meta("abandoned_child", "general-purpose", 1)),
        }],
    );
    let loaded = load(&files);
    // 111 + 333 + 999 + 555 = 1998 inclusive; outputs 2 + 4 + 10 + 6 = 22.
    let m = loaded.summary.shutdown_metrics.as_ref().unwrap();
    assert_usage(m, OPUS, [1998, 180, 1800, 22, 4]);
    assert_eq!(m.coverage.as_ref().unwrap().tail_calls, 3);
    let turns = serde_json::to_string(&loaded.turns).unwrap();
    assert!(!turns.contains("Hidden child answer."));
    assert!(!turns.contains("Abandoned prompt."));
}

#[test]
fn orphan_descendants_never_use_child_file_lines_as_snapshot_anchors() {
    use tracepilot_test_support::claude::{Subagent, subagent_meta, tool_use};
    let mut t = Transcript::main();
    t.prompt("First.");
    t.call(
        "main",
        OPUS,
        vec![text("Done.")],
        Usage::new(1, 10, 100, 2),
        "end_turn",
    );
    t.cost_state(&[(OPUS, Usage::new(1, 10, 100, 2), 0.5)]); // main-file line 3
    let mut parent = Transcript::subagent("a_parent", 6);
    parent.prompt("Orphan.");
    parent.call(
        "orphan_first",
        OPUS,
        vec![text("Done.")],
        Usage::new(2, 20, 200, 3),
        "end_turn",
    );
    let fork = parent.last_uuid().unwrap();
    for _ in 0..3 {
        parent.system("turn_duration", json!({"durationMs":1}));
    }
    parent.prompt("Rewound.");
    parent.call(
        "orphan_launch",
        OPUS,
        vec![tool_use(
            "local_launch",
            "Agent",
            json!({"prompt":"Check."}),
        )],
        Usage::new(3, 30, 300, 4),
        "tool_use",
    ); // child-file line 7, not main-file line 7
    parent.parent_next(Some(&fork));
    parent.prompt("Replacement.");
    parent.call(
        "orphan_replacement",
        OPUS,
        vec![text("Done.")],
        Usage::new(5, 50, 500, 6),
        "end_turn",
    );
    let mut child = Transcript::subagent("z_grandchild", 7);
    child.prompt("Check.");
    child.call(
        "grandchild",
        OPUS,
        vec![text("Done.")],
        Usage::new(4, 40, 400, 5),
        "end_turn",
    );
    let files = write_session(
        &t,
        &[
            Subagent {
                agent_id: "a_parent",
                transcript: &parent,
                meta: None,
            },
            Subagent {
                agent_id: "z_grandchild",
                transcript: &child,
                meta: Some(subagent_meta("local_launch", "general-purpose", 2)),
            },
        ],
    );
    let parsed =
        tracepilot_core::provider::claude_code::parse_claude_session(&files.main, &|| false)
            .unwrap();
    assert!(
        parsed
            .calls
            .iter()
            .filter(|c| c.agent_id.is_some())
            .all(|c| c.snapshot_anchor.is_none())
    );
    let m = load(&files).summary.shutdown_metrics.unwrap();
    assert_usage(&m, OPUS, [111, 10, 100, 2, 5]);
    assert_eq!(m.coverage.unwrap().tail_calls, 0);
}
