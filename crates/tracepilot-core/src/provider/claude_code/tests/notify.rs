//! `<task-notification>` parsing (notify.rs).

use super::super::notify::*;
use crate::models::event_types::TaskNotificationKind;

#[test]
fn parses_fields_and_multiple_blocks() {
    let text = "<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n\
        <status>completed</status>\n<summary>Agent \"x\" finished</summary>\n\
        <usage><subagent_tokens>180</subagent_tokens><tool_uses>4</tool_uses>\
        <duration_ms>600</duration_ms></usage>\n</task-notification>\n\
        <task-notification><task-id>b2</task-id><status>failed</status>";
    let parsed = parse_notifications(text);
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].task_id.as_deref(), Some("a1"));
    assert_eq!(parsed[0].tool_use_id.as_deref(), Some("toolu_1"));
    assert_eq!(parsed[0].total_tokens, Some(180));
    assert_eq!(parsed[0].tool_uses, Some(4));
    assert_eq!(parsed[0].duration_ms, Some(600));
    assert!(parsed[0].text.ends_with("</task-notification>"));
    assert_eq!(parsed[1].key(), ("b2".into(), "failed".into()));
    assert!(parse_notifications("no notification").is_empty());
}

#[test]
fn parses_result_output_file_and_exit_code() {
    let text = "<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n\
        <output-file>C:\\tmp\\tasks\\a1.output</output-file>\n<status>completed</status>\n\
        <summary>Agent \"Map it\" finished</summary>\n\
        <result>The map has &lt;3&gt; stages.\n\nDone.</result>\n\
        <usage><subagent_tokens>180000</subagent_tokens><tool_uses>40</tool_uses>\
        <duration_ms>600000</duration_ms></usage>\n</task-notification>";
    let note = &parse_notifications(text)[0];
    assert_eq!(
        note.result.as_deref(),
        Some("The map has <3> stages.\n\nDone.")
    );
    assert_eq!(
        note.output_file.as_deref(),
        Some("C:\\tmp\\tasks\\a1.output")
    );
    assert_eq!(note.exit_code, None);
    assert_eq!(note.total_tokens, Some(180_000));

    let shell = "<task-notification><task-id>b1</task-id><status>failed</status>\
        <summary>Background command \"npm test\" failed with exit code 1</summary>\
        </task-notification><task-notification><task-id>b2</task-id>\
        <summary>Background command \"x\" completed (exit code -2)</summary></task-notification>";
    let parsed = parse_notifications(shell);
    assert_eq!(parsed[0].exit_code, Some(1));
    assert_eq!(parsed[0].result, None);
    assert_eq!(parsed[1].exit_code, Some(-2));
    assert_eq!(exit_code("exit code"), None);
    assert_eq!(exit_code("no code here"), None);
}

#[test]
fn tags_inside_the_result_never_stand_in_for_the_blocks_own() {
    // The report quotes tags of its own before the real summary and
    // usage, and even a stray closing tag.
    let text = "<task-notification><task-id>a1</task-id>\
        <result>I saw <summary>quoted summary</summary> and <status>failed</status> \
        and <subagent_tokens>1</subagent_tokens> and </result> mid-text.</result>\
        <status>completed</status><summary>Agent \"real\" finished</summary>\
        <usage><subagent_tokens>900</subagent_tokens></usage></task-notification>";
    let note = &parse_notifications(text)[0];
    assert_eq!(note.summary.as_deref(), Some("Agent \"real\" finished"));
    assert_eq!(note.status.as_deref(), Some("completed"));
    assert_eq!(note.total_tokens, Some(900));
    let result = note.result.as_deref().unwrap();
    assert!(result.starts_with("I saw <summary>quoted summary</summary>"));
    assert!(result.ends_with("</result> mid-text."));

    // A block cut mid-report keeps what was written.
    let cut = "<task-notification><summary>s</summary><result>partial";
    let note = &parse_notifications(cut)[0];
    assert_eq!(note.result.as_deref(), Some("partial"));
    assert_eq!(note.summary.as_deref(), Some("s"));
}

