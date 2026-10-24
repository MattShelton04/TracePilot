//! Export command helpers: option building, section parsing and writing output.

use super::*;

#[test]
fn build_export_detail_options_uses_defaults_when_all_none() {
    let (content, redaction) = build_export_detail_options(None, None, None, None, None, None);
    let default_content = ContentDetailOptions::default();
    let default_redaction = RedactionOptions::default();

    assert_eq!(
        content.include_subagent_internals,
        default_content.include_subagent_internals
    );
    assert_eq!(
        content.include_tool_details,
        default_content.include_tool_details
    );
    assert_eq!(
        content.include_full_tool_results,
        default_content.include_full_tool_results
    );

    assert_eq!(redaction.anonymize_paths, default_redaction.anonymize_paths);
    assert_eq!(redaction.strip_secrets, default_redaction.strip_secrets);
    assert_eq!(redaction.strip_pii, default_redaction.strip_pii);
}

#[test]
fn build_export_detail_options_respects_explicit_values() {
    let (content, redaction) = build_export_detail_options(
        Some(false),
        Some(false),
        Some(true),
        Some(true),
        Some(true),
        Some(true),
    );

    assert!(!content.include_subagent_internals);
    assert!(!content.include_tool_details);
    assert!(content.include_full_tool_results);

    assert!(redaction.anonymize_paths);
    assert!(redaction.strip_secrets);
    assert!(redaction.strip_pii);
}

#[test]
fn build_export_detail_options_handles_partial_overrides() {
    let (content, redaction) =
        build_export_detail_options(Some(false), None, None, None, Some(true), None);

    assert!(!content.include_subagent_internals); // overridden
    assert!(content.include_tool_details); // default
    assert!(!content.include_full_tool_results); // default

    assert!(!redaction.anonymize_paths); // default
    assert!(redaction.strip_secrets); // overridden
    assert!(!redaction.strip_pii); // default
}

#[test]
fn empty_sections_returns_empty_set() {
    let result = parse_sections(&[]).unwrap();
    assert!(
        result.is_empty(),
        "empty input should produce empty set, not all sections"
    );
}

#[test]
fn explicit_sections_are_parsed() {
    let result = parse_sections(&["conversation".to_string(), "plan".to_string()]).unwrap();
    assert_eq!(result.len(), 2);
    assert!(result.contains(&SectionId::Conversation));
    assert!(result.contains(&SectionId::Plan));
}

#[test]
fn unknown_section_returns_error() {
    let result = parse_sections(&["nonexistent".to_string()]);
    assert!(result.is_err());
}

fn export_file(name: &str, content: &str) -> ExportFile {
    ExportFile {
        filename: name.into(),
        content: content.as_bytes().to_vec(),
        mime_type: "application/json".into(),
    }
}

#[test]
fn failed_write_names_the_output_file() {
    let dir = tempfile::tempdir().unwrap();
    // A directory where the file should go makes the write fail everywhere.
    let out = dir.path().join("session.tpx.json");
    std::fs::create_dir(&out).unwrap();

    let err = write_export_files(&out, &[export_file("a.tpx.json", "{}")]).unwrap_err();

    assert!(matches!(err, BindingsError::Export(_)), "{err:?}");
    let message = err.to_string();
    assert!(message.contains("session.tpx.json"), "{message}");
}

#[test]
fn writes_one_file_to_the_chosen_path_and_several_beside_it() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("nested").join("chosen.md");

    let size = write_export_files(&out, &[export_file("ignored.md", "# One")]).unwrap();
    assert_eq!(size, 5);
    assert_eq!(std::fs::read_to_string(&out).unwrap(), "# One");

    let files = [export_file("a.md", "aa"), export_file("b.md", "bbb")];
    let size = write_export_files(&out, &files).unwrap();
    assert_eq!(size, 5);
    let parent = out.parent().unwrap();
    assert_eq!(std::fs::read_to_string(parent.join("a.md")).unwrap(), "aa");
    assert_eq!(std::fs::read_to_string(parent.join("b.md")).unwrap(), "bbb");
}

/// An earlier export that another process holds a lock on (as editors and
/// sync clients do) is never left truncated by a failed overwrite.
#[cfg(windows)]
#[test]
fn locked_earlier_export_is_not_truncated() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("session.md");
    std::fs::write(&out, "earlier export").unwrap();
    let held = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&out)
        .unwrap();
    held.lock().unwrap();

    let result = write_export_files(&out, &[export_file("session.md", "# New")]);
    drop(held);

    let content = std::fs::read_to_string(&out).unwrap();
    match result {
        Ok(_) => assert_eq!(content, "# New"),
        Err(err) => assert_eq!(content, "earlier export", "{err}"),
    }
}

#[test]
fn unusable_output_folder_is_named() {
    let dir = tempfile::tempdir().unwrap();
    // A file where the folder should be makes creating the folder fail.
    let blocker = dir.path().join("exports");
    std::fs::write(&blocker, "").unwrap();
    let out = blocker.join("session.md");

    let err = write_export_files(&out, &[export_file("session.md", "# New")]).unwrap_err();

    assert!(matches!(err, BindingsError::Export(_)), "{err:?}");
    let message = err.to_string();
    assert!(message.contains("session.md"), "{message}");
}

fn session_db(dir: &Path, sql: &str) {
    rusqlite::Connection::open(dir.join("session.db"))
        .unwrap()
        .execute_batch(sql)
        .unwrap();
}

const TODOS_TABLE: &str = "CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, \
    description TEXT, status TEXT NOT NULL, created_at TEXT, updated_at TEXT);";

fn sections_of(dir: &Path) -> SessionSectionsInfo {
    directory_sections(SessionId::from_validated("s1".to_string()), dir)
}

