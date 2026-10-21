//! Markdown export fidelity: nested plan and checkpoint headings, and
//! durations and token labels as the app shows them.

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
        (59950, "60s"),
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
