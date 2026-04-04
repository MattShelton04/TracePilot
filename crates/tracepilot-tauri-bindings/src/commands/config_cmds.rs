//! Configuration Tauri commands (24 commands).

use crate::blocking_cmd;
use crate::config::{self, SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{copilot_home, read_config, remove_index_db_files, validate_path_within, validate_write_path_within};
use crate::types::ValidateSessionDirResult;

#[tauri::command]
pub async fn check_config_exists() -> CmdResult<bool> {
    blocking_cmd!(config::config_file_path().is_some_and(|p| p.exists()))
}

#[tauri::command]
pub async fn get_config(state: tauri::State<'_, SharedConfig>) -> CmdResult<TracePilotConfig> {
    Ok(read_config(&state))
}

#[tauri::command]
pub async fn save_config(
    state: tauri::State<'_, SharedConfig>,
    config: TracePilotConfig,
) -> CmdResult<()> {
    let cfg = config.clone();
    tokio::task::spawn_blocking(move || cfg.save()).await??;

    let mut guard = state
        .write()
        .map_err(|_| BindingsError::Validation("Config lock poisoned".into()))?;
    *guard = Some(config);
    Ok(())
}

#[tauri::command]
pub async fn validate_session_dir(path: String) -> CmdResult<ValidateSessionDirResult> {
    blocking_cmd!({
        let dir = std::path::PathBuf::from(&path);
        if !dir.exists() {
            return ValidateSessionDirResult {
                valid: false,
                session_count: 0,
                error: Some(format!("Directory does not exist: {path}")),
            };
        }
        if !dir.is_dir() {
            return ValidateSessionDirResult {
                valid: false,
                session_count: 0,
                error: Some(format!("Path is not a directory: {path}")),
            };
        }
        match tracepilot_core::session::discovery::discover_sessions(&dir) {
            Ok(sessions) => ValidateSessionDirResult {
                valid: true,
                session_count: sessions.len(),
                error: None,
            },
            Err(e) => ValidateSessionDirResult {
                valid: false,
                session_count: 0,
                error: Some(e.to_string()),
            },
        }
    })
}

#[tauri::command]
pub async fn factory_reset(state: tauri::State<'_, SharedConfig>) -> CmdResult<()> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let config_path = config::config_file_path();

    blocking_cmd!({
        // Best-effort: log failures but don't abort the reset.
        if let Err(e) = remove_index_db_files(&index_path) {
            tracing::warn!(error = %e, "factory_reset: failed to remove index DB files");
        }

        if let Some(ref path) = config_path {
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    tracing::warn!(error = %e, "factory_reset: failed to remove config file");
                }
            }
        }
        ()
    })?;

    let mut guard = state
        .write()
        .map_err(|_| BindingsError::Validation("Config lock poisoned".into()))?;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn get_agent_definitions(
    version: Option<String>,
) -> CmdResult<Vec<tracepilot_orchestrator::AgentDefinition>> {
    blocking_cmd!({
        let home = copilot_home()?;
        let version_dir = if let Some(v) = version {
            home.join("pkg").join("universal").join(v)
        } else {
            let active = tracepilot_orchestrator::version_manager::active_version(&home)?;
            std::path::PathBuf::from(&active.path)
        };
        tracepilot_orchestrator::config_injector::read_agent_definitions(&version_dir)?
    })
}

#[tauri::command]
pub async fn save_agent_definition(file_path: String, yaml_content: String) -> CmdResult<()> {
    blocking_cmd!({
        let home = copilot_home()?;
        let validated = validate_write_path_within(&file_path, &home)?;
        tracepilot_orchestrator::config_injector::write_agent_definition(
            &validated,
            &yaml_content,
        )?
    })
}

#[tauri::command]
pub async fn get_copilot_config() -> CmdResult<tracepilot_orchestrator::CopilotConfig> {
    blocking_cmd!({
        let home = copilot_home()?;
        tracepilot_orchestrator::config_injector::read_copilot_config(&home)?
    })
}

#[tauri::command]
pub async fn save_copilot_config(config: serde_json::Value) -> CmdResult<()> {
    blocking_cmd!({
        let home = copilot_home()?;
        tracepilot_orchestrator::config_injector::write_copilot_config(&home, &config)?
    })
}

#[tauri::command]
pub async fn create_config_backup(
    file_path: String,
    label: String,
) -> CmdResult<tracepilot_orchestrator::BackupEntry> {
    blocking_cmd!({
        let home = copilot_home()?;
        let validated = validate_path_within(&file_path, &home)?;
        let backup_dir = tracepilot_orchestrator::config_injector::backup_dir()?;
        tracepilot_orchestrator::config_injector::create_backup(
            &validated,
            &backup_dir,
            &label,
        )?
    })
}

