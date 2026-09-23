//! Reproducing a recorded charge from the entries that composed it.
//!
//! The source records both a request total in nano AI units and an array of
//! billing entries. On every locally inspected request the entries reproduce
//! the total exactly, which is what makes a "how this charge was composed"
//! drawer honest rather than a re-priced estimate.
//!
//! Two rules matter more than the arithmetic. The **recorded total is the
//! charge** — the item sum only explains and cross-checks it, and must never
//! replace it or be multiplied by the request multiplier a second time. And
//! the entries stay an array: repeated categories at different rates, and
//! per-entry model attribution, are the historical rate evidence, so
//! collapsing them into a map keyed by category would destroy the point.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::decimal::{ExactDecimal, Rational};
use super::model::{BillingItem, BillingItemsStatus};

/// Most entries one request's billing array may contain. The observed arrays
/// hold four; this leaves room for richer layouts while staying bounded.
pub const MAX_BILLING_ITEMS: usize = 64;

/// Whether the itemised entries reproduce the recorded total.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BillingCheck {
    /// Item sum equals the recorded total exactly.
    Exact,
    /// Both are present and differ. The recorded total still wins.
    Differs {
        /// Item sum, as a decimal string when it is one.
        item_total: Option<String>,
        recorded_total: String,
    },
    /// The request has no items, or no recorded total, to compare.
    NotComparable,
    /// An entry could not be turned into a charge: zero batch size, a missing
    /// count, or an overflow.
    Incomputable { reason: String },
}

impl BillingCheck {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::Differs { .. } => "differs",
            Self::NotComparable => "notComparable",
            Self::Incomputable { .. } => "incomputable",
        }
    }
}

/// Sum the entries, as an exact fraction.
///
/// `None` means at least one entry could not be computed; a partial sum would
/// look like a complete one and is therefore never returned.
pub fn item_total(items: &[BillingItem]) -> Option<Rational> {
    let mut total = Rational::ZERO;
    for item in items {
        total = total.checked_add(item.charge()?)?;
    }
    Some(total)
}

/// Compare the itemised sum against the recorded total.
pub fn check(items: &[BillingItem], recorded_total: Option<ExactDecimal>) -> BillingCheck {
    let Some(recorded) = recorded_total else {
        return BillingCheck::NotComparable;
    };
    if items.is_empty() {
        return BillingCheck::NotComparable;
    }
    let Some(sum) = item_total(items) else {
        return BillingCheck::Incomputable {
            reason: "an entry has no usable token count, batch size or rate".to_string(),
        };
    };
    let Some(recorded_rational) = recorded.to_rational() else {
        return BillingCheck::Incomputable {
            reason: "the recorded total is outside the exact arithmetic range".to_string(),
        };
    };
    if sum == recorded_rational {
        return BillingCheck::Exact;
    }
    BillingCheck::Differs {
        item_total: decimal_string(sum),
        recorded_total: recorded.to_string(),
    }
}

/// An exact decimal rendering of a fraction, or `None` when it has no finite
/// decimal form. Callers show the recorded total in that case rather than a
/// silently rounded reconstruction.
pub fn decimal_string(value: Rational) -> Option<String> {
    value.to_exact_decimal().map(|decimal| decimal.to_string())
}

/// Parse `token_details_json`.
///
/// The value is an array. An object, a string, or anything else is
/// [`BillingItemsStatus::Invalid`] rather than coerced, because a guess here
/// would produce a confident, wrong explanation of a real charge.
pub fn parse_items(raw: Option<&str>) -> (Vec<BillingItem>, BillingItemsStatus) {
    let Some(raw) = raw else {
        return (Vec::new(), BillingItemsStatus::Absent);
    };
    let Ok(Value::Array(entries)) = serde_json::from_str::<Value>(raw) else {
        return (Vec::new(), BillingItemsStatus::Invalid);
    };
    if entries.is_empty() {
        return (Vec::new(), BillingItemsStatus::Absent);
    }
    let truncated = entries.len() > MAX_BILLING_ITEMS;
    let mut items = Vec::new();
    let mut rejected = 0usize;
    for (ordinal, entry) in entries.iter().take(MAX_BILLING_ITEMS).enumerate() {
        match parse_item(ordinal, entry) {
            Some(item) => items.push(item),
            None => rejected += 1,
        }
    }
    let status = if items.is_empty() {
        BillingItemsStatus::Invalid
    } else if rejected > 0 || truncated {
        BillingItemsStatus::Partial
    } else {
        BillingItemsStatus::Complete
    };
    (items, status)
}

fn parse_item(ordinal: usize, entry: &Value) -> Option<BillingItem> {
    let object = entry.as_object()?;
    // An entry without a category cannot be explained to a reader, so it is
    // the one genuinely required field.
    let token_type = object.get("tokenType")?.as_str()?.trim();
    if token_type.is_empty() || token_type.len() > 64 {
        return None;
    }
    Some(BillingItem {
        ordinal: u32::try_from(ordinal).ok()?,
        token_type: token_type.to_string(),
        token_count: object
            .get("tokenCount")
            .and_then(json_count)
            .filter(|value| i64::try_from(*value).is_ok()),
        batch_size: object
            .get("batchSize")
            .and_then(json_count)
            .filter(|value| i64::try_from(*value).is_ok()),
        cost_per_batch: object.get("costPerBatch").and_then(json_decimal),
        model: object
            .get("model")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|model| !model.is_empty() && model.len() <= 128)
            .map(str::to_string),
    })
}

fn json_count(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => {
            if let Some(unsigned) = number.as_u64() {
                return Some(unsigned);
            }
            let float = number.as_f64()?;
            (float.is_finite() && float >= 0.0 && float.fract() == 0.0 && float <= 9.007e15)
                .then_some(float as u64)
        }
        Value::String(text) => text.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn json_decimal(value: &Value) -> Option<ExactDecimal> {
    match value {
        // Round-trip through the JSON number's own text so a rate such as
        // 0.0000012 keeps its decimal form instead of acquiring a binary tail.
        Value::Number(number) => ExactDecimal::parse(&number.to_string()),
        Value::String(text) => ExactDecimal::parse(text),
        _ => None,
    }
}

/// Total tokens recorded for one category across a request's entries.
///
/// Used to surface the disagreement seen locally, where a compaction request
/// reports a flat `cache_write_tokens` of 0 while its billing entries contain
/// 10,364 cache-write tokens. Both figures survive; neither is rewritten.
pub fn tokens_for_category(items: &[BillingItem], category: &str) -> Option<u64> {
    let mut total: Option<u64> = None;
    for item in items.iter().filter(|item| item.token_type == category) {
        let count = item.token_count?;
        total = Some(total.unwrap_or(0).checked_add(count)?);
    }
    total
}
