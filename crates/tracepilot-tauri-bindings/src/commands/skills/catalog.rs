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
        let mut restrictions = (Vec::new(), Vec::new());
        for (file, names) in [
            ("settings.json", &mut restrictions.0),
            ("settings.local.json", &mut restrictions.1),
        ] {
            let path = root.join(".github/copilot").join(file);
            match read_disabled_skills_file(&path) {
                Ok(disabled) => *names = disabled,
                Err(error) => result.diagnostics.push(SkillDiagnostic {
                    path: path.to_string_lossy().into(),
                    message: error.to_string(),
                    severity: "error".into(),
                }),
            }
        }
        repository_disabled.insert(root, restrictions);
    }
    for skill in &mut result.skills {
        let restrictions = if skill.scope == SkillScope::Repository {
            skill_repository(Path::new(&skill.directory))
                .and_then(|root| repository_disabled.get(root))
        } else {
            None
        };
        let (project, local) = restrictions
            .map(|(p, l)| (p.as_slice(), l.as_slice()))
            .unwrap_or_default();
        skill.disabled_reason = disabled_reason(&skill.name, &user_disabled, project, local);
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
    let root = (*scope == SkillScope::Repository)
        .then(|| skill_repository(directory))
        .flatten();
    let read = |file: &str| -> CmdResult<Vec<String>> {
        Ok(root
            .map(|root| read_disabled_skills_file(&root.join(".github/copilot").join(file)))
            .transpose()?
            .unwrap_or_default())
    };
    *reason = disabled_reason(
        name,
        &user_disabled,
        &read("settings.json")?,
        &read("settings.local.json")?,
    );
    *enabled = reason.is_none();
    Ok(())
}

fn disabled_reason(
    name: &str,
    user: &[String],
    project: &[String],
    local: &[String],
) -> Option<SkillDisabledReason> {
    if user.iter().any(|entry| entry.eq_ignore_ascii_case(name)) {
        Some(SkillDisabledReason::User)
    } else if project.iter().any(|entry| entry.eq_ignore_ascii_case(name)) {
        Some(SkillDisabledReason::Repository)
    } else if local.iter().any(|entry| entry.eq_ignore_ascii_case(name)) {
        Some(SkillDisabledReason::Local)
    } else {
        None
    }
}

/// Resolve the setting from the installed definition, never from a supplied name.
pub(super) fn set_enabled(copilot_home: &Path, directory: &Path, enabled: bool) -> CmdResult<()> {
    use tracepilot_orchestrator::config_injector::{set_local_skill_enabled, set_skill_enabled};
    let mut skill = tracepilot_orchestrator::skills::manager::get_skill(directory)?;
    if skill.scope == SkillScope::Repository {
        apply_enablement(
            &mut skill.enabled,
            &mut skill.disabled_reason,
            &skill.frontmatter.name,
            directory,
            &skill.scope,
            copilot_home,
        )?;
        if enabled
            && matches!(
                skill.disabled_reason,
                Some(SkillDisabledReason::User | SkillDisabledReason::Repository)
            )
        {
            return Err(crate::error::BindingsError::Validation(
                "This skill is disabled by inherited Copilot settings. Remove that restriction before enabling it in this project.".into()
            ));
        }
        let root = skill_repository(directory).ok_or_else(|| {
            crate::error::BindingsError::Validation("Skill has no repository root".into())
        })?;
        set_local_skill_enabled(root, &skill.frontmatter.name, enabled)?;
    } else {
        set_skill_enabled(copilot_home, &skill.frontmatter.name, enabled)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
