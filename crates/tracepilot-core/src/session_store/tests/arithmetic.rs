//! Exact arithmetic and billing reconstruction.

use crate::session_store::billing::{self, BillingCheck};
use crate::session_store::decimal::{ExactDecimal, Rational};
use crate::session_store::{BillingItemsStatus, ExactDecimal as PublicDecimal};

#[test]
fn decimal_parses_and_renders_plain_notation() {
    let value = ExactDecimal::parse("4061590000").unwrap();
    assert_eq!(value.to_string(), "4061590000");
    assert_eq!(
        ExactDecimal::parse("0.0000012").unwrap().to_string(),
        "0.0000012"
    );
    assert_eq!(ExactDecimal::parse("-1.500").unwrap().to_string(), "-1.5");
    assert_eq!(ExactDecimal::parse(".5").unwrap().to_string(), "0.5");
}

#[test]
fn decimal_rejects_exponent_and_junk() {
    // Exponent notation would be a value shape we have never seen from this
    // source; accepting it would hide the surprise.
    assert!(ExactDecimal::parse("1e9").is_none());
    assert!(ExactDecimal::parse("").is_none());
    assert!(ExactDecimal::parse("abc").is_none());
    assert!(ExactDecimal::from_f64(f64::NAN).is_none());
    assert!(ExactDecimal::from_f64(f64::INFINITY).is_none());
}

#[test]
fn nano_units_convert_to_credits_without_binary_drift() {
    let nano = ExactDecimal::parse("4061590000").unwrap();
    assert_eq!(nano.checked_div_pow10(9).unwrap().to_string(), "4.06159");
}

#[test]
fn large_nano_totals_survive_addition() {
    // Well past f64's exact-integer range, which is the point of i128 here.
    let left = ExactDecimal::parse("9007199254740993").unwrap();
    let right = ExactDecimal::parse("1").unwrap();
    assert_eq!(
        left.checked_add(right).unwrap().to_string(),
        "9007199254740994"
    );
}

#[test]
fn rational_cross_reduces_before_multiplying() {
    // Without cross-reduction this product overflows i128.
    let huge = Rational::new(i128::MAX / 2, 3).unwrap();
    let small = Rational::new(3, i128::MAX / 2).unwrap();
    assert_eq!(huge.checked_mul(small).unwrap(), Rational::from_i128(1));
}

#[test]
fn rational_reports_non_terminating_decimals_instead_of_rounding_silently() {
    let third = Rational::new(1, 3).unwrap();
    assert!(third.to_exact_decimal().is_none());
    assert_eq!(third.to_decimal_rounded(6).unwrap().to_string(), "0.333333");
}

fn items_json() -> &'static str {
    r#"[
        {"tokenType":"input","tokenCount":75,"batchSize":1000000,"costPerBatch":1250000},
        {"tokenType":"cache read","tokenCount":148059,"batchSize":1000000,"costPerBatch":125000},
        {"tokenType":"cache write","tokenCount":10364,"batchSize":1000000,"costPerBatch":1562500},
        {"tokenType":"output","tokenCount":2130,"batchSize":1000000,"costPerBatch":10000000}
    ]"#
}

#[test]
fn numeric_billing_rates_keep_all_source_decimal_digits() {
    let (items, _) = billing::parse_items(Some(
        r#"[{"tokenType":"input","tokenCount":1,"batchSize":1,"costPerBatch":0.123456789012345678}]"#,
    ));
    assert_eq!(
        items[0].cost_per_batch.unwrap().to_string(),
        "0.123456789012345678"
    );
    assert_eq!(
        billing::item_total(&items)
            .and_then(billing::decimal_string)
            .as_deref(),
        Some("0.123456789012345678")
    );
}

#[test]
fn oversized_billing_counts_are_unusable_instead_of_clamped() {
    let (items, _) = billing::parse_items(Some(
        r#"[{"tokenType":"input","tokenCount":18446744073709551615,"batchSize":1,"costPerBatch":1}]"#,
    ));
    assert_eq!(items[0].token_count, None);
    assert!(billing::item_total(&items).is_none());
}

