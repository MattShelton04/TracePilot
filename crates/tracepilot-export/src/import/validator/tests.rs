use super::*;
use crate::document::CheckpointExport;
use crate::test_helpers::{minimal_session, test_archive};

#[test]
fn valid_archive_passes() {
    let archive = test_archive(minimal_session());
    assert!(validate_archive(&archive).is_ok());
}

#[test]
fn rejects_empty_archive() {
    let mut archive = test_archive(minimal_session());
    archive.sessions.clear();
    assert!(validate_archive(&archive).is_err());
}

#[test]
fn rejects_empty_session_id() {
    let mut session = minimal_session();
    session.metadata.id = String::new();
    let archive = test_archive(session);
    assert!(validate_archive(&archive).is_err());
}

#[test]
fn rejects_path_traversal_in_id() {
    let mut session = minimal_session();
    session.metadata.id = "../../../etc/passwd".to_string();
    let archive = test_archive(session);
    let err = validate_archive(&archive).unwrap_err();
    assert!(err.to_string().contains("path traversal"));
}

#[test]
fn rejects_absolute_unix_path_in_id() {
    let mut session = minimal_session();
    session.metadata.id = "/etc/evil".to_string();
    let archive = test_archive(session);
    assert!(validate_archive(&archive).is_err());
}

#[cfg(windows)]
#[test]
fn rejects_windows_absolute_path_in_id() {
    let mut session = minimal_session();
    session.metadata.id = r"C:\evil\pwn".to_string();
    let archive = test_archive(session);
    assert!(validate_archive(&archive).is_err());
}

#[cfg(windows)]
#[test]
fn rejects_unc_path_in_id() {
    let mut session = minimal_session();
    session.metadata.id = r"\\server\share".to_string();
    let archive = test_archive(session);
    assert!(validate_archive(&archive).is_err());
}

#[test]
fn rejects_path_traversal_in_checkpoint_filename() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "evil".to_string(),
        filename: "../../evil.sh".to_string(),
        content: None,
    }]);
    let archive = test_archive(session);
    assert!(validate_archive(&archive).is_err());
}

#[test]
fn rejects_dangerous_filename_chars() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "bad".to_string(),
        filename: "file|bad.md".to_string(),
        content: None,
    }]);
    let archive = test_archive(session);
    assert!(validate_archive(&archive).is_err());
}

#[test]
fn collect_issues_finds_warnings() {
    let mut session = minimal_session();
    session.conversation = None;
    session.events = None;
    let archive = test_archive(session);

    let issues = collect_issues(&archive);
    assert!(issues.iter().any(|i| i.severity == IssueSeverity::Warning));
}

#[test]
fn collect_issues_finds_errors() {
    let mut session = minimal_session();
    session.metadata.id = String::new();
    let archive = test_archive(session);

    let issues = collect_issues(&archive);
    assert!(issues.iter().any(|i| i.is_error()));
}

#[test]
fn rejects_duplicate_session_ids() {
    let s1 = minimal_session();
    let s2 = minimal_session(); // same ID as s1
    let mut archive = test_archive(s1);
    archive.sessions.push(s2);

    let err = validate_archive(&archive).unwrap_err();
    assert!(err.to_string().contains("Duplicate session ID"));
}

#[test]
fn collect_issues_reports_duplicate_ids() {
    let s1 = minimal_session();
    let s2 = minimal_session();
    let mut archive = test_archive(s1);
    archive.sessions.push(s2);

    let issues = collect_issues(&archive);
    assert!(
        issues
            .iter()
            .any(|i| i.is_error() && i.message.contains("Duplicate session ID"))
    );
}

#[test]
fn rejects_reserved_checkpoint_filename() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "sneaky".to_string(),
        filename: "index.md".to_string(),
        content: Some("overwrite the index".to_string()),
    }]);
    let archive = test_archive(session);
    let err = validate_archive(&archive).unwrap_err();
    assert!(err.to_string().contains("reserved"));
}

#[test]
fn warns_on_non_uuid_session_id() {
    let mut session = minimal_session();
    session.metadata.id = "not-a-uuid".to_string();
    let archive = test_archive(session);

    let issues = collect_issues(&archive);
    assert!(
        issues
            .iter()
            .any(|i| { i.severity == IssueSeverity::Warning && i.message.contains("not a UUID") })
    );
}

#[test]
fn no_warning_for_valid_uuid() {
    let mut session = minimal_session();
    session.metadata.id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_string();
    let archive = test_archive(session);
    let issues = collect_issues(&archive);
    assert!(!issues.iter().any(|i| i.message.contains("not a UUID")));
}

#[test]
fn reports_duplicate_checkpoint_filenames() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![
        CheckpointExport {
            number: 1,
            title: "first".to_string(),
            filename: "001-first.md".to_string(),
            content: None,
        },
        CheckpointExport {
            number: 2,
            title: "dup".to_string(),
            filename: "001-first.md".to_string(),
            content: None,
        },
    ]);
    let archive = test_archive(session);
    let issues = collect_issues(&archive);
    assert!(
        issues
            .iter()
            .any(|i| i.is_error() && i.message.contains("duplicate checkpoint filename"))
    );
}

