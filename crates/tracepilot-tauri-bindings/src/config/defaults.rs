//! Serde `default = "..."` helper functions shared across sub-configs.

use super::ModelPriceEntry;
use serde::Deserialize;
use std::collections::HashMap;

const PRICING_DATA_JSON: &str = include_str!("../../../../packages/types/src/pricing-data.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PricingDataFile {
    sources: PricingDataSources,
    aliases: HashMap<String, Vec<String>>,
    github_copilot_usage: Vec<UsagePricingData>,
    annual_legacy_multipliers: Vec<LegacyMultiplierData>,
    current_premium_request_defaults: Vec<CurrentPremiumRequestData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PricingDataSources {
    github_copilot_usage: PricingSourceData,
    trace_pilot_legacy_provider_estimate: PricingSourceData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PricingSourceData {
    label: String,
    url: Option<String>,
    verified_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsagePricingData {
    model: String,
    input_per_m: f64,
    cached_input_per_m: f64,
    cache_write_per_m: Option<f64>,
    output_per_m: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMultiplierData {
    model: String,
    current_premium_requests: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrentPremiumRequestData {
    model: String,
    current_premium_requests: f64,
}

fn pricing_source_label(source: &PricingSourceData) -> String {
    format!("{} (verified {})", source.label, source.verified_at)
}

fn pricing_data() -> PricingDataFile {
    serde_json::from_str(PRICING_DATA_JSON).expect("embedded pricing-data.json should parse")
}

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
    let pricing_data = pricing_data();
    let official_rates: HashMap<&str, &UsagePricingData> = pricing_data
        .github_copilot_usage
        .iter()
        .map(|entry| (entry.model.as_str(), entry))
        .collect();
    let current_multipliers: HashMap<&str, f64> = pricing_data
        .annual_legacy_multipliers
        .iter()
        .filter_map(|entry| {
            entry
                .current_premium_requests
                .map(|premium_requests| (entry.model.as_str(), premium_requests))
        })
        .chain(
            pricing_data
                .current_premium_request_defaults
                .iter()
                .map(|entry| (entry.model.as_str(), entry.current_premium_requests)),
        )
        .collect();
    let github_source = &pricing_data.sources.github_copilot_usage;
    let legacy_source = &pricing_data.sources.trace_pilot_legacy_provider_estimate;

    tracepilot_orchestrator::models::default_model_pricing()
        .into_iter()
        .map(|entry| {
            let official = official_rates.get(entry.model);
            let source_label = if official.is_some() {
                format!(
                    "{}; local default mirrors GitHub's published token rates",
                    pricing_source_label(github_source)
                )
            } else {
                format!(
                    "{}; model not listed on GitHub pricing page",
                    pricing_source_label(legacy_source)
                )
            };

            ModelPriceEntry {
                model: entry.model.to_string(),
                aliases: pricing_data
                    .aliases
                    .get(entry.model)
                    .cloned()
                    .unwrap_or_default(),
                input_per_m: official.map_or(entry.input_per_m, |rates| rates.input_per_m),
                cached_input_per_m: official
                    .map_or(entry.cached_input_per_m, |rates| rates.cached_input_per_m),
                cache_write_per_m: official.and_then(|rates| rates.cache_write_per_m),
                output_per_m: official.map_or(entry.output_per_m, |rates| rates.output_per_m),
                reasoning_per_m: None,
                premium_requests: current_multipliers
                    .get(entry.model)
                    .copied()
                    .unwrap_or(entry.premium_requests),
                source: Some("provider-wholesale".to_string()),
                pricing_kind: None,
                effective_from: None,
                effective_to: None,
                source_label: Some(source_label),
                source_url: official.and_then(|_| github_source.url.clone()),
                status: Some(
                    if official.is_some() {
                        "official"
                    } else {
                        "estimated"
                    }
                    .to_string(),
                ),
            }
        })
        .collect()
}