#[test]
fn todos_are_offered_only_when_the_database_has_todo_rows() {
    let none = tempfile::tempdir().unwrap();
    assert!(!sections_of(none.path()).has_todos, "no session.db");

    let empty = tempfile::tempdir().unwrap();
    session_db(empty.path(), TODOS_TABLE);
    assert!(!sections_of(empty.path()).has_todos, "empty todos table");

    let other = tempfile::tempdir().unwrap();
    session_db(other.path(), "CREATE TABLE notes (body TEXT);");
    let sections = sections_of(other.path());
    assert!(!sections.has_todos, "no todos table");

    let corrupt = tempfile::tempdir().unwrap();
    std::fs::write(corrupt.path().join("session.db"), "not a database").unwrap();
    assert!(
        !sections_of(corrupt.path()).has_todos,
        "unreadable database"
    );

    let with_rows = tempfile::tempdir().unwrap();
    session_db(
        with_rows.path(),
        &format!(
            "{TODOS_TABLE} INSERT INTO todos VALUES ('a', 'Ship it', NULL, 'pending', NULL, NULL);"
        ),
    );
    assert!(sections_of(with_rows.path()).has_todos);
}

/// Copilot writes `checkpoints/index.md` with only its table header before
/// the first checkpoint exists.
const HEADER_ONLY_CHECKPOINTS: &str = "# Checkpoint History\n\n\
    Checkpoints are listed in chronological order.\n\n\
    | # | Title | File |\n|---|-------|------|\n";

#[test]
fn checkpoints_are_offered_only_when_the_index_lists_one() {
    let none = tempfile::tempdir().unwrap();
    assert!(!sections_of(none.path()).has_checkpoints, "no folder");

    let empty_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(empty_dir.path().join("checkpoints")).unwrap();
    assert!(
        !sections_of(empty_dir.path()).has_checkpoints,
        "empty checkpoints folder"
    );

    let header_only = tempfile::tempdir().unwrap();
    let cp = header_only.path().join("checkpoints");
    std::fs::create_dir(&cp).unwrap();
    std::fs::write(cp.join("index.md"), HEADER_ONLY_CHECKPOINTS).unwrap();
    assert!(
        !sections_of(header_only.path()).has_checkpoints,
        "header-only index.md"
    );

    let listed = tempfile::tempdir().unwrap();
    let cp = listed.path().join("checkpoints");
    std::fs::create_dir(&cp).unwrap();
    std::fs::write(
        cp.join("index.md"),
        format!("{HEADER_ONLY_CHECKPOINTS}| 1 | Initial setup | 001-initial-setup.md |\n"),
    )
    .unwrap();
    std::fs::write(cp.join("001-initial-setup.md"), "Set up the project.").unwrap();
    assert!(sections_of(listed.path()).has_checkpoints);
}

#[test]
fn rewind_snapshots_are_offered_only_when_the_index_has_one() {
    let none = tempfile::tempdir().unwrap();
    assert!(!sections_of(none.path()).has_rewind_snapshots, "no folder");

    let empty_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(empty_dir.path().join("rewind-snapshots")).unwrap();
    assert!(
        !sections_of(empty_dir.path()).has_rewind_snapshots,
        "empty rewind-snapshots folder"
    );

    let no_snapshots = tempfile::tempdir().unwrap();
    let rw = no_snapshots.path().join("rewind-snapshots");
    std::fs::create_dir(&rw).unwrap();
    std::fs::write(rw.join("index.json"), r#"{"version":1,"snapshots":[]}"#).unwrap();
    assert!(
        !sections_of(no_snapshots.path()).has_rewind_snapshots,
        "index with no snapshots"
    );

    let corrupt = tempfile::tempdir().unwrap();
    let rw = corrupt.path().join("rewind-snapshots");
    std::fs::create_dir(&rw).unwrap();
    std::fs::write(rw.join("index.json"), "{not json").unwrap();
    assert!(
        !sections_of(corrupt.path()).has_rewind_snapshots,
        "unreadable index"
    );

    let listed = tempfile::tempdir().unwrap();
    let rw = listed.path().join("rewind-snapshots");
    std::fs::create_dir(&rw).unwrap();
    std::fs::write(
        rw.join("index.json"),
        r#"{"version":1,"snapshots":[{"snapshotId":"snap-1","fileCount":2}]}"#,
    )
    .unwrap();
    assert!(sections_of(listed.path()).has_rewind_snapshots);
}

#[test]
fn custom_tables_are_offered_only_when_one_has_rows() {
    let none = tempfile::tempdir().unwrap();
    assert!(!sections_of(none.path()).has_custom_tables, "no session.db");

    let standard_only = tempfile::tempdir().unwrap();
    session_db(
        standard_only.path(),
        &format!(
            "{TODOS_TABLE} INSERT INTO todos VALUES ('a', 'Ship it', NULL, 'pending', NULL, NULL);"
        ),
    );
    assert!(
        !sections_of(standard_only.path()).has_custom_tables,
        "only the standard todos table"
    );

    let empty = tempfile::tempdir().unwrap();
    session_db(
        empty.path(),
        "CREATE TABLE notes (body TEXT); CREATE TABLE tags (name TEXT);",
    );
    assert!(
        !sections_of(empty.path()).has_custom_tables,
        "custom tables without rows"
    );

    let with_rows = tempfile::tempdir().unwrap();
    session_db(
        with_rows.path(),
        "CREATE TABLE notes (body TEXT); CREATE TABLE tags (name TEXT); \
         INSERT INTO tags VALUES ('release');",
    );
    assert!(sections_of(with_rows.path()).has_custom_tables);
}
