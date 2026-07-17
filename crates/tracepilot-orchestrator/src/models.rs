use std::sync::OnceLock;

use serde::Deserialize;

use crate::types::ModelInfo;

/// Canonical model metadata, deserialised once from
/// `packages/types/data/model-registry.json` — the same JSON that backs the
/// TypeScript `MODEL_REGISTRY_BASE` in `packages/types/src/models.ts`. The JSON
/// is the single source of truth for model identity, tier classification and
/// wholesale pricing across both the TS frontend and the Rust orchestrator.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    pub tier: String,
    pub input_per_m: f64,
    pub cached_input_per_m: f64,
    pub output_per_m: f64,
    pub premium_requests: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelPricing {
    pub model: String,
    pub pricing_tier: Option<String>,
    pub minimum_input_tokens: Option<u64>,
    pub input_per_m: f64,
    pub cached_input_per_m: f64,
    pub output_per_m: f64,
    pub premium_requests: f64,
}

const MODEL_REGISTRY_JSON: &str = include_str!("../../../packages/types/data/model-registry.json");

static MODEL_REGISTRY: OnceLock<Vec<Model>> = OnceLock::new();

pub fn registry() -> &'static [Model] {
    MODEL_REGISTRY
        .get_or_init(|| {
            serde_json::from_str(MODEL_REGISTRY_JSON)
                .expect("packages/types/data/model-registry.json must be valid JSON")
        })
        .as_slice()
}

pub fn available_models() -> Vec<ModelInfo> {
    registry()
        .iter()
        .map(|model| ModelInfo {
            id: model.id.clone(),
            name: model.name.clone(),
            tier: model.tier.clone(),
        })
        .collect()
}

pub fn default_model_pricing() -> Vec<ModelPricing> {
    registry()
        .iter()
        .map(|model| ModelPricing {
            model: model.id.clone(),
            pricing_tier: Some("default".to_string()),
            minimum_input_tokens: None,
            input_per_m: model.input_per_m,
            cached_input_per_m: model.cached_input_per_m,
            output_per_m: model.output_per_m,
            premium_requests: model.premium_requests,
        })
        .collect()
}

pub fn is_known_model(model: &str) -> bool {
    registry().iter().any(|candidate| candidate.id == model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn model_registry_ids_are_unique() {
        let mut ids = HashSet::new();
        for model in registry() {
            assert!(
                ids.insert(model.id.as_str()),
                "duplicate model id: {}",
                model.id
            );
        }
        assert_eq!(registry().len(), 38);
    }

    #[test]
    fn available_models_projection_matches_registry_order() {
        let projected = available_models();
        let ids: Vec<_> = projected.iter().map(|model| model.id.as_str()).collect();
        let expected_ids: Vec<_> = registry().iter().map(|model| model.id.as_str()).collect();
        assert_eq!(ids, expected_ids);
        assert_eq!(
            projected
                .iter()
                .map(|model| model.name.as_str())
                .collect::<Vec<_>>(),
            registry()
                .iter()
                .map(|model| model.name.as_str())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn default_model_pricing_covers_every_model() {
        let pricing = default_model_pricing();
        let price_ids: Vec<_> = pricing.iter().map(|entry| entry.model.as_str()).collect();
        let expected_ids: Vec<_> = registry().iter().map(|model| model.id.as_str()).collect();
        assert_eq!(price_ids, expected_ids);

        for entry in pricing {
            assert!(entry.input_per_m >= 0.0);
            assert!(entry.cached_input_per_m >= 0.0);
            assert!(entry.output_per_m >= 0.0);
            assert!(entry.premium_requests >= 0.0);
            assert!(entry.cached_input_per_m <= entry.input_per_m);
        }
    }

    #[test]
    fn known_model_lookup_matches_registry() {
        for model in registry() {
            assert!(is_known_model(&model.id));
        }
        assert!(!is_known_model("unknown-model"));
    }

    #[test]
    fn claude_opus_4_7_premium_requests_matches_ts() {
        // Single-source guarantee: the JSON-backed value matches what the TS
        // frontend resolves to at runtime (15× — the GitHub Copilot current
        // premium-request multiplier for Claude Opus 4.7).
        let opus = registry()
            .iter()
            .find(|m| m.id == "claude-opus-4.7")
            .expect("claude-opus-4.7 present in registry");
        assert_eq!(opus.premium_requests, 15.0);
    }
}
