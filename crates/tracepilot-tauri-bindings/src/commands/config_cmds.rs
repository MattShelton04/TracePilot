//! Configuration Tauri commands (24 commands).

use crate::blocking_cmd;
use crate::concurrency::IndexingSemaphores;
use crate::config::{self, SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{
    mutex_poisoned, read_config, remove_index_db_files, validate_path_within,
    validate_write_path_within,
};
use crate::types::ValidateSessionDirResult;

use super::config_paths::{copy_tracepilot_home_if_moved, validate_configured_roots};

#[tauri::command]
#[specta::specta]
pub async fn check_config_exists() -> CmdResult<bool> {
    blocking_cmd!(Ok::<_, BindingsError>(
        config::config_file_path().is_some_and(|p| p.exists())
    ))
}

#[tauri::command]
pub async fn get_config(state: tauri::State<'_, SharedConfig>) -> CmdResult<TracePilotConfig> {
    Ok(read_config(&state))
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn save_config(
    state: tauri::State<'_, SharedConfig>,
    gates: tauri::State<'_, std::sync::Arc<IndexingSemaphores>>,
    config: TracePilotConfig,
) -> CmdResult<()> {
    let old_tracepilot_home = read_config(&state).tracepilot_home();
    let mut cfg = config;
    cfg.normalize_paths();
    validate_configured_roots(&cfg)?;
    let new_tracepilot_home = cfg.tracepilot_home();
    let (session_indexing_permit, search_indexing_permit) =
        if old_tracepilot_home != new_tracepilot_home {
            (
                Some(
                    gates
                        .try_acquire_sessions()
                        .map_err(|_| BindingsError::AlreadyIndexing)?,
                ),
                Some(
                    gates
                        .try_acquire_search()
                        .map_err(|_| BindingsError::AlreadyIndexing)?,
                ),
            )
        } else {
            (None, None)
        };
    let cfg_for_disk = cfg.clone();
    let cfg_for_state = cfg;
    let config_state = std::sync::Arc::clone(&*state);
    tokio::task::spawn_blocking(move || {
        let _session_indexing_permit = session_indexing_permit;
        let _search_indexing_permit = search_indexing_permit;
        copy_tracepilot_home_if_moved(&old_tracepilot_home, &new_tracepilot_home)?;
        cfg_for_disk.save()?;

        let mut config_guard = config_state.write().map_err(|_| mutex_poisoned())?;
        *config_guard = Some(cfg_for_state);
        Ok::<_, BindingsError>(())
    })
    .await??;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn validate_session_dir(path: String) -> CmdResult<ValidateSessionDirResult> {
    blocking_cmd!({
        let dir = std::path::PathBuf::from(path);
        if !dir.exists() {
            return Ok(ValidateSessionDirResult {
                valid: false,
                session_count: 0,
                error: Some(format!("Directory does not exist: {}", dir.display())),
            });
        }
        if !dir.is_dir() {
            return Ok(ValidateSessionDirResult {
                valid: false,
                session_count: 0,
                error: Some(format!("Path is not a directory: {}", dir.display())),
            });
        }
        match tracepilot_core::session::discovery::discover_sessions(&dir) {
            Ok(sessions) => Ok(ValidateSessionDirResult {
                valid: true,
                session_count: sessions.len(),
                error: None,
            }),
            Err(e) => Ok::<_, BindingsError>(ValidateSessionDirResult {
                valid: false,
                session_count: 0,
                error: Some(e.to_string()),
            }),
        }
    })
}

#[tauri::command]
#[specta::specta]
pub async fn factory_reset(state: tauri::State<'_, SharedConfig>) -> CmdResult<()> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let config_path = config::config_file_path();

    tokio::task::spawn_blocking(move || {
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
        Ok::<(), BindingsError>(())
    })
    .await??;

    let mut guard = state.write().map_err(|_| mutex_poisoned())?;
    *guard = None;
    Ok(())
}

fn agent_backup_dir(cfg: &TracePilotConfig) -> std::path::PathBuf {
    tracepilot_core::paths::TracePilotPaths::from_root(cfg.tracepilot_home()).agent_backups_dir()
}

#[tauri::command]
pub async fn get_agent_definitions(
    state: tauri::State<'_, SharedConfig>,
    version: Option<String>,
) -> CmdResult<Vec<tracepilot_orchestrator::AgentDefinition>> {
    if let Some(ref v) = version {
        crate::validators::validate_path_segment(v, "Version")?;
    }
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        let version_dir = if let Some(v) = version {
            tracepilot_core::paths::CopilotPaths::from_home(&home).version_dir(&v)
        } else {
            let active = tracepilot_orchestrator::version_manager::active_version(&home)?;
            std::path::PathBuf::from(active.path)
        };
        Ok::<_, BindingsError>(
            tracepilot_orchestrator::config_injector::read_agent_definitions(&version_dir)?,
        )
    })
}

#[tauri::command]
#[specta::specta]
pub async fn save_agent_definition(
    state: tauri::State<'_, SharedConfig>,
    file_path: String,
    yaml_content: String,
) -> CmdResult<()> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        let validated = validate_write_path_within(&file_path, &home)?;
        Ok::<_, BindingsError>(
            tracepilot_orchestrator::config_injector::write_agent_definition(
                &validated,
                &yaml_content,
            )?,
        )
    })
}

