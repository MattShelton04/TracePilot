//! Shared utility functions used across TracePilot crates.

pub mod cache;
pub mod sqlite;

use std::path::PathBuf;

/// Truncate a string to a maximum byte length, respecting UTF-8 char boundaries.
/// Returns a string slice up to (but not exceeding) `max_bytes`.
pub fn truncate_utf8(input: &str, max_bytes: usize) -> &str {
    if input.len() <= max_bytes {
        return input;
    }
    let mut end = max_bytes;
    while !input.is_char_boundary(end) {
        end -= 1;
    }
    &input[..end]
}

/// Truncate a mutable string in place to a maximum number of bytes, ensuring valid UTF-8.
pub fn truncate_string_utf8(s: &mut String, max_bytes: usize) {
    let truncated_len = truncate_utf8(s.as_str(), max_bytes).len();
    s.truncate(truncated_len);
}

/// Resolve the user's home directory with a platform-specific fallback.
/// Returns `C:\Users\default` on Windows or `/tmp` on Unix if env vars are missing.
/// Use [`home_dir_opt`] when a missing home dir is a meaningful signal.
pub fn home_dir() -> PathBuf {
    home_dir_opt().unwrap_or_else(|| {
        if cfg!(windows) {
            PathBuf::from(r"C:\Users\default")
        } else {
            PathBuf::from("/tmp")
        }
    })
}

/// Resolve the user's home directory, returning `None` if not found.
/// Prefer this when the caller needs to distinguish "no home dir" from a default.
pub fn home_dir_opt() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").map(PathBuf::from).ok()
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").map(PathBuf::from).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_ascii_within_limit() {
        assert_eq!(truncate_utf8("hello", 10), "hello");
    }

    #[test]
    fn truncate_ascii_at_limit() {
        assert_eq!(truncate_utf8("hello", 5), "hello");
    }

    #[test]
    fn truncate_ascii_over_limit() {
        assert_eq!(truncate_utf8("hello world", 5), "hello");
    }

    #[test]
    fn truncate_multibyte_boundary() {
        // "é" is 2 bytes in UTF-8
        let s = "café";
        // "caf" = 3 bytes, "é" = 2 bytes, total = 5
        assert_eq!(truncate_utf8(s, 4), "caf");
        assert_eq!(truncate_utf8(s, 5), "café");
    }

    #[test]
    fn truncate_empty_string() {
        assert_eq!(truncate_utf8("", 10), "");
    }

    #[test]
    fn truncate_zero_max() {
        assert_eq!(truncate_utf8("hello", 0), "");
    }

    #[test]
    fn home_dir_returns_path() {
        let path = home_dir();
        assert!(!path.as_os_str().is_empty());
    }

    #[test]
    fn truncate_multibyte_emoji() {
        // "🦀" is 4 bytes in UTF-8
        let s = "🦀crab";
        // Max bytes < 4 should return empty string since we can't include the crab
        assert_eq!(truncate_utf8(s, 2), "");
        assert_eq!(truncate_utf8(s, 3), "");
        // Max bytes >= 4 includes the crab
        assert_eq!(truncate_utf8(s, 4), "🦀");
        assert_eq!(truncate_utf8(s, 5), "🦀c");
        assert_eq!(truncate_utf8(s, 8), "🦀crab");
    }

    #[test]
    fn truncate_multibyte_cut_middle() {
        // "💖" is 4 bytes
        let s = "hello 💖 world";
        // "hello " is 6 bytes. 6 + 4 = 10 bytes for "hello 💖"
        assert_eq!(truncate_utf8(s, 6), "hello ");
        assert_eq!(truncate_utf8(s, 7), "hello ");
        assert_eq!(truncate_utf8(s, 8), "hello ");
        assert_eq!(truncate_utf8(s, 9), "hello ");
        assert_eq!(truncate_utf8(s, 10), "hello 💖");
    }

    #[test]
    fn truncate_string_utf8_in_place() {
        let mut s = String::from("café");
        truncate_string_utf8(&mut s, 4);
        assert_eq!(s, "caf");

        let mut s2 = String::from("🦀crab");
        truncate_string_utf8(&mut s2, 3);
        assert_eq!(s2, "");

        let mut s3 = String::from("hello");
        truncate_string_utf8(&mut s3, 10);
        assert_eq!(s3, "hello");
    }
}
