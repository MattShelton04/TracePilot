use crate::options::RedactionOptions;

use super::patterns::{PATH_PATTERNS, PII_PATTERNS, RedactionPattern, SECRET_PATTERNS};

/// Collect all active pattern lists based on the user's redaction options.
pub(crate) fn collect_active_patterns(
    options: &RedactionOptions,
) -> Vec<&'static RedactionPattern> {
    let mut patterns = Vec::new();
    if options.anonymize_paths {
        patterns.extend(PATH_PATTERNS.iter());
    }
    if options.strip_secrets {
        patterns.extend(SECRET_PATTERNS.iter());
    }
    if options.strip_pii {
        patterns.extend(PII_PATTERNS.iter());
    }
    patterns
}
