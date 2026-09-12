//! Synthetic payloads derived from official CLI schemas, including optional fields.
//! These are parser contracts, not reconstructed conversations or private sessions.

#[path = "schema_compatibility/payload.rs"]
mod payload;

use serde_json::Value;
use std::path::PathBuf;
use tracepilot_core::parsing::events::parse_typed_events;

fn assert_preserved(expected: &Value, actual: &Value, path: &str) {
    match expected {
        Value::Object(fields) => {
            for (key, value) in fields {
                assert_preserved(value, &actual[key], &format!("{path}.{key}"));
            }
        }
        Value::Array(items) => {
            assert_eq!(actual.as_array().map(Vec::len), Some(items.len()), "{path}");
            for (index, value) in items.iter().enumerate() {
                assert_preserved(value, &actual[index], &format!("{path}[{index}]"));
            }
        }
        Value::Number(_) => assert_eq!(expected.as_f64(), actual.as_f64(), "{path}"),
        _ => assert_eq!(expected, actual, "{path}"),
    }
}

#[test]
fn official_persisted_payloads_preserve_fields_across_supported_versions() {
    for version in ["1_0_71", "1_0_75", "1_0_83"] {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/versions")
            .join(format!("schema_v{version}.jsonl"));
        let parsed = parse_typed_events(&path).unwrap();
        assert_eq!(parsed.diagnostics.malformed_lines, 0, "{version}");
        assert!(
            parsed.diagnostics.unknown_event_types.is_empty(),
            "{version}: {:?}",
            parsed.diagnostics.unknown_event_types
        );
        assert!(
            parsed.diagnostics.deserialization_failures.is_empty(),
            "{version}: {:?}",
            parsed.diagnostics.deserialization_failures
        );
        for event in &parsed.events {
            assert_preserved(
                &event.raw.data,
                &payload::payload(&event.typed_data),
                &format!("{version}: {}", event.event_type),
            );
        }
    }
}