#[test]
fn rejects_path_separator_in_checkpoint_filename() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "nested".to_string(),
        filename: "nested/file.md".to_string(),
        content: None,
    }]);
    let archive = test_archive(session);
    let err = validate_archive(&archive).unwrap_err();
    assert!(err.to_string().contains("path separator"));
}

#[test]
fn rejects_backslash_in_checkpoint_filename() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "nested".to_string(),
        filename: r"nested\file.md".to_string(),
        content: None,
    }]);
    let archive = test_archive(session);
    let err = validate_archive(&archive).unwrap_err();
    assert!(err.to_string().contains("path separator"));
}

#[test]
fn collect_issues_rejects_path_separator_in_checkpoint_filename() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "nested".to_string(),
        filename: "sub/dir.md".to_string(),
        content: None,
    }]);
    let archive = test_archive(session);
    let issues = collect_issues(&archive);
    assert!(
        issues
            .iter()
            .any(|i| i.is_error() && i.message.contains("path separator"))
    );
}

#[test]
fn collect_issues_reports_reserved_checkpoint_filename() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "sneaky".to_string(),
        filename: "index.md".to_string(),
        content: Some("overwrite the index".to_string()),
    }]);
    let archive = test_archive(session);
    let issues = collect_issues(&archive);
    assert!(
        issues
            .iter()
            .any(|i| i.is_error() && i.message.contains("reserved"))
    );
}

#[test]
fn collect_issues_reports_dangerous_chars_in_checkpoint_filename() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "bad".to_string(),
        filename: "file|bad.md".to_string(),
        content: None,
    }]);
    let archive = test_archive(session);
    let issues = collect_issues(&archive);
    assert!(
        issues
            .iter()
            .any(|i| i.is_error() && i.message.contains("dangerous characters"))
    );
}

// ── Tests for previously-missing checks (fixed by unification) ──

#[test]
fn validate_archive_rejects_duplicate_checkpoint_filenames() {
    // Previously only collect_issues checked this — validate_archive did not.
    let mut session = minimal_session();
    session.checkpoints = Some(vec![
        CheckpointExport {
            number: 1,
            title: "first".to_string(),
            filename: "001-first.md".to_string(),
            content: None,
        },
        CheckpointExport {
            number: 2,
            title: "dup".to_string(),
            filename: "001-first.md".to_string(),
            content: None,
        },
    ]);
    let archive = test_archive(session);
    let err = validate_archive(&archive).unwrap_err();
    assert!(err.to_string().contains("duplicate checkpoint filename"));
}

#[test]
fn collect_issues_reports_plan_too_large() {
    // Previously only validate_session checked plan size — collect_issues did not.
    let mut session = minimal_session();
    session.plan = Some("x".repeat(MAX_SECTION_SIZE + 1));
    let archive = test_archive(session);

    let issues = collect_issues(&archive);
    assert!(
        issues
            .iter()
            .any(|i| i.is_error() && i.message.contains("plan too large"))
    );
}

#[test]
fn collect_issues_reports_too_many_events() {
    // Previously only validate_session checked event count — collect_issues did not.
    use crate::document::RawEvent;

    let event = RawEvent {
        event_type: "test".to_string(),
        data: serde_json::Value::Null,
        id: None,
        timestamp: None,
        parent_id: None,
    };
    let mut session = minimal_session();
    session.events = Some(vec![event; MAX_EVENTS + 1]);
    let archive = test_archive(session);
    let issues = collect_issues(&archive);
    assert!(
        issues
            .iter()
            .any(|i| i.is_error() && i.message.contains("too many events"))
    );
}

#[test]
fn preview_and_import_agree_on_plan_too_large() {
    // Regression guard: both paths must reject an oversized plan.
    let mut session = minimal_session();
    session.plan = Some("x".repeat(MAX_SECTION_SIZE + 1));
    let archive = test_archive(session);

    let issues = collect_issues(&archive);
    let validate_result = validate_archive(&archive);

    assert!(issues.iter().any(|i| i.is_error()));
    assert!(validate_result.is_err());
}

#[test]
fn preview_and_import_agree_on_duplicate_checkpoint_filenames() {
    // Regression guard: both paths must reject duplicate checkpoint filenames.
    let mut session = minimal_session();
    session.checkpoints = Some(vec![
        CheckpointExport {
            number: 1,
            title: "first".to_string(),
            filename: "dup.md".to_string(),
            content: None,
        },
        CheckpointExport {
            number: 2,
            title: "second".to_string(),
            filename: "dup.md".to_string(),
            content: None,
        },
    ]);
    let archive = test_archive(session);

    let issues = collect_issues(&archive);
    let validate_result = validate_archive(&archive);

    assert!(issues.iter().any(|i| i.is_error()));
    assert!(validate_result.is_err());
}

#[test]
fn warnings_do_not_block_import() {
    // Warnings (non-UUID ID, missing conversation/events) must not cause
    // validate_archive to fail — only errors should block.
    let mut session = minimal_session();
    session.metadata.id = "not-a-uuid".to_string();
    session.conversation = None;
    session.events = None;
    let archive = test_archive(session);

    let issues = collect_issues(&archive);
    // Should have warnings but no errors
    assert!(issues.iter().any(|i| i.severity == IssueSeverity::Warning));
    assert!(!issues.iter().any(|i| i.is_error()));
    // Import should succeed
    assert!(validate_archive(&archive).is_ok());
}
