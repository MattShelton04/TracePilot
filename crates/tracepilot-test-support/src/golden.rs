//! Golden-file assertions for JSON snapshots.
//!
//! Snapshots are pretty-printed JSON with object keys sorted, so `HashMap`
//! iteration order never shows up as a diff. Set `TRACEPILOT_UPDATE_GOLDEN=1`
//! to rewrite the files after an intentional change, and review the diff.

// Golden assertions are test-only and must fail loudly.
#![allow(clippy::expect_used, clippy::panic)]

use std::path::Path;

use serde_json::{Map, Value};

/// Rebuild `value` with every object's keys sorted.
pub fn canonical(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            let mut sorted = Map::new();
            for (key, value) in entries {
                sorted.insert(key, canonical(value));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(canonical).collect()),
        other => other,
    }
}

/// Compare `actual` with the golden file at `path`, or rewrite it when
/// `TRACEPILOT_UPDATE_GOLDEN=1`.
///
/// On a mismatch the actual snapshot is written beside the golden file with
/// an `.actual.json` suffix so it can be diffed.
pub fn assert_golden(path: &Path, actual: Value) {
    let rendered = format!(
        "{}\n",
        serde_json::to_string_pretty(&canonical(actual)).expect("serialize golden snapshot")
    );
    if std::env::var_os("TRACEPILOT_UPDATE_GOLDEN").is_some_and(|v| v == "1") {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create golden dir");
        }
        std::fs::write(path, rendered).expect("write golden file");
        return;
    }
    let expected = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("missing golden file {}: {e}", path.display()))
        .replace("\r\n", "\n");
    if expected != rendered {
        let actual_path = path.with_extension("actual.json");
        std::fs::write(&actual_path, &rendered).expect("write actual snapshot");
        panic!(
            "golden mismatch: {} (actual written to {})",
            path.display(),
            actual_path.display()
        );
    }
}