#[test]
fn billing_items_reproduce_a_recorded_charge_exactly() {
    let (items, status) = billing::parse_items(Some(items_json()));
    assert_eq!(status, BillingItemsStatus::Complete);
    assert_eq!(items.len(), 4);

    let total = billing::item_total(&items).unwrap();
    let recorded = PublicDecimal::parse(&billing::decimal_string(total).unwrap()).unwrap();
    assert_eq!(billing::check(&items, Some(recorded)), BillingCheck::Exact);
}

#[test]
fn billing_preserves_repeated_categories_and_per_entry_models() {
    let (items, status) = billing::parse_items(Some(
        r#"[
            {"tokenType":"input","tokenCount":10,"batchSize":100,"costPerBatch":5,"model":"a"},
            {"tokenType":"input","tokenCount":10,"batchSize":100,"costPerBatch":9,"model":"b"}
        ]"#,
    ));
    assert_eq!(status, BillingItemsStatus::Complete);
    // A map keyed by category would have collapsed these two rates into one.
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].billing_model(None), Some("a"));
    assert_eq!(items[1].billing_model(None), Some("b"));
    // The request-level default only fills in for entries without their own.
    assert_eq!(items[0].billing_model(Some("fallback")), Some("a"));
    assert_eq!(billing::tokens_for_category(&items, "input"), Some(20));
}

#[test]
fn zero_batch_size_is_incomputable_rather_than_a_division_by_zero() {
    let (items, _) = billing::parse_items(Some(
        r#"[{"tokenType":"input","tokenCount":10,"batchSize":0,"costPerBatch":5}]"#,
    ));
    assert!(items[0].charge().is_none());
    let recorded = PublicDecimal::from_i64(50);
    assert!(matches!(
        billing::check(&items, Some(recorded)),
        BillingCheck::Incomputable { .. }
    ));
}

#[test]
fn a_billing_object_is_invalid_not_coerced_into_entries() {
    let (items, status) = billing::parse_items(Some(r#"{"input":{"tokenCount":10}}"#));
    assert!(items.is_empty());
    assert_eq!(status, BillingItemsStatus::Invalid);

    let (items, status) = billing::parse_items(Some("not json"));
    assert!(items.is_empty());
    assert_eq!(status, BillingItemsStatus::Invalid);

    let (items, status) = billing::parse_items(None);
    assert!(items.is_empty());
    assert_eq!(status, BillingItemsStatus::Absent);
}

#[test]
fn a_single_unusable_entry_makes_the_array_partial() {
    let (items, status) = billing::parse_items(Some(
        r#"[{"tokenType":"input","tokenCount":10,"batchSize":100,"costPerBatch":5},{"nope":1}]"#,
    ));
    assert_eq!(items.len(), 1);
    assert_eq!(status, BillingItemsStatus::Partial);
}

#[test]
fn a_disagreeing_item_sum_keeps_the_recorded_total() {
    let (items, _) = billing::parse_items(Some(
        r#"[{"tokenType":"input","tokenCount":10,"batchSize":1,"costPerBatch":5}]"#,
    ));
    let recorded = PublicDecimal::from_i64(999);
    match billing::check(&items, Some(recorded)) {
        BillingCheck::Differs {
            item_total,
            recorded_total,
        } => {
            assert_eq!(item_total.as_deref(), Some("50"));
            assert_eq!(recorded_total, "999");
        }
        other => panic!("expected a difference, got {other:?}"),
    }
}

#[test]
fn fractional_rates_do_not_pick_up_a_binary_tail() {
    let (items, _) = billing::parse_items(Some(
        r#"[{"tokenType":"input","tokenCount":3,"batchSize":1,"costPerBatch":0.1}]"#,
    ));
    let total = billing::item_total(&items).unwrap();
    // 3 * 0.1 is 0.30000000000000004 in binary floating point.
    assert_eq!(billing::decimal_string(total).as_deref(), Some("0.3"));
}
