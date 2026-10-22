use crate::options::RedactionOptions;

use super::patterns::{PATH_PATTERNS, PII_PATTERNS, RedactionPattern, SECRET_PATTERNS};

/// Collect all active pattern lists based on the user's redaction options.
///
/// Secrets go first: a path's last name may take capitalized words after it
/// (`C:\Users\John Smith`), which could swallow a `Password:` label and leave
/// its value for no pattern to find.
pub(crate) fn collect_active_patterns(
    options: &RedactionOptions,
) -> Vec<&'static RedactionPattern> {
    let mut patterns = Vec::new();
    if options.strip_secrets {
        patterns.extend(SECRET_PATTERNS.iter());
    }
    if options.anonymize_paths {
        patterns.extend(PATH_PATTERNS.iter());
    }
    if options.strip_pii {
        patterns.extend(PII_PATTERNS.iter());
    }
    patterns
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::redaction::RedactionStats;
    use crate::redaction::primitives::redact_string;

    #[test]
    fn a_secret_label_after_a_path_is_still_redacted() {
        let options = RedactionOptions {
            anonymize_paths: true,
            strip_secrets: true,
            strip_pii: true,
        };
        let mut text = r"Wrote C:\deploy\config.json Password: SuperSecret123".to_string();
        redact_string(
            &mut text,
            &collect_active_patterns(&options),
            &mut RedactionStats::default(),
        );
        assert_eq!(text, "Wrote <REDACTED_PATH> <REDACTED_SECRET>");
    }
}
