//! Pricing / cost configuration.

use serde::{Deserialize, Serialize};

use super::defaults::{default_cost_per_premium_request, default_model_prices};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingConfig {
    #[serde(default = "default_cost_per_premium_request")]
    pub cost_per_premium_request: f64,
    #[serde(default = "default_model_prices")]
    pub models: Vec<ModelPriceEntry>,
    #[serde(default)]
    pub removed_models: Vec<String>,
}

impl Default for PricingConfig {
    fn default() -> Self {
        Self {
            cost_per_premium_request: 0.04,
            models: default_model_prices(),
            removed_models: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPriceEntry {
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_tier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    pub input_per_m: f64,
    pub cached_input_per_m: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_per_m: Option<f64>,
    pub output_per_m: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_per_m: Option<f64>,
    pub premium_requests: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}
