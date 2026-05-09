//! Path-safe name validation (template / skill / asset).
//!
//! These identifiers become filesystem path segments, so the shared
//! [`tracepilot_orchestrator::validation`] rules enforce character restrictions
//! and block path-traversal sequences like `..` or `/`.

use crate::error::{BindingsError, CmdResult};
use tracepilot_core::ids::SkillName;

/// Validate a template ID.
///
/// Template IDs must be safe for use in filesystem operations and cannot
/// contain path traversal sequences. Alphanumeric characters, hyphens, and
/// underscores are allowed.
///
/// This uses the shared validation logic from `tracepilot_orchestrator::validation`
/// to ensure consistency across all identifier validation.
pub(crate) fn validate_template_id(id: &str) -> CmdResult<()> {
    tracepilot_orchestrator::validation::validate_identifier(
        id,
        tracepilot_orchestrator::validation::TEMPLATE_ID_RULES,
        "Template ID",
    )
    .map_err(BindingsError::Validation)
}

/// Validate a skill name.
///
/// Skill names must be safe for use in filesystem operations and cannot
/// contain path traversal sequences or path separators. Character restrictions
/// are more permissive than template IDs to support existing skill
/// naming conventions.
///
/// Returns a [`SkillName`] newtype on success.
pub(crate) fn validate_skill_name(name: &str) -> CmdResult<SkillName> {
    tracepilot_orchestrator::validation::validate_identifier(
        name,
        tracepilot_orchestrator::validation::SKILL_NAME_RULES,
        "Skill name",
    )
    .map_err(BindingsError::Validation)?;
    Ok(SkillName::from_validated(name))
}

/// Validate an asset name for skills.
///
/// Asset names must be safe for use in filesystem operations. Uses the same
/// rules as skill names to allow flexibility while preventing path traversal.
pub(crate) fn validate_asset_name(name: &str) -> CmdResult<()> {
    tracepilot_orchestrator::skills::assets::validate_asset_name(name)
        .map_err(|e| BindingsError::Validation(e.to_string()))
}

/// Validate a single path segment supplied by the frontend (file name, version
/// directory, etc.) before it is joined onto a trusted parent directory.
///
/// Rejects empty strings, NULL bytes, `..`, path separators (`/` and `\`), and
/// absolute paths — the same defensive checks enforced by
/// [`tracepilot_orchestrator::validation::validate_identifier`] under
/// `SKILL_NAME_RULES` (no character whitelist, so `.` etc. are allowed).
///
/// Use this for inputs that name a single sub-directory or file within a
/// known-safe parent (e.g. `copilot_home/pkg/universal/<version>`), where
/// `validate_path_within` is overkill because the target path does not yet
/// exist.
pub(crate) fn validate_path_segment(value: &str, context: &str) -> CmdResult<()> {
    tracepilot_orchestrator::validation::validate_identifier(
        value,
        tracepilot_orchestrator::validation::SKILL_NAME_RULES,
        context,
    )
    .map_err(BindingsError::Validation)
}

/// Validate a CLI executable command string supplied by the renderer.
///
/// The string is later concatenated into a shell invocation (e.g. PowerShell
/// or `sh -c`) when launching detached terminal windows, so we must reject any
/// character that could break out of the literal command position.
///
/// Allowed characters:
/// * ASCII alphanumerics
/// * `-` `_` `.` (option flags, version separators)
/// * `/` `\` (Unix and Windows path separators — the value may legitimately be
///   a fully-qualified path like `/usr/local/bin/copilot` or
///   `C:\Tools\copilot.exe`)
/// * ` ` (a space — to allow an executable name followed by a fixed sub-command,
///   e.g. `npx copilot`)
/// * `:` (Windows drive letter, e.g. `C:\...`)
///
/// Empty strings are rejected so callers can rely on a non-empty command.
pub(crate) fn validate_cli_command(cli: &str) -> CmdResult<()> {
    if cli.is_empty() {
        return Err(BindingsError::Validation(
            "CLI command must not be empty".into(),
        ));
    }
    if !cli
        .chars()
        .all(|c| c.is_alphanumeric() || "-_./\\ :".contains(c))
    {
        return Err(BindingsError::Validation(
            "CLI command contains invalid characters".into(),
        ));
    }
    Ok(())
}
