//! Cross-session skill usage, read from the index.
//!
//! Aggregation only. Matching a usage row to an installed skill happens in
//! the UI, where both the catalog and the usage summary are already loaded
//! and the rules (directory first, then name) are unit-testable without a
//! database.

use tracepilot_core::analytics::{SkillUsageDetail, SkillUsageSummary};

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{open_index_db, read_config};

/// Skill names reach a SQL parameter and a comparison; bound their size and
/// reject control characters first.
fn validate_skill_name(name: &str) -> CmdResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 200 || trimmed.chars().any(char::is_control) {
        return Err(BindingsError::Validation(
            "Skill name must be 1-200 printable characters".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn skills_usage_summary(
    state: tauri::State<'_, SharedConfig>,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
) -> CmdResult<SkillUsageSummary> {
    crate::validators::validate_iso_date_range(&from_date, &to_date)?;
    let index_path = read_config(&state).index_db_path();
    blocking_cmd!({
        // Before the first index there is no usage to report, which the UI
        // shows as "usage is still indexing" rather than as zero uses.
        let Some(open) = open_index_db(&index_path) else {
            return Ok(SkillUsageSummary::default());
        };
        Ok::<_, BindingsError>(open.db.query_skill_usage_summary(
            from_date.as_deref(),
            to_date.as_deref(),
            repo.as_deref(),
        )?)
    })
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn skills_usage_detail(
    state: tauri::State<'_, SharedConfig>,
    skill_name: String,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
) -> CmdResult<SkillUsageDetail> {
    validate_skill_name(&skill_name)?;
    crate::validators::validate_iso_date_range(&from_date, &to_date)?;
    let index_path = read_config(&state).index_db_path();
    blocking_cmd!({
        let Some(open) = open_index_db(&index_path) else {
            return Ok(SkillUsageDetail::default());
        };
        Ok::<_, BindingsError>(open.db.query_skill_usage_detail(
            skill_name.trim(),
            from_date.as_deref(),
            to_date.as_deref(),
            repo.as_deref(),
        )?)
    })
}

#[cfg(test)]
mod tests {
    use super::validate_skill_name;

    #[test]
    fn skill_names_are_bounded_printable_identifiers() {
        assert!(validate_skill_name("frontend-design").is_ok());
        assert!(validate_skill_name("  ").is_err());
        assert!(validate_skill_name("bad\nname").is_err());
        assert!(validate_skill_name(&"x".repeat(201)).is_err());
    }
}