#[tauri::command]
pub async fn list_config_backups() -> CmdResult<Vec<tracepilot_orchestrator::BackupEntry>> {
    blocking_cmd!({
        let backup_dir = tracepilot_orchestrator::config_injector::backup_dir()?;
        tracepilot_orchestrator::config_injector::list_backups(
            &backup_dir,
        )?
    })
}

#[tauri::command]
pub async fn restore_config_backup(backup_path: String, restore_to: String) -> CmdResult<()> {
    blocking_cmd!({
        let backup_dir = tracepilot_orchestrator::config_injector::backup_dir()?;
        let validated_backup = validate_path_within(&backup_path, &backup_dir)?;
        let home = copilot_home()?;
        let validated_restore = validate_write_path_within(&restore_to, &home)?;
        tracepilot_orchestrator::config_injector::restore_backup(
            &validated_backup,
            &validated_restore,
        )?
    })
}

#[tauri::command]
pub async fn delete_config_backup(backup_path: String) -> CmdResult<()> {
    blocking_cmd!({
        let backup_dir = tracepilot_orchestrator::config_injector::backup_dir()?;
        let validated = validate_path_within(&backup_path, &backup_dir)?;
        tracepilot_orchestrator::config_injector::delete_backup(
            &validated,
        )?
    })
}

#[tauri::command]
pub async fn preview_backup_restore(
    backup_path: String,
    source_path: String,
) -> CmdResult<tracepilot_orchestrator::BackupDiffPreview> {
    blocking_cmd!({
        let backup_dir = tracepilot_orchestrator::config_injector::backup_dir()?;
        let validated_backup = validate_path_within(&backup_path, &backup_dir)?;
        let home = copilot_home()?;
        let validated_source = validate_write_path_within(&source_path, &home)?;

        tracepilot_orchestrator::config_injector::preview_backup_restore(
            &validated_backup,
            &validated_source,
        )?
    })
}

#[tauri::command]
pub async fn diff_config_files(
    old_path: String,
    new_path: String,
) -> CmdResult<tracepilot_orchestrator::ConfigDiff> {
    blocking_cmd!({
        let home = copilot_home()?;
        let validated_old = validate_write_path_within(&old_path, &home)?;
        let validated_new = validate_write_path_within(&new_path, &home)?;
        tracepilot_orchestrator::config_injector::diff_files(
            &validated_old,
            &validated_new,
        )?
    })
}

#[tauri::command]
pub async fn discover_copilot_versions() -> CmdResult<Vec<tracepilot_orchestrator::CopilotVersion>>
{
    blocking_cmd!({
        let home = copilot_home()?;
        tracepilot_orchestrator::version_manager::discover_versions(
            &home,
        )?
    })
}

#[tauri::command]
pub async fn get_active_copilot_version() -> CmdResult<tracepilot_orchestrator::CopilotVersion> {
    blocking_cmd!({
        let home = copilot_home()?;
        tracepilot_orchestrator::version_manager::active_version(
            &home,
        )?
    })
}

#[tauri::command]
pub async fn get_migration_diffs(
    from_version: String,
    to_version: String,
) -> CmdResult<Vec<tracepilot_orchestrator::MigrationDiff>> {
    blocking_cmd!({
        let home = copilot_home()?;
        tracepilot_orchestrator::version_manager::migration_diffs(
            &home,
            &from_version,
            &to_version,
        )?
    })
}

#[tauri::command]
pub async fn migrate_agent_definition(
    file_name: String,
    from_version: String,
    to_version: String,
) -> CmdResult<()> {
    blocking_cmd!({
        let home = copilot_home()?;
        tracepilot_orchestrator::version_manager::migrate_agent(
            &home,
            &file_name,
            &from_version,
            &to_version,
        )?
    })
}

#[tauri::command]
pub async fn list_session_templates() -> CmdResult<Vec<tracepilot_orchestrator::SessionTemplate>> {
    blocking_cmd!(tracepilot_orchestrator::templates::all_templates()?)
}

#[tauri::command]
pub async fn save_session_template(
    template: tracepilot_orchestrator::SessionTemplate,
) -> CmdResult<()> {
    blocking_cmd!(tracepilot_orchestrator::templates::save_template(
        &template,
    ))
}

#[tauri::command]
pub async fn delete_session_template(id: String) -> CmdResult<()> {
    blocking_cmd!(tracepilot_orchestrator::templates::delete_template(&id))
}

#[tauri::command]
pub async fn restore_default_templates() -> CmdResult<()> {
    blocking_cmd!(tracepilot_orchestrator::templates::restore_all_default_templates())
}

#[tauri::command]
pub async fn increment_template_usage(id: String) -> CmdResult<()> {
    blocking_cmd!(tracepilot_orchestrator::templates::increment_usage(&id))
}
