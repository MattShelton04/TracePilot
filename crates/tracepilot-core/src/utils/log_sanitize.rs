//! Log sanitization helpers.
//!
//! Utilities for scrubbing strings before they hit tracing/log sinks so that
//! attacker-controlled error messages cannot inject control characters or
//! spam log output.

/// Sanitize a value's `Display` representation for safe logging.
///
/// Removes control characters (except spaces/tabs) to prevent log-injection
/// attacks and truncates to 500 characters to prevent log spam.
pub fn sanitize_error_msg(err: &impl std::fmt::Display) -> String {
    sanitize(&err.to_string())
}

/// Sanitize an arbitrary string for safe logging.
///
/// Removes control characters (except spaces/tabs) and truncates to 500
/// characters.
pub fn sanitize(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == ' ' || *c == '\t')
        .take(500)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_control_chars_keeps_space_and_tab() {
        let input = "hello\n\r\tworld\u{0007}!";
        assert_eq!(sanitize(input), "hello\tworld!");
    }

    #[test]
    fn truncates_to_500_chars() {
        let input = "a".repeat(1000);
        assert_eq!(sanitize(&input).chars().count(), 500);
    }

    #[test]
    fn sanitize_error_msg_uses_display() {
        #[derive(Debug)]
        struct E;
        impl std::fmt::Display for E {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "boom\n\u{0000}x")
            }
        }
        assert_eq!(sanitize_error_msg(&E), "boomx");
    }
}