#[tauri::command]
pub async fn get_copilot_config(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<tracepilot_orchestrator::CopilotConfig> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        Ok::<_, BindingsError>(
            tracepilot_orchestrator::config_injector::read_copilot_config(&home)?,
        )
    })
}

#[tauri::command]
pub async fn save_copilot_config(
    state: tauri::State<'_, SharedConfig>,
    config: serde_json::Value,
) -> CmdResult<()> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        Ok::<_, BindingsError>(
            tracepilot_orchestrator::config_injector::write_copilot_config(&home, &config)?,
        )
    })
}

#[tauri::command]
pub async fn create_config_backup(
    state: tauri::State<'_, SharedConfig>,
    file_path: String,
    label: String,
) -> CmdResult<tracepilot_orchestrator::BackupEntry> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        let validated = validate_path_within(&file_path, &home)?;
        let backup_dir = agent_backup_dir(&cfg);
        Ok::<_, BindingsError>(tracepilot_orchestrator::config_injector::create_backup(
            &validated,
            &backup_dir,
            &label,
        )?)
    })
}

#[tauri::command]
pub async fn list_config_backups(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::BackupEntry>> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let backup_dir = agent_backup_dir(&cfg);
        Ok::<_, BindingsError>(tracepilot_orchestrator::config_injector::list_backups(
            &backup_dir,
        )?)
    })
}

#[tauri::command]
pub async fn restore_config_backup(
    state: tauri::State<'_, SharedConfig>,
    backup_path: String,
    restore_to: String,
) -> CmdResult<()> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let backup_dir = agent_backup_dir(&cfg);
        let validated_backup = validate_path_within(&backup_path, &backup_dir)?;
        let home = cfg.copilot_home();
        let validated_restore = validate_write_path_within(&restore_to, &home)?;
        Ok::<_, crate::error::BindingsError>(
            tracepilot_orchestrator::config_injector::restore_backup(
                &validated_backup,
                &validated_restore,
            )?,
        )
    })
}

#[tauri::command]
pub async fn delete_config_backup(
    state: tauri::State<'_, SharedConfig>,
    backup_path: String,
) -> CmdResult<()> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let backup_dir = agent_backup_dir(&cfg);
        let validated = validate_path_within(&backup_path, &backup_dir)?;
        Ok::<_, crate::error::BindingsError>(
            tracepilot_core::utils::backup::BackupStore::new(&backup_dir)
                .delete_file(&validated)
                .map_err(tracepilot_orchestrator::OrchestratorError::from)?,
        )
    })
}

#[tauri::command]
pub async fn preview_backup_restore(
    state: tauri::State<'_, SharedConfig>,
    backup_path: String,
    source_path: String,
) -> CmdResult<tracepilot_orchestrator::BackupDiffPreview> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let backup_dir = agent_backup_dir(&cfg);
        let validated_backup = validate_path_within(&backup_path, &backup_dir)?;
        let home = cfg.copilot_home();
        let validated_source = validate_write_path_within(&source_path, &home)?;

        Ok::<_, crate::error::BindingsError>(
            tracepilot_orchestrator::config_injector::preview_backup_restore(
                &validated_backup,
                &validated_source,
            )?,
        )
    })
}