#[test]
fn readable_line_names_the_task_and_its_totals() {
    let agent = TaskNotification {
        summary: Some("Agent \"Map it\" finished".into()),
        total_tokens: Some(180_000),
        tool_uses: Some(40),
        duration_ms: Some(600_000),
        ..Default::default()
    };
    assert_eq!(
        agent.readable_line(TaskNotificationKind::Agent),
        "Agent \"Map it\" finished · 180K tokens · 40 tool uses · 10m"
    );
    let bare = TaskNotification {
        status: Some("stopped".into()),
        tool_uses: Some(1),
        ..Default::default()
    };
    assert_eq!(
        bare.readable_line(TaskNotificationKind::Shell),
        "Background command stopped · 1 tool use"
    );
    assert_eq!(
        TaskNotification::default().readable_line(TaskNotificationKind::Agent),
        "Agent finished"
    );

    assert_eq!(compact_count(999), "999");
    assert_eq!(compact_count(9_600), "9.6K");
    assert_eq!(compact_count(12_000), "12K");
    assert_eq!(compact_count(123_456), "123.5K");
    assert_eq!(compact_count(1_260_000), "1.3M");
    assert_eq!(compact_duration(400), "0s");
    assert_eq!(compact_duration(9_000), "9s");
    assert_eq!(compact_duration(150_000), "2m 30s");
    assert_eq!(compact_duration(3_600_000), "1h");
    assert_eq!(compact_duration(3_900_000), "1h 5m");
}

#[test]
fn monitor_events_keep_their_payload() {
    // The event is free text: a tag quoted in it can't stand in for the block's own.
    let text = "<task-notification>\n<task-id>bmon1</task-id>\n<tool-use-id>toolu_m1</tool-use-id>\n\
        <summary>Monitor event: \"PR #12 check results\"</summary>\n\
        <event>Quality gate: pass &amp; ready\nlint: ok <summary>not this</summary></event>\n\
        </task-notification>";
    let note = &parse_notifications(text)[0];
    assert!(note.is_monitor());
    assert_eq!(
        note.summary.as_deref(),
        Some("Monitor event: \"PR #12 check results\"")
    );
    assert_eq!(
        note.event.as_deref(),
        Some("Quality gate: pass & ready\nlint: ok <summary>not this</summary>")
    );
    assert_eq!(note.status, None);
    assert_eq!(note.result, None);
    assert_eq!(
        note.readable_line(TaskNotificationKind::Monitor),
        "Monitor event: \"PR #12 check results\" · Quality gate: pass & ready"
    );

    // A stream that ended carries no event but is still a Monitor's.
    let ended = "<task-notification><task-id>bmon1</task-id>\
        <summary>Monitor \"PR #12 checks\" stream ended</summary></task-notification>";
    assert!(parse_notifications(ended)[0].is_monitor());
    assert!(
        !parse_notifications(
            "<task-notification><summary>Background command \"x\" \
        completed (exit code 0)</summary></task-notification>"
        )[0]
        .is_monitor()
    );

    let long = format!("{}\nsecond", "x".repeat(200));
    let line = first_line(&format!("\n  \n{long}")).unwrap();
    assert_eq!(line.chars().count(), 161);
    assert!(line.ends_with('…'));
}

#[test]
fn only_notification_blocks_make_a_wake_record() {
    let block = "<task-notification><task-id>a1</task-id></task-notification>";
    assert!(only_notifications(block));
    assert!(only_notifications(&format!("\n{block}\n\n{block}\n")));
    assert!(only_notifications("<task-notification><task-id>a1"));
    assert!(!only_notifications(&format!(
        "Render this as a card:\n{block}"
    )));
    assert!(!only_notifications(&format!("{block}\nwhy did it fail?")));
    assert!(!only_notifications("  "));
}

#[test]
fn decodes_xml_entities_in_tag_values_once() {
    // Claude Code escapes tag text the way XML does.
    let text = "<task-notification>\n<task-id>b3</task-id>\n<status>completed</status>\n\
        <summary>Background command \"uv run x &gt; out.txt &amp;&amp; echo &lt;ok&gt;\" \
        completed (exit code 0)</summary>\n</task-notification>";
    let note = &parse_notifications(text)[0];
    assert_eq!(
        note.summary.as_deref(),
        Some("Background command \"uv run x > out.txt && echo <ok>\" completed (exit code 0)")
    );
    // The block itself stays as written.
    assert!(note.text.contains("&gt; out.txt"));

    // Quotes, apostrophes and numeric references; an escaped entity
    // decodes one level only.
    let text = "<task-notification><task-id>b4</task-id><summary>&quot;a&quot; &apos;b&apos; \
        &#60;c&#x3E; &#65; &amp;gt; &amp;amp;</summary></task-notification>";
    assert_eq!(
        parse_notifications(text)[0].summary.as_deref(),
        Some("\"a\" 'b' <c> A &gt; &amp;")
    );
}

#[test]
fn leaves_unknown_or_malformed_entities_alone() {
    let text = "<task-notification><summary>AT&T &nbsp; &#xZZ; &#; &#+65; &#1114112; &amp</summary>\
        </task-notification>";
    assert_eq!(
        parse_notifications(text)[0].summary.as_deref(),
        Some("AT&T &nbsp; &#xZZ; &#; &#+65; &#1114112; &amp")
    );
}
