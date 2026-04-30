//! Serde `default = "..."` helper functions shared across sub-configs.

use super::ModelPriceEntry;

pub(super) fn default_true() -> bool {
    true
}

pub(super) fn default_theme() -> String {
    "dark".to_string()
}

pub(super) fn default_cli_command() -> String {
    tracepilot_core::constants::DEFAULT_CLI_COMMAND.to_string()
}

pub(super) fn default_auto_refresh_interval() -> u32 {
    5
}

pub(super) fn default_content_max_width() -> u32 {
    1600
}

pub(super) fn default_ui_scale() -> f64 {
    1.0
}

pub(super) fn default_cost_per_premium_request() -> f64 {
    0.04
}

pub(super) fn default_favourite_models() -> Vec<String> {
    vec![
        "claude-opus-4.6".to_string(),
        "gpt-5.4".to_string(),
        "gpt-5.3-codex".to_string(),
    ]
}

pub(super) fn default_log_level() -> String {
    "info".to_string()
}

pub(super) fn default_alert_cooldown() -> u32 {
    20
}

pub(super) fn default_alert_scope() -> String {
    "monitored".to_string()
}

pub(crate) fn default_model_prices() -> Vec<ModelPriceEntry> {
    tracepilot_orchestrator::models::default_model_pricing()
        .into_iter()
        .map(|entry| ModelPriceEntry {
            model: entry.model.to_string(),
            input_per_m: entry.input_per_m,
            cached_input_per_m: entry.cached_input_per_m,
            output_per_m: entry.output_per_m,
            premium_requests: entry.premium_requests,
        })
        .collect()
}