#[tauri::command]
pub async fn diff_config_files(
    state: tauri::State<'_, SharedConfig>,
    old_path: String,
    new_path: String,
) -> CmdResult<tracepilot_orchestrator::ConfigDiff> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        let validated_old = validate_write_path_within(&old_path, &home)?;
        let validated_new = validate_write_path_within(&new_path, &home)?;
        Ok::<_, crate::error::BindingsError>(tracepilot_orchestrator::config_injector::diff_files(
            &validated_old,
            &validated_new,
        )?)
    })
}

#[tauri::command]
pub async fn discover_copilot_versions(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::CopilotVersion>> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        Ok::<_, crate::error::BindingsError>(
            tracepilot_orchestrator::version_manager::discover_versions(&home)?,
        )
    })
}

#[tauri::command]
pub async fn get_active_copilot_version(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<tracepilot_orchestrator::CopilotVersion> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        Ok::<_, crate::error::BindingsError>(
            tracepilot_orchestrator::version_manager::active_version(&home)?,
        )
    })
}

#[tauri::command]
pub async fn get_migration_diffs(
    state: tauri::State<'_, SharedConfig>,
    from_version: String,
    to_version: String,
) -> CmdResult<Vec<tracepilot_orchestrator::MigrationDiff>> {
    crate::validators::validate_path_segment(&from_version, "from_version")?;
    crate::validators::validate_path_segment(&to_version, "to_version")?;
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        Ok::<_, crate::error::BindingsError>(
            tracepilot_orchestrator::version_manager::migration_diffs(
                &home,
                &from_version,
                &to_version,
            )?,
        )
    })
}

#[tauri::command]
pub async fn migrate_agent_definition(
    state: tauri::State<'_, SharedConfig>,
    file_name: String,
    from_version: String,
    to_version: String,
) -> CmdResult<()> {
    crate::validators::validate_path_segment(&file_name, "file_name")?;
    crate::validators::validate_path_segment(&from_version, "from_version")?;
    crate::validators::validate_path_segment(&to_version, "to_version")?;
    let cfg = read_config(&state);
    blocking_cmd!({
        let home = cfg.copilot_home();
        Ok::<_, crate::error::BindingsError>(
            tracepilot_orchestrator::version_manager::migrate_agent(
                &home,
                &file_name,
                &from_version,
                &to_version,
            )?,
        )
    })
}

#[tauri::command]
pub async fn list_session_templates(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::SessionTemplate>> {
    let cfg = read_config(&state);
    blocking_cmd!(tracepilot_orchestrator::templates::all_templates_in(
        &cfg.tracepilot_home()
    ))
}

#[tauri::command]
pub async fn save_session_template(
    state: tauri::State<'_, SharedConfig>,
    template: tracepilot_orchestrator::SessionTemplate,
) -> CmdResult<()> {
    crate::validators::validate_template_id(&template.id)?;
    let cfg = read_config(&state);
    blocking_cmd!(tracepilot_orchestrator::templates::save_template_in(
        &cfg.tracepilot_home(),
        &template,
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_session_template(
    state: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<()> {
    crate::validators::validate_template_id(&id)?;
    let cfg = read_config(&state);
    blocking_cmd!(tracepilot_orchestrator::templates::delete_template_in(
        &cfg.tracepilot_home(),
        &id
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn restore_default_templates(state: tauri::State<'_, SharedConfig>) -> CmdResult<()> {
    let cfg = read_config(&state);
    blocking_cmd!(
        tracepilot_orchestrator::templates::restore_all_default_templates_in(
            &cfg.tracepilot_home()
        )
    )
}

#[tauri::command]
#[specta::specta]
pub async fn increment_template_usage(
    state: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<()> {
    crate::validators::validate_template_id(&id)?;
    let cfg = read_config(&state);
    blocking_cmd!(tracepilot_orchestrator::templates::increment_usage_in(
        &cfg.tracepilot_home(),
        &id
    ))
}
