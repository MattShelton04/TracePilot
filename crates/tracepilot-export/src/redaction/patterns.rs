//! Regex patterns for detecting and redacting sensitive content.
//!
//! Each pattern has a name (for reporting), a compiled regex, and a
//! replacement string. Patterns are organized into categories that map
//! to user-facing toggles: paths, secrets, and PII.

use once_cell::sync::Lazy;
use regex::Regex;

/// A single redaction pattern with its replacement strategy.
#[derive(Debug)]
pub struct RedactionPattern {
    pub name: &'static str,
    pub regex: &'static Lazy<Regex>,
    pub replacement: &'static str,
}

// ── Path Patterns ───────────────────────────────────────────────────────────

static WINDOWS_PATH: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"[A-Za-z]:\\(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]*"#).unwrap());

static UNIX_HOME_PATH: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?:/home/|/Users/)[^\s:,;)}\]"']+"#).unwrap());

static UNIX_ABS_PATH: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"/(?:usr|var|etc|opt|tmp|srv|mnt)/[^\s:,;)}\]"']+"#).unwrap());

/// Patterns that match filesystem paths.
pub static PATH_PATTERNS: &[RedactionPattern] = &[
    RedactionPattern {
        name: "windows_path",
        regex: &WINDOWS_PATH,
        replacement: "<REDACTED_PATH>",
    },
    RedactionPattern {
        name: "unix_home_path",
        regex: &UNIX_HOME_PATH,
        replacement: "<REDACTED_PATH>",
    },
    RedactionPattern {
        name: "unix_abs_path",
        regex: &UNIX_ABS_PATH,
        replacement: "<REDACTED_PATH>",
    },
];

// ── Secret Patterns ─────────────────────────────────────────────────────────

static GENERIC_API_KEY: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9+/=_\-]{16,})["']?"#).unwrap()
});

static BEARER_TOKEN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)Bearer\s+[A-Za-z0-9._\-]{20,}").unwrap());

static GITHUB_TOKEN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}").unwrap());

static AWS_KEY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:AKIA|ASIA)[A-Z0-9]{16}").unwrap());

static GENERIC_SECRET_ASSIGN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)(?:password|passwd|secret|token|credential|private[_-]?key)\s*[:=]\s*["']?([^\s"']{8,})["']?"#).unwrap()
});

static ENV_VAR_ASSIGN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:export\s+|set\s+)?(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|AUTH)[A-Z_]*\s*=\s*\S+").unwrap()
});

/// Patterns that match secrets, tokens, API keys, and credentials.
pub static SECRET_PATTERNS: &[RedactionPattern] = &[
    RedactionPattern {
        name: "github_token",
        regex: &GITHUB_TOKEN,
        replacement: "<REDACTED_TOKEN>",
    },
    RedactionPattern {
        name: "aws_key",
        regex: &AWS_KEY,
        replacement: "<REDACTED_KEY>",
    },
    RedactionPattern {
        name: "bearer_token",
        regex: &BEARER_TOKEN,
        replacement: "<REDACTED_TOKEN>",
    },
    RedactionPattern {
        name: "generic_api_key",
        regex: &GENERIC_API_KEY,
        replacement: "<REDACTED_KEY>",
    },
    RedactionPattern {
        name: "generic_secret",
        regex: &GENERIC_SECRET_ASSIGN,
        replacement: "<REDACTED_SECRET>",
    },
    RedactionPattern {
        name: "env_var_secret",
        regex: &ENV_VAR_ASSIGN,
        replacement: "<REDACTED_ENV>",
    },
];

// ── PII Patterns ────────────────────────────────────────────────────────────

static EMAIL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}").unwrap());

static IPV4: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b")
        .unwrap()
});

/// Patterns that match personally identifiable information.
pub static PII_PATTERNS: &[RedactionPattern] = &[
    RedactionPattern {
        name: "email",
        regex: &EMAIL,
        replacement: "<REDACTED_EMAIL>",
    },
    RedactionPattern {
        name: "ipv4",
        regex: &IPV4,
        replacement: "<REDACTED_IP>",
    },
];

/// Apply a set of redaction patterns to a string, returning the redacted version.
/// Returns `None` if no patterns matched (string is unchanged).
pub fn apply_patterns(text: &str, patterns: &[RedactionPattern]) -> Option<String> {
    let mut result = text.to_string();
    let mut changed = false;

    for pattern in patterns {
        let after = pattern.regex.replace_all(&result, pattern.replacement);
        if after != result {
            changed = true;
            result = after.into_owned();
        }
    }

    if changed {
        Some(result)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_windows_paths() {
        let input = r"Reading C:\Users\matt\project\src\main.rs";
        let result = apply_patterns(input, PATH_PATTERNS).unwrap();
        assert!(result.contains("<REDACTED_PATH>"));
        assert!(!result.contains("matt"));
    }

    #[test]
    fn detects_unix_home_paths() {
        let input = "File at /home/alice/code/app.py was modified";
        let result = apply_patterns(input, PATH_PATTERNS).unwrap();
        assert!(result.contains("<REDACTED_PATH>"));
        assert!(!result.contains("alice"));
    }

    #[test]
    fn detects_github_tokens() {
        let input = "Using token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
        let result = apply_patterns(input, SECRET_PATTERNS).unwrap();
        assert!(result.contains("<REDACTED_TOKEN>"));
        assert!(!result.contains("ghp_"));
    }

    #[test]
    fn detects_aws_keys() {
        let input = "key = AKIAIOSFODNN7EXAMPLE";
        let result = apply_patterns(input, SECRET_PATTERNS).unwrap();
        assert!(result.contains("<REDACTED_KEY>"));
    }

    #[test]
    fn detects_bearer_tokens() {
        let input = "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.long.token";
        let result = apply_patterns(input, SECRET_PATTERNS).unwrap();
        assert!(result.contains("<REDACTED_TOKEN>"));
    }

    #[test]
    fn detects_email_addresses() {
        let input = "Contact: user@example.com for details";
        let result = apply_patterns(input, PII_PATTERNS).unwrap();
        assert!(result.contains("<REDACTED_EMAIL>"));
        assert!(!result.contains("user@"));
    }

    #[test]
    fn detects_ipv4_addresses() {
        let input = "Server at 192.168.1.100 port 8080";
        let result = apply_patterns(input, PII_PATTERNS).unwrap();
        assert!(result.contains("<REDACTED_IP>"));
        assert!(!result.contains("192.168"));
    }

    #[test]
    fn returns_none_when_no_match() {
        let input = "Hello, world!";
        assert!(apply_patterns(input, SECRET_PATTERNS).is_none());
    }

    #[test]
    fn detects_env_var_secrets() {
        let input = "export API_KEY_PROD=sk-abc123xyz789";
        let result = apply_patterns(input, SECRET_PATTERNS).unwrap();
        assert!(result.contains("<REDACTED_ENV>"));
    }

    #[test]
    fn detects_generic_password_assignment() {
        let input = r#"password = "my_super_secret_password""#;
        let result = apply_patterns(input, SECRET_PATTERNS).unwrap();
        assert!(result.contains("<REDACTED_SECRET>"));
    }
}
