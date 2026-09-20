//! Installed skill catalog and effective enablement.

use std::collections::HashMap;
use std::path::Path;

use tracepilot_orchestrator::config_injector::{read_copilot_config, read_disabled_skills_file};
use tracepilot_orchestrator::skills::discovery::{
    discover_repository, discover_user_skills, skill_repository,
};
use tracepilot_orchestrator::skills::types::{
    SkillDiagnostic, SkillDisabledReason, SkillDiscoveryResult, SkillScope,
};

use crate::config::TracePilotConfig;
use crate::error::CmdResult;
use crate::helpers::definition_repo_roots;

pub(super) fn list_skills(
    cfg: &TracePilotConfig,
    extra_repo: Option<&str>,
) -> CmdResult<SkillDiscoveryResult> {
    let mut result = discover_user_skills(&cfg.copilot_home())?;
    let user_disabled = read_copilot_config(&cfg.copilot_home())?.disabled_skills;
    let mut repository_disabled = HashMap::new();
    for root in definition_repo_roots(cfg, extra_repo) {
        match discover_repository(&root) {
            Ok(found) => {
                result.skills.extend(found.skills);
                result.diagnostics.extend(found.diagnostics);
            }
            Err(error) => result.diagnostics.push(SkillDiagnostic {
                path: root.to_string_lossy().into(),
                message: error.to_string(),
                severity: "error".into(),
            }),
        }
        match read_disabled_skills_file(&root.join(".github/copilot/settings.json")) {
            Ok(disabled) => {
                repository_disabled.insert(root, disabled);
            }
            Err(error) => result.diagnostics.push(SkillDiagnostic {
                path: root
                    .join(".github/copilot/settings.json")
                    .to_string_lossy()
                    .into(),
                message: error.to_string(),
                severity: "error".into(),
            }),
        }
    }
    for skill in &mut result.skills {
        let project_disabled = if skill.scope == SkillScope::Repository {
            skill_repository(Path::new(&skill.directory))
                .and_then(|root| repository_disabled.get(root))
                .map(Vec::as_slice)
                .unwrap_or_default()
        } else {
            &[]
        };
        skill.disabled_reason = disabled_reason(&skill.name, &user_disabled, project_disabled);
        skill.enabled = skill.disabled_reason.is_none();
    }
    result.skills.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then_with(|| a.directory.cmp(&b.directory))
    });
    Ok(result)
}

pub(super) fn apply_enablement(
    enabled: &mut bool,
    reason: &mut Option<SkillDisabledReason>,
    name: &str,
    directory: &Path,
    scope: &SkillScope,
    copilot_home: &Path,
) -> CmdResult<()> {
    let user_disabled = read_copilot_config(copilot_home)?.disabled_skills;
    let project_disabled = if *scope == SkillScope::Repository {
        skill_repository(directory)
            .map(|root| read_disabled_skills_file(&root.join(".github/copilot/settings.json")))
            .transpose()?
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    *reason = disabled_reason(name, &user_disabled, &project_disabled);
    *enabled = reason.is_none();
    Ok(())
}

fn disabled_reason(name: &str, user: &[String], project: &[String]) -> Option<SkillDisabledReason> {
    if project.iter().any(|entry| entry.eq_ignore_ascii_case(name)) {
        Some(SkillDisabledReason::Repository)
    } else if user.iter().any(|entry| entry.eq_ignore_ascii_case(name)) {
        Some(SkillDisabledReason::User)
    } else {
        None
    }
}

#[cfg(test)]
mod tests;
