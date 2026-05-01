use super::*;

#[test]
fn already_indexing_serializes_with_stable_code() {
    let err = BindingsError::AlreadyIndexing;
    let json = serde_json::to_string(&err).unwrap();
    assert!(json.contains(r#""code":"ALREADY_INDEXING""#), "got: {json}");
    assert!(json.contains(r#""message":"#), "got: {json}");
}

#[test]
fn validation_emits_message_verbatim() {
    let err = BindingsError::Validation("bad input".into());
    let json = serde_json::to_string(&err).unwrap();
    assert!(json.contains(r#""code":"VALIDATION""#));
    assert!(json.contains(r#""message":"bad input""#));
}

#[test]
fn scrub_redacts_windows_username() {
    let s = scrub_message(r"open failed: C:\Users\alice\.tracepilot\db.sqlite");
    assert!(!s.contains("alice"), "should have redacted username: {s}");
    assert!(s.contains("<user>"), "got: {s}");
    // Rest of path preserved.
    assert!(s.contains("db.sqlite"), "got: {s}");
}

#[test]
fn scrub_redacts_posix_home_and_mac_users() {
    let s = scrub_message("config not found at /home/bob/.config/tracepilot.toml");
    assert!(!s.contains("bob"), "got: {s}");
    assert!(s.contains("<user>"), "got: {s}");

    let s = scrub_message("config not found at /Users/carol/Library/App/x");
    assert!(!s.contains("carol"), "got: {s}");
    assert!(s.contains("<user>"), "got: {s}");
}

#[test]
fn scrub_redacts_bearer_token() {
    let s = scrub_message("auth error: Authorization: Bearer sk-abcdef12345 failed");
    assert!(!s.contains("sk-abcdef12345"), "got: {s}");
    assert!(s.contains("Bearer <redacted>"), "got: {s}");
}

#[test]
fn scrub_redacts_github_pat() {
    let token = format!("ghp_{}", "X".repeat(36));
    let raw = format!("gh api failed with token={token}");
    let s = scrub_message(&raw);
    assert!(!s.contains(&token), "got: {s}");
    assert!(s.contains("<redacted-gh-token>"), "got: {s}");
}

#[test]
fn scrub_preserves_messages_without_sensitive_data() {
    let s = scrub_message("Indexing is already in progress.");
    assert_eq!(s, "Indexing is already in progress.");
}

#[test]
fn io_error_with_path_is_scrubbed_on_serialize() {
    // io::Error's Display doesn't normally include paths, but our own
    // error variants often do (via Display). Simulate via Validation
    // since it interpolates whatever the caller passes.
    let err = BindingsError::Validation(r"Failed to open C:\Users\dave\secret.txt".into());
    let json = serde_json::to_string(&err).unwrap();
    assert!(!json.contains("dave"), "got: {json}");
    assert!(json.contains("<user>"), "got: {json}");
}

#[test]
fn all_error_codes_are_stable_ascii() {
    for c in [
        ErrorCode::Io,
        ErrorCode::Tauri,
        ErrorCode::Network,
        ErrorCode::Join,
        ErrorCode::Parse,
        ErrorCode::Serialization,
        ErrorCode::Internal,
        ErrorCode::Core,
        ErrorCode::Orchestrator,
        ErrorCode::Bridge,
        ErrorCode::Indexer,
        ErrorCode::Export,
        ErrorCode::AlreadyIndexing,
        ErrorCode::Validation,
    ] {
        let s = c.as_str();
        assert!(!s.is_empty());
        assert!(s.chars().all(|ch| ch.is_ascii_uppercase() || ch == '_'));
    }
}

/// Every concrete `BindingsError` variant must map to a stable `code`
/// string. This test pins the contract end-to-end so a future
/// refactor of either `ErrorCode` or the `code()` match can't silently
/// shift what the frontend sees.
#[test]
fn every_variant_maps_to_stable_code() {
    // Infrastructure / plumbing ------------------------------
    assert_eq!(
        BindingsError::Io(std::io::Error::other("x"))
            .code()
            .as_str(),
        "IO"
    );
    assert_eq!(
        BindingsError::Semver(semver::Version::parse("not-a-version").unwrap_err())
            .code()
            .as_str(),
        "PARSE"
    );
    assert_eq!(
        BindingsError::Uuid(uuid::Uuid::parse_str("bad-uuid").unwrap_err())
            .code()
            .as_str(),
        "PARSE"
    );

    // Business / user-visible --------------------------------
    assert_eq!(
        BindingsError::AlreadyIndexing.code().as_str(),
        "ALREADY_INDEXING"
    );
    assert_eq!(
        BindingsError::Validation("x".into()).code().as_str(),
        "VALIDATION"
    );
    assert_eq!(
        BindingsError::Internal("mutex poisoned".into())
            .code()
            .as_str(),
        "INTERNAL"
    );

    // NOTE: the *_ctx transparent variants (Core, Orchestrator, Bridge,
    // Indexer, Export, Tauri, Reqwest, Join, TomlSerialize/Deserialize)
    // are covered by compile-time exhaustiveness — `code()` is a
    // complete `match` on `BindingsError`, so adding a new variant
    // without updating the match is a build error. Constructing those
    // errors directly here would require cross-crate test helpers.
}

#[test]
fn scrub_redacts_multiple_bearer_tokens() {
    // Both occurrences must be redacted.
    // Also verifies no infinite loop: "Bearer <redacted>" contains "Bearer "
    // which would cause an infinite loop if cursor is not advanced past each replacement.
    let s = scrub_message(
        "retry1: Authorization: Bearer tok-AAAA failed, retry2: Authorization: Bearer tok-BBBB failed",
    );
    assert!(!s.contains("tok-AAAA"), "first token leaked: {s}");
    assert!(!s.contains("tok-BBBB"), "second token leaked: {s}");
    let count = s.matches("Bearer <redacted>").count();
    assert_eq!(count, 2, "expected 2 redactions, got {count}: {s}");
}

#[test]
fn scrub_redacts_pat_after_short_match() {
    // A short non-token match (< 20 chars) must NOT cause subsequent real
    // PATs to be skipped. The old `while let` + `break` pattern would exit
    // the loop after the first short match, leaking tokens that follow it.
    let real_token = "ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH"; // 36 chars — real PAT
    let msg = format!("debug: ghp_tmp short, real: {real_token}");
    let s = scrub_message(&msg);
    assert!(
        !s.contains(real_token),
        "real PAT leaked after short match: {s}"
    );
    assert!(s.contains("<redacted-gh-token>"), "no redaction found: {s}");
}
