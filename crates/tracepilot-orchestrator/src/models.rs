use crate::types::ModelInfo;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelMetadata {
    pub id: &'static str,
    pub name: &'static str,
    pub tier: &'static str,
    pub input_per_m: f64,
    pub cached_input_per_m: f64,
    pub output_per_m: f64,
    pub premium_requests: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelPricing {
    pub model: &'static str,
    pub input_per_m: f64,
    pub cached_input_per_m: f64,
    pub output_per_m: f64,
    pub premium_requests: f64,
}

pub const MODEL_REGISTRY: &[ModelMetadata] = &[
    ModelMetadata {
        id: "claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        tier: "standard",
        input_per_m: 3.0,
        cached_input_per_m: 0.3,
        output_per_m: 15.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
        tier: "standard",
        input_per_m: 3.0,
        cached_input_per_m: 0.3,
        output_per_m: 15.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "claude-haiku-4.5",
        name: "Claude Haiku 4.5",
        tier: "fast",
        input_per_m: 1.0,
        cached_input_per_m: 0.1,
        output_per_m: 5.0,
        premium_requests: 0.33,
    },
    ModelMetadata {
        id: "claude-opus-4.7",
        name: "Claude Opus 4.7",
        tier: "premium",
        input_per_m: 5.0,
        cached_input_per_m: 0.5,
        output_per_m: 25.0,
        premium_requests: 15.0,
    },
    ModelMetadata {
        id: "gpt-5.5",
        name: "GPT-5.5",
        tier: "premium",
        input_per_m: 5.0,
        cached_input_per_m: 0.5,
        output_per_m: 30.0,
        premium_requests: 7.5,
    },
    ModelMetadata {
        id: "goldeneye",
        name: "Goldeneye",
        tier: "premium",
        input_per_m: 1.25,
        cached_input_per_m: 0.125,
        output_per_m: 10.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "claude-opus-4.6",
        name: "Claude Opus 4.6",
        tier: "premium",
        input_per_m: 5.0,
        cached_input_per_m: 0.5,
        output_per_m: 25.0,
        premium_requests: 3.0,
    },
    ModelMetadata {
        id: "claude-opus-4.6-fast",
        name: "Claude Opus 4.6 Fast",
        tier: "premium",
        input_per_m: 30.0,
        cached_input_per_m: 3.0,
        output_per_m: 150.0,
        premium_requests: 30.0,
    },
    ModelMetadata {
        id: "claude-opus-4.5",
        name: "Claude Opus 4.5",
        tier: "premium",
        input_per_m: 5.0,
        cached_input_per_m: 0.5,
        output_per_m: 25.0,
        premium_requests: 3.0,
    },
    ModelMetadata {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        tier: "standard",
        input_per_m: 3.0,
        cached_input_per_m: 0.3,
        output_per_m: 15.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        tier: "standard",
        input_per_m: 3.0,
        cached_input_per_m: 0.3,
        output_per_m: 16.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        tier: "standard",
        input_per_m: 1.25,
        cached_input_per_m: 0.125,
        output_per_m: 10.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        tier: "standard",
        input_per_m: 2.0,
        cached_input_per_m: 0.2,
        output_per_m: 12.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gpt-5.4",
        name: "GPT-5.4",
        tier: "standard",
        input_per_m: 2.5,
        cached_input_per_m: 0.25,
        output_per_m: 15.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        tier: "standard",
        input_per_m: 1.75,
        cached_input_per_m: 0.175,
        output_per_m: 14.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        tier: "standard",
        input_per_m: 1.75,
        cached_input_per_m: 0.175,
        output_per_m: 14.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gpt-5.2",
        name: "GPT-5.2",
        tier: "standard",
        input_per_m: 2.5,
        cached_input_per_m: 0.25,
        output_per_m: 15.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gpt-5.1-codex-max",
        name: "GPT-5.1 Codex Max",
        tier: "standard",
        input_per_m: 1.75,
        cached_input_per_m: 0.175,
        output_per_m: 14.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gpt-5.1-codex",
        name: "GPT-5.1 Codex",
        tier: "standard",
        input_per_m: 1.75,
        cached_input_per_m: 0.175,
        output_per_m: 14.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gpt-5.1",
        name: "GPT-5.1",
        tier: "standard",
        input_per_m: 10.0,
        cached_input_per_m: 1.0,
        output_per_m: 40.0,
        premium_requests: 1.0,
    },
    ModelMetadata {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        tier: "fast",
        input_per_m: 0.4,
        cached_input_per_m: 0.04,
        output_per_m: 1.6,
        premium_requests: 0.33,
    },
    ModelMetadata {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano",
        tier: "fast",
        input_per_m: 0.2,
        cached_input_per_m: 0.02,
        output_per_m: 1.25,
        premium_requests: 0.33,
    },
    ModelMetadata {
        id: "gemini-3-flash",
        name: "Gemini 3 Flash",
        tier: "fast",
        input_per_m: 0.5,
        cached_input_per_m: 0.05,
        output_per_m: 3.0,
        premium_requests: 0.33,
    },
    ModelMetadata {
        id: "grok-code-fast-1",
        name: "Grok Code Fast 1",
        tier: "fast",
        input_per_m: 0.2,
        cached_input_per_m: 0.02,
        output_per_m: 1.5,
        premium_requests: 0.25,
    },
    ModelMetadata {
        id: "raptor-mini",
        name: "Raptor Mini",
        tier: "fast",
        input_per_m: 0.25,
        cached_input_per_m: 0.025,
        output_per_m: 2.0,
        premium_requests: 0.0,
    },
    ModelMetadata {
        id: "gpt-5.1-codex-mini",
        name: "GPT-5.1 Codex Mini",
        tier: "fast",
        input_per_m: 0.4,
        cached_input_per_m: 0.04,
        output_per_m: 1.6,
        premium_requests: 0.33,
    },
    ModelMetadata {
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        tier: "fast",
        input_per_m: 0.4,
        cached_input_per_m: 0.04,
        output_per_m: 1.6,
        premium_requests: 0.0,
    },
    ModelMetadata {
        id: "gpt-4.1",
        name: "GPT-4.1",
        tier: "fast",
        input_per_m: 8.0,
        cached_input_per_m: 0.8,
        output_per_m: 24.0,
        premium_requests: 0.0,
    },
];

pub fn available_models() -> Vec<ModelInfo> {
    MODEL_REGISTRY
        .iter()
        .map(|model| ModelInfo {
            id: model.id.to_string(),
            name: model.name.to_string(),
            tier: model.tier.to_string(),
        })
        .collect()
}

pub fn default_model_pricing() -> Vec<ModelPricing> {
    MODEL_REGISTRY
        .iter()
        .map(|model| ModelPricing {
            model: model.id,
            input_per_m: model.input_per_m,
            cached_input_per_m: model.cached_input_per_m,
            output_per_m: model.output_per_m,
            premium_requests: model.premium_requests,
        })
        .collect()
}

pub fn is_known_model(model: &str) -> bool {
    MODEL_REGISTRY.iter().any(|candidate| candidate.id == model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn model_registry_ids_are_unique() {
        let mut ids = HashSet::new();
        for model in MODEL_REGISTRY {
            assert!(ids.insert(model.id), "duplicate model id: {}", model.id);
        }
        assert_eq!(MODEL_REGISTRY.len(), 28);
    }

    #[test]
    fn available_models_projection_matches_registry_order() {
        let projected = available_models();
        let ids: Vec<_> = projected.iter().map(|model| model.id.as_str()).collect();
        let expected_ids: Vec<_> = MODEL_REGISTRY.iter().map(|model| model.id).collect();
        assert_eq!(ids, expected_ids);
        assert_eq!(
            projected
                .iter()
                .map(|model| model.name.as_str())
                .collect::<Vec<_>>(),
            MODEL_REGISTRY
                .iter()
                .map(|model| model.name)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn default_model_pricing_covers_every_model() {
        let pricing = default_model_pricing();
        let price_ids: Vec<_> = pricing.iter().map(|entry| entry.model).collect();
        let expected_ids: Vec<_> = MODEL_REGISTRY.iter().map(|model| model.id).collect();
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
        for model in MODEL_REGISTRY {
            assert!(is_known_model(model.id));
        }
        assert!(!is_known_model("unknown-model"));
    }
}
