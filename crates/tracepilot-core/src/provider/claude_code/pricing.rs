//! API-equivalent USD at the verified Anthropic registry rates. Not a bill.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use serde::Deserialize;

use crate::models::event_types::ModelCallData;
use crate::provider::{CostBasis, CostFigure, CostUnit};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registry {
    anthropic_usage: Vec<Rates>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rates {
    model: String,
    #[serde(default)]
    aliases: Vec<String>,
    input_per_m: f64,
    cached_input_per_m: f64,
    cache_write_per_m: f64,
    cache_write_1h_per_m: Option<f64>,
    output_per_m: f64,
}

static REGISTRY: LazyLock<Option<Registry>> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../../packages/types/src/claude-code-pricing-data.json"
    ))
    .ok()
});

fn matches_model(model: &str, canonical: &str) -> bool {
    let model = model.trim().to_ascii_lowercase();
    let model = model.strip_prefix("models/").unwrap_or(&model);
    let alias = canonical.replace('.', "-");
    [canonical, alias.as_str()].iter().any(|base| {
        model == *base
            || model.strip_prefix(&format!("{base}-")).is_some_and(|date| {
                (date.len() == 8 && date.bytes().all(|b| b.is_ascii_digit()))
                    || (date.len() == 10
                        && date.bytes().enumerate().all(|(i, b)| {
                            if i == 4 || i == 7 {
                                b == b'-'
                            } else {
                                b.is_ascii_digit()
                            }
                        }))
            })
    })
}

/// Inclusive input, disjoint read/write categories. Unknown models, missing
/// usage, or writes without a complete recorded TTL split remain unpriced.
/// Thinking is already included in Claude's output, so never charge it twice.
pub(crate) fn estimate_call(call: &ModelCallData) -> Option<f64> {
    let model = call.model.as_deref()?;
    let rates = REGISTRY.as_ref()?.anthropic_usage.iter().find(|r| {
        matches_model(model, &r.model) || r.aliases.iter().any(|alias| matches_model(model, alias))
    })?;
    let input = call.input_tokens?;
    let read = call.cache_read_tokens.unwrap_or(0);
    let write = call.cache_write_tokens.unwrap_or(0);
    let uncached = input.checked_sub(read.checked_add(write)?)?;
    let (five, hour) = if write == 0 {
        (0, 0)
    } else {
        let split = call.cache_write_by_ttl.as_ref()?;
        if split
            .iter()
            .any(|(ttl, tokens)| *tokens > 0 && ttl != "300" && ttl != "3600")
        {
            return None;
        }
        let five = split.get("300").copied().unwrap_or(0);
        let hour = split.get("3600").copied().unwrap_or(0);
        if five.checked_add(hour)? != write {
            return None;
        }
        (five, hour)
    };
    let hour_cost = if hour == 0 {
        0.0
    } else {
        hour as f64 * rates.cache_write_1h_per_m?
    };
    Some(
        (uncached as f64 * rates.input_per_m
            + read as f64 * rates.cached_input_per_m
            + five as f64 * rates.cache_write_per_m
            + hour_cost
            + call.output_tokens? as f64 * rates.output_per_m)
            / 1_000_000.0,
    )
}

pub(super) fn estimate_native(call: &super::ClaudeCallUsage) -> Option<f64> {
    if !call.input_tokens_recorded || !call.output_tokens_recorded {
        return None;
    }
    estimate_call(&ModelCallData {
        model: call.model.clone(),
        input_tokens: Some(call.inclusive_input()),
        cache_read_tokens: Some(call.cache_read_tokens),
        cache_write_tokens: Some(call.cache_write_tokens),
        cache_write_by_ttl: Some(BTreeMap::from([
            ("300".into(), call.cache_write_5m_tokens),
            ("3600".into(), call.cache_write_1h_tokens),
        ])),
        output_tokens: Some(call.output_tokens),
        ..ModelCallData::default()
    })
}

pub(crate) fn estimate(amount: f64) -> CostFigure {
    CostFigure {
        amount,
        unit: CostUnit::Usd,
        basis: CostBasis::TracepilotEstimate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_registry_and_exact_aliases() {
        assert!(REGISTRY.is_some(), "embedded pricing registry must parse");
        assert!(matches_model(
            "claude-haiku-4-5-20251001",
            "claude-haiku-4.5"
        ));
        assert!(matches_model("claude-opus-5-5", "claude-opus-5.5"));
        assert!(!matches_model("claude-opus-5-5-fast", "claude-opus-5.5"));
    }
}
