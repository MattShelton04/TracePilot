// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Copilot export regression gate.
//!
//! Exports every session of the synthetic corpus in
//! `tracepilot_test_support::copilot_corpus` to JSON and Markdown and compares
//! the bytes with checked-in golden files. Copilot output must stay
//! byte-identical when other sources gain export support.
//!
//! Normalized volatile values (nothing else is touched):
//! - the export time, the exporting version and the OS in the header;
//! - `contentHash`, which hashes the sessions array (its bytes are compared
//!   anyway);
//! - the order of entries that come from a `HashSet` or `HashMap`
//!   (pre-existing nondeterminism): `includedSections`, `tokenDetails`,
//!   `modelMetrics`, `agents` and custom table rows in JSON, and count ties
//!   in the Markdown events summary.
//!
//! JSON is re-printed by serde's own pretty printer with every other key in
//! its original order, so the comparison stays byte-for-byte.
//!
//! Regenerate after an intentional change with `TRACEPILOT_UPDATE_GOLDEN=1`.

use std::fmt;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{Serialize, SerializeMap, Serializer};
use tracepilot_export::options::{ExportFormat, ExportOptions, RedactionOptions};
use tracepilot_export::{ExportFile, export_session, export_sessions_batch};
use tracepilot_test_support::copilot_corpus::write_copilot_corpus;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/copilot_export")
}

/// JSON with object keys in document order.
enum Ordered {
    Object(Vec<(String, Ordered)>),
    Array(Vec<Ordered>),
    Leaf(serde_json::Value),
}

/// Keys whose objects are serialized from a `HashMap` or `HashSet`.
const UNORDERED_KEYS: &[&str] = &["includedSections", "tokenDetails", "modelMetrics", "agents"];

impl Ordered {
    /// Sort the entries that serialize in hash order.
    fn sort_unordered(&mut self, key: Option<&str>) {
        let unordered = key.is_some_and(|key| UNORDERED_KEYS.contains(&key));
        match self {
            Ordered::Object(entries) => {
                if unordered {
                    entries.sort_by(|a, b| a.0.cmp(&b.0));
                }
                for (key, value) in entries.iter_mut() {
                    value.sort_unordered(Some(key));
                }
            }
            Ordered::Array(items) => {
                for item in items.iter_mut() {
                    if key == Some("rows")
                        && let Ordered::Object(entries) = item
                    {
                        entries.sort_by(|a, b| a.0.cmp(&b.0));
                    }
                    item.sort_unordered(None);
                }
                if unordered {
                    items.sort_by_key(|item| serde_json::to_string(item).unwrap());
                }
            }
            Ordered::Leaf(_) => {}
        }
    }
}

