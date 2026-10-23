//! Markdown export fidelity: nested plan and checkpoint headings, durations
//! and token labels as the app shows them, and multi-line text (the title,
//! todo descriptions) that keeps the document's structure.

use super::{MarkdownRenderer, format_duration};
use crate::document::*;
use crate::render::ExportRenderer;
use crate::test_helpers::{minimal_session, simple_turn, test_archive};

/// Plan and checkpoint headings nest under the export's section heading;
/// code and lines that only start with `#` keep their text.
#[test]
fn nests_only_real_headings_in_plans_and_checkpoints() {
    let body = "# Setup\n\
                ```bash\n\
                # install deps\n\
                pnpm i\n\
                ```\n\
                ~~~~c\n\
                #include <stdio.h>\n\
                ```\n\
                ## still code\n\
                ~~~~\n\
                #!/bin/bash\n\
                #123 is the issue\n\
                ###### Deep\n\
                \x20 ## Indented\n\
                \x20   # four spaces is code\n";
    let mut session = minimal_session();
    session.plan = Some(body.to_string());
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "Start".into(),
        filename: "001-start.md".into(),
        content: Some(body.to_string()),
    }]);

    let files = MarkdownRenderer.render(&test_archive(session)).unwrap();
    let text = files[0].as_text().unwrap();

    for heading in [
        // Plan, then checkpoint.
        "### Setup",
        "##### Setup",
        "###### Deep",
        "  #### Indented",
        "  ###### Indented",
    ] {
        assert!(
            text.contains(&format!("\n{heading}\n")),
            "{heading}\n{text}"
        );
    }
    for kept in [
        "# install deps",
        "#include <stdio.h>",
        "## still code",
        "#!/bin/bash",
        "#123 is the issue",
        "    # four spaces is code",
    ] {
        assert_eq!(
            text.matches(&format!("\n{kept}\n")).count(),
            2,
            "{kept:?} changed:\n{text}"
        );
    }
}

/// Durations read as the app's `formatDuration` writes them, and the turn's
/// token count says it is output tokens only.
#[test]
fn turn_and_tool_durations_read_as_the_app_shows_them() {
    let mut turn = simple_turn(0, "Fix", "Done", Some("gpt-5"));
    turn.duration_ms = Some(183_245);
    turn.output_tokens = Some(1_234);
    let mut quick = crate::test_helpers::simple_tool_call("view", Some(true), false);
    quick.duration_ms = Some(850);
    let mut slow = crate::test_helpers::simple_tool_call("bash", Some(true), false);
    slow.duration_ms = Some(2_100);
    turn.tool_calls = vec![quick, slow];
    let mut session = minimal_session();
    session.conversation = Some(vec![turn]);
    session.shutdown_metrics = Some(ShutdownMetrics {
        total_api_duration_ms: Some(3_725_000),
        ..Default::default()
    });

    let files = MarkdownRenderer.render(&test_archive(session)).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(
        text.contains("*Model: gpt-5 · 3m 3s · 1234 output tokens*"),
        "{text}"
    );
    assert!(text.contains("| view | ✅ | 850ms |"), "{text}");
    assert!(text.contains("| bash | ✅ | 2.1s |"), "{text}");
    assert!(text.contains("| API Duration | 1h 2m |"), "{text}");
}

#[test]
fn durations_match_the_apps_format_duration() {
    // Each pair is `formatDuration(ms)` from `@tracepilot/types`.
    for (ms, expected) in [
        (0, "0ms"),
        (999, "999ms"),
        (1000, "1s"),
        (1050, "1.1s"),
        (1150, "1.1s"),
        (1250, "1.3s"),
        (1450, "1.4s"),
        (1750, "1.8s"),
        (2050, "2s"),
        (59949, "59.9s"),
        // Rounds up to a whole minute, which reads as one.
        (59950, "1m 0s"),
        (59999, "1m 0s"),
        (60000, "1m 0s"),
        (61500, "1m 1s"),
        (183245, "3m 3s"),
        (3599999, "59m 59s"),
        (3600000, "1h 0m"),
        (3725000, "1h 2m"),
    ] {
        assert_eq!(format_duration(ms), expected, "{ms}ms");
    }
}

