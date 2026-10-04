//! Lenient decoding for Copilot `totalNanoAiu` values.
//!
//! The session-events schema types `totalNanoAiu` as a JSON `number`, not an
//! integer. Copilot CLI 1.0.86+ can persist floating-point sums such as
//! `528375599.99999994`, which a plain `u64` field rejects, discarding the
//! whole event. Values are nano AI units, so rounding to the nearest unit
//! loses nothing meaningful. Numeric strings are accepted too, matching the
//! decimal encodings the per-agent ledger already tolerates.

use serde::{Deserialize, Deserializer, de::Error};
use serde_json::Value;

fn to_nano_aiu(value: &Value) -> Option<u64> {
    if let Some(n) = value.as_u64() {
        return Some(n);
    }
    let n = match value {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    // `as` saturates at u64::MAX; anything beyond that is not a real total.
    (n.is_finite() && n >= 0.0 && n < u64::MAX as f64).then(|| n.round() as u64)
}

fn invalid<E: Error>(value: &Value) -> E {
    E::custom(format!(
        "invalid nano AI unit value {value}, expected a non-negative number"
    ))
}

/// For `Option<u64>` fields; pair with `#[serde(default)]`.
pub(crate) fn optional<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u64>, D::Error> {
    match Option::<Value>::deserialize(deserializer)? {
        None | Some(Value::Null) => Ok(None),
        Some(value) => to_nano_aiu(&value).map(Some).ok_or_else(|| invalid(&value)),
    }
}

/// For required `u64` fields.
pub(crate) fn required<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    let value = Value::deserialize(deserializer)?;
    to_nano_aiu(&value).ok_or_else(|| invalid(&value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Deserialize)]
    struct Holder {
        #[serde(default, deserialize_with = "optional")]
        total: Option<u64>,
    }

    fn total(value: Value) -> Result<Option<u64>, serde_json::Error> {
        serde_json::from_value::<Holder>(value).map(|h| h.total)
    }

    #[test]
    fn accepts_integers_floats_and_numeric_strings() {
        assert_eq!(total(json!({"total": 42})).unwrap(), Some(42));
        // Observed in a Copilot CLI 1.0.86 session.shutdown modelMetrics entry.
        assert_eq!(
            total(serde_json::from_str(r#"{"total":528375599.99999994}"#).unwrap()).unwrap(),
            Some(528_375_600)
        );
        assert_eq!(total(json!({"total": "1250000"})).unwrap(), Some(1_250_000));
        assert_eq!(total(json!({"total": null})).unwrap(), None);
        assert_eq!(total(json!({})).unwrap(), None);
    }

    #[test]
    fn rejects_values_that_are_not_usage_totals() {
        assert!(total(json!({"total": -1.5})).is_err());
        assert!(total(json!({"total": "abc"})).is_err());
        assert!(total(json!({"total": true})).is_err());
        assert!(total(json!({"total": 1e30})).is_err());
    }
}
