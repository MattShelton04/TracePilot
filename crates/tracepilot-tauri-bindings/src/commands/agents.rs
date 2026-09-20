//! Agents explorer commands: definitions, `/subagents` overrides and usage.

use std::path::{Path, PathBuf};

use tracepilot_core::analytics::{AgentUsageDetail, AgentUsageSummary};
use tracepilot_orchestrator::agents::write::BuiltinWrites;
use tracepilot_orchestrator::agents::{
    AgentCatalog, AgentCreateScope, AgentDefinitionDetail, AgentFields, AgentRoots,
    AgentWriteResult, SubagentOverride, SubagentSettings,
};

use crate::blocking_cmd;
use crate::config::{SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{open_index_db, read_config};

/// Agent names are CLI identifiers; bound their size and reject control
/// characters before they reach settings.json or SQL parameters.
fn validate_agent_name(name: &str) -> CmdResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 200 || trimmed.chars().any(char::is_control) {
        return Err(BindingsError::Validation(
            "Agent name must be 1-200 printable characters".into(),
        ));
    }
    Ok(())
}

/// Registered repositories plus an explicitly requested one.
fn agent_roots(cfg: &TracePilotConfig, extra_repo: Option<&str>) -> AgentRoots {
    AgentRoots {
        copilot_home: cfg.copilot_home(),
        repo_roots: crate::helpers::definition_repo_roots(cfg, extra_repo),
    }
}

/// Built-in definitions are writable only in the Config Injector's
/// advanced mode.
fn builtin_writes(cfg: &TracePilotConfig) -> BuiltinWrites {
    if cfg.features.config_injector {
        BuiltinWrites::Allowed
    } else {
        BuiltinWrites::Denied
    }
}

fn backup_dir(cfg: &TracePilotConfig) -> PathBuf {
    tracepilot_core::paths::TracePilotPaths::from_root(cfg.tracepilot_home()).agent_backups_dir()
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn agents_list(
    state: tauri::State<'_, SharedConfig>,
    repo_root: Option<String>,
) -> CmdResult<AgentCatalog> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let roots = agent_roots(&cfg, repo_root.as_deref());
        let mut catalog = tracepilot_orchestrator::agents::discover(&roots);
        catalog.settings =
            tracepilot_orchestrator::agents::settings::read_settings(&cfg.copilot_home());
        Ok::<_, BindingsError>(catalog)
    })
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn agents_get(
    state: tauri::State<'_, SharedConfig>,
    path: String,
) -> CmdResult<AgentDefinitionDetail> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let roots = agent_roots(&cfg, None);
        Ok::<_, BindingsError>(tracepilot_orchestrator::agents::load_definition(
            &roots,
            Path::new(&path),
        )?)
    })
}

/// The file content a structured save would write, for diff previews.
#[tauri::command]
#[tracing::instrument(skip(state, fields, body), err)]
pub async fn agents_preview(
    state: tauri::State<'_, SharedConfig>,
    path: String,
    fields: AgentFields,
    body: String,
) -> CmdResult<String> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let roots = agent_roots(&cfg, None);
        let path = Path::new(&path);
        // Reading is allowed for every known root; this only validates it.
        tracepilot_orchestrator::agents::load_definition(&roots, path)?;
        Ok::<_, BindingsError>(tracepilot_orchestrator::agents::write::render_update(
            path, &fields, &body,
        )?)
    })
}

#[tauri::command]
#[tracing::instrument(skip(state, fields, body), err)]
pub async fn agents_save(
    state: tauri::State<'_, SharedConfig>,
    path: String,
    fields: AgentFields,
    body: String,
) -> CmdResult<AgentWriteResult> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let roots = agent_roots(&cfg, None);
        Ok::<_, BindingsError>(tracepilot_orchestrator::agents::write::save_fields(
            &roots,
            Path::new(&path),
            &fields,
            &body,
            builtin_writes(&cfg),
            &backup_dir(&cfg),
        )?)
    })
}

