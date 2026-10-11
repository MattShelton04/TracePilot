use super::*;

const ID: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

fn star() -> SessionAnnotationPatch {
    SessionAnnotationPatch {
        starred: Some(true),
        ..Default::default()
    }
}

#[test]
fn unannotated_session_reads_as_empty() {
    let store = AnnotationStore::open_in_memory().unwrap();
    assert_eq!(store.get(ID).unwrap(), SessionAnnotation::empty(ID));
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn patch_updates_only_the_fields_it_sets() {
    let mut store = AnnotationStore::open_in_memory().unwrap();
    store.update(ID, &star()).unwrap();
    let patch = SessionAnnotationPatch {
        tags: Some(vec!["bug".into(), "Review".into()]),
        note: Some("Look at turn 4".into()),
        ..Default::default()
    };
    let updated = store.update(ID, &patch.normalized().unwrap()).unwrap();

    assert!(updated.starred);
    assert!(!updated.archived);
    assert_eq!(updated.tags, vec!["bug", "Review"]);
    assert_eq!(updated.note.as_deref(), Some("Look at turn 4"));
    assert!(updated.updated_at.is_some());
    assert_eq!(store.get(ID).unwrap(), updated);
}

#[test]
fn clearing_everything_removes_the_row() {
    let mut store = AnnotationStore::open_in_memory().unwrap();
    let patch = SessionAnnotationPatch {
        archived: Some(true),
        tags: Some(vec!["x".into()]),
        ..Default::default()
    };
    store.update(ID, &patch).unwrap();
    store.update(OTHER, &star()).unwrap();

    let clear = SessionAnnotationPatch {
        archived: Some(false),
        tags: Some(Vec::new()),
        ..Default::default()
    };
    let cleared = store.update(ID, &clear).unwrap();

    assert!(cleared.is_empty());
    assert_eq!(cleared.updated_at, None);
    let remaining = store.list().unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].session_id, OTHER);
}

#[test]
fn an_empty_note_clears_the_note() {
    let mut store = AnnotationStore::open_in_memory().unwrap();
    let set = SessionAnnotationPatch {
        note: Some("keep".into()),
        starred: Some(true),
        ..Default::default()
    };
    store.update(ID, &set.normalized().unwrap()).unwrap();
    let clear = SessionAnnotationPatch {
        note: Some("   ".into()),
        ..Default::default()
    };
    let updated = store.update(ID, &clear.normalized().unwrap()).unwrap();
    assert_eq!(updated.note, None);
    assert!(updated.starred);
}

#[test]
fn tags_are_trimmed_deduplicated_and_sorted() {
    let tags = normalize_tags(&[
        "  needs   review ".into(),
        "Bug".into(),
        "bug".into(),
        "".into(),
        "alpha".into(),
    ])
    .unwrap();
    assert_eq!(tags, vec!["alpha", "Bug", "needs review"]);
}

#[test]
fn oversized_input_is_rejected() {
    let long_tag = "x".repeat(MAX_TAG_CHARS + 1);
    assert!(matches!(
        normalize_tags(&[long_tag]),
        Err(AnnotationValidationError::TagTooLong(_))
    ));
    let many: Vec<String> = (0..=MAX_TAGS_PER_SESSION)
        .map(|i| format!("t{i}"))
        .collect();
    assert_eq!(
        normalize_tags(&many),
        Err(AnnotationValidationError::TooManyTags)
    );
    assert_eq!(
        normalize_note(&"n".repeat(MAX_NOTE_CHARS + 1)),
        Err(AnnotationValidationError::NoteTooLong)
    );
}

#[test]
fn store_on_disk_survives_reopening_and_lists_read_only() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tracepilot").join("annotations.db");

    assert!(list_annotations_if_exists(&path).unwrap().is_empty());
    assert!(!path.exists(), "listing must not create the store");

    {
        let mut store = AnnotationStore::open_or_create(&path).unwrap();
        store.update(ID, &star()).unwrap();
    }
    // Reopening runs no migration and keeps the data.
    let store = AnnotationStore::open_or_create(&path).unwrap();
    assert!(store.get(ID).unwrap().starred);

    let listed = list_annotations_if_exists(&path).unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].starred);
    // A brand-new store had nothing to back up.
    let backups: Vec<_> = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".bak"))
        .collect();
    assert!(backups.is_empty());
}

#[test]
fn unchanged_patch_keeps_the_timestamp() {
    let mut store = AnnotationStore::open_in_memory().unwrap();
    let first = store.update(ID, &star()).unwrap();
    let again = store.update(ID, &star()).unwrap();
    assert_eq!(first.updated_at, again.updated_at);
}
