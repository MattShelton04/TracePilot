//! Input validation utilities for preventing path traversal and injection attacks.
//!
//! This module provides centralized validation logic for user-provided strings
//! that are used in filesystem operations, shell commands, or as identifiers.
//! Consolidates validation patterns previously duplicated across multiple modules.

use std::path::Path;

/// Validation rules for identifier-like strings (names, IDs, etc.).
///
/// Controls which characters are allowed and structural requirements.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ValidationRules {
    /// Allow hyphen (-) character
    pub allow_hyphen: bool,
    /// Allow underscore (_) character
    pub allow_underscore: bool,
    /// Require first character to be alphabetic or underscore
    pub require_alpha_start: bool,
    /// Skip the character whitelist (only check path-safety)
    pub skip_char_whitelist: bool,
}

/// Rules for environment variable names (POSIX-style).
/// Must start with letter/underscore, then alphanumeric/underscore only.
pub const ENV_VAR_RULES: ValidationRules = ValidationRules {
    allow_hyphen: false,
    allow_underscore: true,
    require_alpha_start: true,
    skip_char_whitelist: false,
};

/// Rules for template IDs.
/// Alphanumeric, hyphens, and underscores allowed.
pub const TEMPLATE_ID_RULES: ValidationRules = ValidationRules {
    allow_hyphen: true,
    allow_underscore: true,
    require_alpha_start: false,
    skip_char_whitelist: false,
};

/// Rules for skill names.
/// Only path-safety checks (no character whitelist). Matches original behavior:
/// non-empty, no `..`, no path separators, not an absolute path.
pub const SKILL_NAME_RULES: ValidationRules = ValidationRules {
    allow_hyphen: true,
    allow_underscore: true,
    require_alpha_start: false,
    skip_char_whitelist: true,
};

