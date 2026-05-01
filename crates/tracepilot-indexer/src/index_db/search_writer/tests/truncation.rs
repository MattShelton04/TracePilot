use tracepilot_core::utils::truncate_utf8;

#[test]
fn test_truncate_utf8_short() {
    assert_eq!(truncate_utf8("hello", 10), "hello");
}

#[test]
fn test_truncate_utf8_exact() {
    assert_eq!(truncate_utf8("hello", 5), "hello");
}

#[test]
fn test_truncate_utf8_cuts() {
    assert_eq!(truncate_utf8("hello world", 5), "hello");
}

#[test]
fn test_truncate_utf8_unicode() {
    // Multi-byte chars should not be split mid-character
    let text = "héllo wörld";
    let result = truncate_utf8(text, 6);
    assert!(result.len() <= 6);
    assert!(result.is_char_boundary(result.len()));
}