#[tauri::command]
#[tracing::instrument(skip(state, content), err)]
pub async fn agents_save_raw(
    state: tauri::State<'_, SharedConfig>,
    path: String,
    content: String,
) -> CmdResult<AgentWriteResult> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let roots = agent_roots(&cfg, None);
        Ok::<_, BindingsError>(tracepilot_orchestrator::agents::write::save_raw(
            &roots,
            Path::new(&path),
            &content,
            builtin_writes(&cfg),
            &backup_dir(&cfg),
        )?)
    })
}

#[tauri::command]
#[tracing::instrument(skip(state, description), err)]
pub async fn agents_create(
    state: tauri::State<'_, SharedConfig>,
    scope: AgentCreateScope,
    repo_root: Option<String>,
    name: String,
    description: String,
) -> CmdResult<AgentWriteResult> {
    validate_agent_name(&name)?;
    let cfg = read_config(&state);
    blocking_cmd!({
        // Project agents may only be created in registered repositories.
        let roots = agent_roots(&cfg, None);
        Ok::<_, BindingsError>(tracepilot_orchestrator::agents::write::create(
            &roots,
            scope,
            repo_root.as_deref().map(Path::new),
            &name,
            &description,
        )?)
    })
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn agents_delete(
    state: tauri::State<'_, SharedConfig>,
    path: String,
) -> CmdResult<AgentWriteResult> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let roots = agent_roots(&cfg, None);
        Ok::<_, BindingsError>(tracepilot_orchestrator::agents::write::delete(
            &roots,
            Path::new(&path),
            &backup_dir(&cfg),
        )?)
    })
}

/// Set or (with `None`) reset the `/subagents` override for one agent.
#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn agents_set_override(
    state: tauri::State<'_, SharedConfig>,
    agent_type: String,
    value: Option<SubagentOverride>,
) -> CmdResult<SubagentSettings> {
    validate_agent_name(&agent_type)?;
    let home = read_config(&state).copilot_home();
    blocking_cmd!({
        tracepilot_orchestrator::agents::settings::set_override(
            &home,
            &agent_type,
            value.as_ref(),
        )?;
        Ok::<_, BindingsError>(tracepilot_orchestrator::agents::settings::read_settings(
            &home,
        ))
    })
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn agents_set_disabled(
    state: tauri::State<'_, SharedConfig>,
    agent_type: String,
    disabled: bool,
) -> CmdResult<SubagentSettings> {
    validate_agent_name(&agent_type)?;
    let home = read_config(&state).copilot_home();
    blocking_cmd!({
        tracepilot_orchestrator::agents::settings::set_disabled(&home, &agent_type, disabled)?;
        Ok::<_, BindingsError>(tracepilot_orchestrator::agents::settings::read_settings(
            &home,
        ))
    })
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn agents_usage_summary(
    state: tauri::State<'_, SharedConfig>,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
) -> CmdResult<AgentUsageSummary> {
    crate::validators::validate_iso_date_range(&from_date, &to_date)?;
    let index_path = read_config(&state).index_db_path();
    blocking_cmd!({
        let Some(open) = open_index_db(&index_path) else {
            return Ok(AgentUsageSummary::default());
        };
        Ok::<_, BindingsError>(open.db.query_agent_usage_summary(
            from_date.as_deref(),
            to_date.as_deref(),
            repo.as_deref(),
        )?)
    })
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn agents_usage_detail(
    state: tauri::State<'_, SharedConfig>,
    agent_name: String,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
) -> CmdResult<AgentUsageDetail> {
    validate_agent_name(&agent_name)?;
    crate::validators::validate_iso_date_range(&from_date, &to_date)?;
    let index_path = read_config(&state).index_db_path();
    blocking_cmd!({
        let Some(open) = open_index_db(&index_path) else {
            return Ok(AgentUsageDetail::default());
        };
        Ok::<_, BindingsError>(open.db.query_agent_usage_detail(
            agent_name.trim(),
            from_date.as_deref(),
            to_date.as_deref(),
            repo.as_deref(),
        )?)
    })
}

#[cfg(test)]
mod tests {
    use super::validate_agent_name;

    #[test]
    fn agent_names_are_bounded_printable_identifiers() {
        assert!(validate_agent_name("code-review").is_ok());
        assert!(validate_agent_name("  ").is_err());
        assert!(validate_agent_name("bad\nname").is_err());
        assert!(validate_agent_name(&"x".repeat(201)).is_err());
    }
}