/// Validate a string identifier against security and character rules.
///
/// # Arguments
///
/// * `value` - The string to validate
/// * `rules` - Validation rules specifying allowed characters and structure
/// * `context` - Human-readable context for error messages (e.g., "Template ID", "Skill name")
///
/// # Returns
///
/// * `Ok(())` if validation passes
/// * `Err(String)` with a descriptive error message if validation fails
///
/// # Security
///
/// Always checks for path traversal attempts and absolute paths, regardless of rules:
/// - Rejects strings containing `..`
/// - Rejects strings starting with `/` or `\`
/// - Rejects absolute paths (as determined by `Path::is_absolute()`)
pub fn validate_identifier(
    value: &str,
    rules: ValidationRules,
    context: &str,
) -> Result<(), String> {
    // Check for empty string
    if value.is_empty() {
        return Err(format!("{context} cannot be empty"));
    }

    // Check for NULL bytes (security: can truncate paths in C APIs)
    if value.contains('\0') {
        return Err(format!("{context} cannot contain NULL bytes"));
    }

    // Check for path traversal attempts
    if value.contains("..") {
        return Err(format!("{context} cannot contain '..' (path traversal)"));
    }

    // Check for path separators (both Windows and Unix)
    if value.contains('/') || value.contains('\\') {
        return Err(format!("{context} cannot contain path separators (/ or \\)"));
    }

    // Check for absolute paths
    if Path::new(value).is_absolute() {
        return Err(format!("{context} cannot be an absolute path"));
    }

    // Character whitelist (skipped for permissive rules like skill names)
    if !rules.skip_char_whitelist {
        // Validate first character if required
        if rules.require_alpha_start {
            let first = value.bytes().next().unwrap(); // Safe because we checked is_empty
            if !first.is_ascii_alphabetic() && first != b'_' {
                return Err(format!(
                    "{context} must start with a letter or underscore, got: {value}"
                ));
            }
        }

        // Validate all characters
        let valid = value.bytes().all(|b| {
            b.is_ascii_alphanumeric()
                || (b == b'_' && rules.allow_underscore)
                || (b == b'-' && rules.allow_hyphen)
        });

        if !valid {
            let allowed_chars = format!(
                "alphanumeric{}{}",
                if rules.allow_hyphen { ", hyphen" } else { "" },
                if rules.allow_underscore {
                    ", underscore"
                } else {
                    ""
                }
            );
            return Err(format!(
                "{context} contains invalid characters (only {allowed_chars} allowed): {value}"
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Empty String Tests ────────────────────────────────────────────

    #[test]
    fn test_empty_string_rejected() {
        let result = validate_identifier("", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be empty"));
    }

    // ─── Path Traversal Tests ──────────────────────────────────────────

    #[test]
    fn test_path_traversal_double_dot() {
        let result = validate_identifier("../secrets", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path traversal"));
    }

    #[test]
    fn test_path_traversal_in_middle() {
        let result = validate_identifier("foo/../bar", SKILL_NAME_RULES, "Skill name");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path traversal"));
    }

    #[test]
    fn test_path_separator_forward_slash() {
        let result = validate_identifier("foo/bar", SKILL_NAME_RULES, "Skill name");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path separators"));
    }

    #[test]
    fn test_path_separator_backslash() {
        let result = validate_identifier("foo\\bar", SKILL_NAME_RULES, "Skill name");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path separators"));
    }

    #[test]
    fn test_absolute_path_unix() {
        let result = validate_identifier("/etc/passwd", SKILL_NAME_RULES, "Skill name");
        // Caught by forward slash check first
        assert!(result.is_err());
    }

    #[test]
    fn test_absolute_path_windows() {
        let result = validate_identifier("C:\\Windows", SKILL_NAME_RULES, "Skill name");
        // Caught by backslash check first
        assert!(result.is_err());
    }

    #[test]
    fn test_null_byte_rejected() {
        let result = validate_identifier("test\0name", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("NULL bytes"));
    }

    // ─── Character Validation Tests ────────────────────────────────────

    #[test]
    fn test_alphanumeric_only() {
        let result = validate_identifier("abc123", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_ok());
    }

    #[test]
    fn test_hyphen_allowed() {
        let result = validate_identifier("my-template", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_ok());
    }

    #[test]
    fn test_underscore_allowed() {
        let result = validate_identifier("my_template", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_ok());
    }

    #[test]
    fn test_hyphen_and_underscore() {
        let result = validate_identifier("my-template_v2", SKILL_NAME_RULES, "Skill name");
        assert!(result.is_ok());
    }

    #[test]
    fn test_hyphen_rejected_when_not_allowed() {
        let result = validate_identifier("my-var", ENV_VAR_RULES, "Environment variable");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid characters"));
    }

    #[test]
    fn test_special_chars_rejected() {
        let result = validate_identifier("my@template", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid characters"));
    }

    #[test]
    fn test_space_rejected_in_strict_rules() {
        let result = validate_identifier("my template", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid characters"));
    }

    #[test]
    fn test_unicode_rejected() {
        let result = validate_identifier("my-témpläte", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid characters"));
    }

    // ─── Alpha Start Requirement Tests ─────────────────────────────────

    #[test]
    fn test_alpha_start_with_letter() {
        let result = validate_identifier("MY_VAR", ENV_VAR_RULES, "Environment variable");
        assert!(result.is_ok());
    }

    #[test]
    fn test_alpha_start_with_underscore() {
        let result = validate_identifier("_MY_VAR", ENV_VAR_RULES, "Environment variable");
        assert!(result.is_ok());
    }

    #[test]
    fn test_alpha_start_with_digit_rejected() {
        let result = validate_identifier("1MY_VAR", ENV_VAR_RULES, "Environment variable");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must start with"));
    }

    #[test]
    fn test_no_alpha_start_requirement_allows_digit() {
        let result = validate_identifier("123template", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_ok());
    }

    // ─── Edge Cases ────────────────────────────────────────────────────

    #[test]
    fn test_single_character() {
        let result = validate_identifier("a", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_ok());
    }

    #[test]
    fn test_single_digit() {
        let result = validate_identifier("7", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_ok());
    }

    #[test]
    fn test_single_underscore() {
        let result = validate_identifier("_", ENV_VAR_RULES, "Environment variable");
        assert!(result.is_ok());
    }

    #[test]
    fn test_single_hyphen() {
        let result = validate_identifier("-", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_ok());
    }

    #[test]
    fn test_very_long_valid_string() {
        let long_name = "a".repeat(1000);
        let result = validate_identifier(&long_name, SKILL_NAME_RULES, "Skill name");
        assert!(result.is_ok());
    }

    // ─── Rule Variations ───────────────────────────────────────────────

    #[test]
    fn test_env_var_rules() {
        // Valid env var names
        assert!(validate_identifier("PATH", ENV_VAR_RULES, "Env var").is_ok());
        assert!(validate_identifier("MY_VAR_123", ENV_VAR_RULES, "Env var").is_ok());
        assert!(validate_identifier("_private", ENV_VAR_RULES, "Env var").is_ok());

        // Invalid env var names
        assert!(validate_identifier("MY-VAR", ENV_VAR_RULES, "Env var").is_err()); // hyphen not allowed
        assert!(validate_identifier("123VAR", ENV_VAR_RULES, "Env var").is_err()); // must start with letter/underscore
    }

    #[test]
    fn test_template_id_rules() {
        // Valid template IDs
        assert!(validate_identifier("my-template", TEMPLATE_ID_RULES, "Template").is_ok());
        assert!(validate_identifier("template_123", TEMPLATE_ID_RULES, "Template").is_ok());
        assert!(validate_identifier("123", TEMPLATE_ID_RULES, "Template").is_ok());

        // Invalid template IDs
        assert!(validate_identifier("my@template", TEMPLATE_ID_RULES, "Template").is_err());
        assert!(validate_identifier("../other", TEMPLATE_ID_RULES, "Template").is_err());
    }

    #[test]
    fn test_skill_name_rules() {
        // Valid skill names (permissive — only path-safety checks)
        assert!(validate_identifier("my-skill", SKILL_NAME_RULES, "Skill").is_ok());
        assert!(validate_identifier("skill_v2", SKILL_NAME_RULES, "Skill").is_ok());
        assert!(validate_identifier("skill123", SKILL_NAME_RULES, "Skill").is_ok());
        assert!(validate_identifier("my skill", SKILL_NAME_RULES, "Skill").is_ok());
        assert!(validate_identifier("my.skill", SKILL_NAME_RULES, "Skill").is_ok());
        assert!(validate_identifier("my@skill", SKILL_NAME_RULES, "Skill").is_ok());

        // Invalid skill names (path-safety violations)
        assert!(validate_identifier("../other", SKILL_NAME_RULES, "Skill").is_err());
        assert!(validate_identifier("my/skill", SKILL_NAME_RULES, "Skill").is_err());
    }

    #[test]
    fn test_hyphen_at_start_without_alpha_requirement() {
        // With require_alpha_start=false, hyphen can be at start
        let result = validate_identifier("-template", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_ok());
    }

    #[test]
    fn test_numbers_at_various_positions() {
        // Numbers in middle
        assert!(validate_identifier("test123", ENV_VAR_RULES, "Env").is_ok());
        assert!(validate_identifier("test123", TEMPLATE_ID_RULES, "Template").is_ok());

        // Numbers at end
        assert!(validate_identifier("myvar9", ENV_VAR_RULES, "Env").is_ok());
    }

    #[test]
    fn test_mixed_case() {
        assert!(validate_identifier("MyMixedCase_ID", ENV_VAR_RULES, "Env").is_ok());
        assert!(validate_identifier("CamelCaseID", TEMPLATE_ID_RULES, "Template").is_ok());
    }

    #[test]
    fn test_single_dot_allowed_in_permissive_rules() {
        // Single dot is allowed in skill names (permissive)
        let result = validate_identifier(".", SKILL_NAME_RULES, "Skill");
        assert!(result.is_ok());
    }

    #[test]
    fn test_single_dot_rejected_in_strict_rules() {
        // Single dot is rejected in template IDs (strict whitelist)
        let result = validate_identifier(".", TEMPLATE_ID_RULES, "Template");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid characters"));
    }

    #[test]
    fn test_multiple_dots_rejected() {
        // Multiple dots should be rejected
        let result = validate_identifier("....", SKILL_NAME_RULES, "Skill");
        assert!(result.is_err());
    }

    #[test]
    fn test_only_hyphens() {
        // String with only hyphens is valid for rules that allow hyphens
        let result = validate_identifier("---", TEMPLATE_ID_RULES, "Template");
        assert!(result.is_ok());
    }

    #[test]
    fn test_only_underscores() {
        // String with only underscores is valid for rules that allow underscores
        let result = validate_identifier("___", SKILL_NAME_RULES, "Skill");
        assert!(result.is_ok());
    }

    // ─── Context Messages ──────────────────────────────────────────────

    #[test]
    fn test_context_in_error_message() {
        let result = validate_identifier("", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Template ID"));
    }

    #[test]
    fn test_value_in_error_message() {
        let result = validate_identifier("bad@name", TEMPLATE_ID_RULES, "Template ID");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("bad@name"));
    }
}
