//! Task preset CRUD commands (filesystem-backed presets).

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn task_list_presets(
    config: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::presets::types::TaskPreset>> {
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::list_presets(&presets_dir)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
#[tracing::instrument(skip(config), level = "debug", err, fields(preset_id = %id))]
pub async fn task_get_preset(
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<tracepilot_orchestrator::presets::types::TaskPreset> {
    let pid = crate::validators::validate_preset_id(&id)?;
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::get_preset(&presets_dir, &pid)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
#[tracing::instrument(skip(config, preset), err, fields(preset_id = %preset.id))]
pub async fn task_save_preset(
    config: tauri::State<'_, SharedConfig>,
    preset: tracepilot_orchestrator::presets::types::TaskPreset,
) -> CmdResult<()> {
    crate::validators::validate_preset_id(&preset.id)?;
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::save_preset(&presets_dir, &preset)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
#[tracing::instrument(skip(config), err, fields(preset_id = %id))]
pub async fn task_delete_preset(
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<()> {
    let pid = crate::validators::validate_preset_id(&id)?;
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::delete_preset(&presets_dir, &pid)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}
