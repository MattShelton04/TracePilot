//! Shared utility functions used across TracePilot crates.

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
}
