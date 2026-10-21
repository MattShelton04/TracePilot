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