/// Model Usage writes a token count the source didn't report as "—", like
/// Requests, rather than 0; a reported zero stays 0.
#[test]
fn model_usage_marks_unknown_token_counts() {
    use tracepilot_core::models::event_types::{ModelMetricDetail, RequestMetrics, UsageMetrics};
    let mut session = minimal_session();
    let mut metrics = ShutdownMetrics::default();
    metrics.model_metrics.insert(
        "partial".into(),
        ModelMetricDetail {
            requests: Some(RequestMetrics {
                count: Some(2),
                cost: None,
            }),
            usage: Some(UsageMetrics {
                input_tokens: Some(1200),
                output_tokens: Some(0),
                cache_read_tokens: None,
                cache_write_tokens: None,
                reasoning_tokens: None,
            }),
            total_nano_aiu: None,
            token_details: None,
        },
    );
    metrics.model_metrics.insert(
        "snapshot-only".into(),
        ModelMetricDetail {
            requests: None,
            usage: None,
            total_nano_aiu: None,
            token_details: None,
        },
    );
    session.shutdown_metrics = Some(metrics);

    let files = MarkdownRenderer.render(&test_archive(session)).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(
        text.contains("| partial | 2 | — | 1200 | 0 | — | — |"),
        "{text}"
    );
    assert!(
        text.contains("| snapshot-only | — | — | — | — | — | — |"),
        "{text}"
    );
}

/// A todo's multi-line description stays inside its list item: every line is
/// indented under the item, so a `#` line can't become a document heading.
#[test]
fn multi_line_todo_descriptions_stay_in_their_item() {
    let mut session = minimal_session();
    session.todos = Some(TodoExport {
        items: vec![TodoItemExport {
            id: "fix".to_string(),
            title: "Fix login".to_string(),
            description: Some("Reproduce first\n\n# Then\n- patch it".to_string()),
            status: "pending".to_string(),
            created_at: None,
            updated_at: None,
        }],
        deps: vec![],
    });

    let files = MarkdownRenderer.render(&test_archive(session)).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(
        text.contains("- [ ] **fix**: Fix login\n  Reproduce first\n\n  # Then\n  - patch it\n"),
        "{text}"
    );
    assert!(!text.lines().any(|line| line == "# Then"), "{text}");
}

/// The H1 is the summary's first line: an untitled Claude Code session's
/// summary is its whole first prompt, whose own headings and lists must not
/// land in the header above the Metadata table.
#[test]
fn title_is_the_summarys_first_line() {
    let title_of = |summary: &str| {
        let mut session = minimal_session();
        session.metadata.summary = Some(summary.to_string());
        let files = MarkdownRenderer.render(&test_archive(session)).unwrap();
        let text = files[0].as_text().unwrap().to_string();
        let first = text.lines().next().unwrap().to_string();
        (first, text)
    };

    let (title, text) = title_of("Fix the login bug\n\n## Steps\n- run tests");
    assert_eq!(title, "# Session: Fix the login bug…");
    assert!(!text.contains("## Steps"), "{text}");
    assert!(!text.contains("- run tests"), "{text}");
    assert!(text.contains("\n> Exported by ["), "{text}");

    let (title, _) = title_of("\n  \n  Leading blank lines  \r\n");
    assert_eq!(title, "# Session: Leading blank lines");

    let (title, _) = title_of(&"é".repeat(300));
    assert!(title.ends_with('…'), "{title}");
    assert!(
        title.chars().count() <= "# Session: ".len() + 121,
        "{title}"
    );

    // Nothing but whitespace falls back to the id.
    let (title, _) = title_of(" \n\t");
    assert_eq!(
        title,
        format!("# Session: {}", minimal_session().metadata.id)
    );
}
