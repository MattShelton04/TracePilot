use super::validate_session_dir;

#[tokio::test]
async fn a_missing_session_dir_is_reported_as_missing() {
    let temp = tempfile::tempdir().unwrap();
    let path = |name: &str| temp.path().join(name).display().to_string();

    let missing = validate_session_dir(path("session-state")).await.unwrap();
    assert!(!missing.valid);
    assert!(missing.missing);

    std::fs::write(temp.path().join("file"), "").unwrap();
    let file = validate_session_dir(path("file")).await.unwrap();
    assert!(!file.valid);
    assert!(!file.missing);

    let empty = validate_session_dir(temp.path().display().to_string())
        .await
        .unwrap();
    assert!(empty.valid);
    assert!(!empty.missing);
    assert_eq!(empty.session_count, 0);
}