impl Serialize for Ordered {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Ordered::Object(entries) => {
                let mut map = serializer.serialize_map(Some(entries.len()))?;
                for (key, value) in entries {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
            Ordered::Array(items) => items.serialize(serializer),
            Ordered::Leaf(value) => value.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for Ordered {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct OrderedVisitor;

        impl<'de> Visitor<'de> for OrderedVisitor {
            type Value = Ordered;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("JSON")
            }
            fn visit_bool<E>(self, v: bool) -> Result<Ordered, E> {
                Ok(Ordered::Leaf(v.into()))
            }
            fn visit_i64<E>(self, v: i64) -> Result<Ordered, E> {
                Ok(Ordered::Leaf(v.into()))
            }
            fn visit_u64<E>(self, v: u64) -> Result<Ordered, E> {
                Ok(Ordered::Leaf(v.into()))
            }
            fn visit_f64<E>(self, v: f64) -> Result<Ordered, E> {
                Ok(Ordered::Leaf(v.into()))
            }
            fn visit_str<E>(self, v: &str) -> Result<Ordered, E> {
                Ok(Ordered::Leaf(v.into()))
            }
            fn visit_unit<E>(self) -> Result<Ordered, E> {
                Ok(Ordered::Leaf(serde_json::Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Ordered, A::Error> {
                let mut items = Vec::new();
                while let Some(item) = seq.next_element()? {
                    items.push(item);
                }
                Ok(Ordered::Array(items))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Ordered, A::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = map.next_entry()? {
                    entries.push(entry);
                }
                Ok(Ordered::Object(entries))
            }
        }

        deserializer.deserialize_any(OrderedVisitor)
    }
}

fn replace(text: &str, pattern: &str, with: &str) -> String {
    Regex::new(pattern)
        .unwrap()
        .replace_all(text, with)
        .into_owned()
}

fn normalize_json(text: &str) -> String {
    let mut tree: Ordered = serde_json::from_str(text).expect("export is JSON");
    assert!(
        serde_json::to_string_pretty(&tree).unwrap() == text,
        "re-printing must reproduce the export byte for byte"
    );
    tree.sort_unordered(None);
    let text = serde_json::to_string_pretty(&tree).unwrap();
    let text = replace(
        &text,
        r#""exportedAt": "[^"]*""#,
        r#""exportedAt": "<time>""#,
    );
    let text = replace(
        &text,
        r#""exportedBy": "TracePilot v[^"]*""#,
        r#""exportedBy": "TracePilot v<version>""#,
    );
    let text = replace(&text, r#""os": "[^"]*""#, r#""os": "<os>""#);
    replace(
        &text,
        r#""contentHash": "[0-9a-f]{64}""#,
        r#""contentHash": "<hash>""#,
    )
}

fn normalize_markdown(text: &str) -> String {
    let text = replace(
        text,
        r"(> Exported by \[)TracePilot v[^\]]*(\]\([^)]*\) on )\S+",
        "${1}TracePilot v<version>${2}<time>",
    );
    // The events summary sorts by count only; ties come out in hash order.
    let row = Regex::new(r"^\| `[^`]+` \| (\d+) \|$").unwrap();
    let count = |line: &str| row.captures(line).map(|c| c[1].to_string());
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out: Vec<&str> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        let Some(n) = count(lines[i]) else {
            out.push(lines[i]);
            i += 1;
            continue;
        };
        let start = i;
        while i < lines.len() && count(lines[i]).as_deref() == Some(n.as_str()) {
            i += 1;
        }
        let mut group = lines[start..i].to_vec();
        group.sort_unstable();
        out.extend(group);
    }
    out.join("\n")
}

fn assert_golden_bytes(name: &str, actual: &str) {
    let path = golden_dir().join(name);
    let actual = actual.replace("\r\n", "\n");
    let actual = if name.ends_with(".json") && !actual.starts_with("error: ") {
        normalize_json(&actual)
    } else {
        normalize_markdown(&actual)
    };
    if std::env::var_os("TRACEPILOT_UPDATE_GOLDEN").is_some_and(|v| v == "1") {
        std::fs::create_dir_all(golden_dir()).unwrap();
        std::fs::write(&path, &actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("missing golden file {}: {e}", path.display()))
        .replace("\r\n", "\n");
    if expected != actual {
        let actual_path = path.with_extension("actual");
        std::fs::write(&actual_path, &actual).unwrap();
        panic!(
            "golden mismatch: {} (actual written to {})",
            path.display(),
            actual_path.display()
        );
    }
}

fn text(files: &[ExportFile]) -> String {
    assert_eq!(files.len(), 1, "one output file");
    files[0].as_text().expect("UTF-8 output").to_string()
}

fn export(dir: &Path, options: &ExportOptions) -> String {
    match export_session(dir, options) {
        Ok(files) => text(&files),
        Err(error) => format!("error: {error}\n"),
    }
}

#[test]
fn copilot_export_matches_golden() {
    let root = tempfile::tempdir().unwrap();
    let corpus = write_copilot_corpus(root.path());

    for (session, dir) in &corpus {
        for (format, extension) in [
            (ExportFormat::Json, "tpx.json"),
            (ExportFormat::Markdown, "md"),
        ] {
            let options = ExportOptions::all(format);
            let output = export(dir, &options);
            let output = output.replace(&*dir.to_string_lossy(), "<session-dir>");
            assert_golden_bytes(&format!("{}.{extension}", session.name), &output);
        }
    }
}

#[test]
fn copilot_redacted_export_matches_golden() {
    let root = tempfile::tempdir().unwrap();
    let corpus = write_copilot_corpus(root.path());
    let (_, dir) = corpus.iter().find(|(s, _)| s.name == "full").unwrap();

    let mut options = ExportOptions::all(ExportFormat::Json);
    options.redaction = RedactionOptions {
        anonymize_paths: true,
        strip_secrets: true,
        strip_pii: true,
    };
    assert_golden_bytes("full-redacted.tpx.json", &export(dir, &options));
}

#[test]
fn copilot_batch_export_matches_golden() {
    let root = tempfile::tempdir().unwrap();
    let corpus = write_copilot_corpus(root.path());
    let dirs: Vec<&Path> = corpus
        .iter()
        .filter(|(s, _)| matches!(s.name, "full" | "minimal"))
        .map(|(_, dir)| dir.as_path())
        .collect();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_sessions_batch(&dirs, &options).unwrap();
    assert_golden_bytes("batch.tpx.json", &text(&files));
}
