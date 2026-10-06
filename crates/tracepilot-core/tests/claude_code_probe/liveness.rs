//! Shapes of `sessions/<pid>.json` (C1 liveness). Reads only `*.json`, never
//! the sibling `*.key` secret, and prints key names, value shapes and counts.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use serde_json::Value;

#[derive(Default)]
pub struct LivenessShapes {
    files: usize,
    unreadable: usize,
    keys: BTreeMap<String, usize>,
    proc_start_shapes: BTreeMap<String, usize>,
    statuses: BTreeMap<String, usize>,
    matching_sessions: usize,
}

impl LivenessShapes {
    pub fn read(config_dir: &Path, session_ids: &HashSet<String>) -> Self {
        let mut shapes = Self::default();
        let entries = std::fs::read_dir(config_dir.join("sessions"));
        for entry in entries.into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            shapes.files += 1;
            let Some(record) = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            else {
                shapes.unreadable += 1;
                continue;
            };
            for key in record.as_object().into_iter().flat_map(|m| m.keys()) {
                *shapes.keys.entry(key.clone()).or_default() += 1;
            }
            *shapes
                .proc_start_shapes
                .entry(value_shape(&record["procStart"]))
                .or_default() += 1;
            let status = match record["status"].as_str() {
                Some(s @ ("busy" | "idle" | "waiting")) => s.to_string(),
                Some(_) => "other".into(),
                None => "-".into(),
            };
            *shapes.statuses.entry(status).or_default() += 1;
            if record["sessionId"]
                .as_str()
                .is_some_and(|id| session_ids.contains(id))
            {
                shapes.matching_sessions += 1;
            }
        }
        shapes
    }

    pub fn print(&self) {
        println!("\n### Liveness files (`sessions/*.json`)\n");
        println!(
            "- Files {} ({} unreadable); sessionId matches a discovered transcript: {}",
            self.files, self.unreadable, self.matching_sessions
        );
        println!("- Keys: {:?}", self.keys);
        println!("- procStart shapes: {:?}", self.proc_start_shapes);
        println!("- Status values: {:?}", self.statuses);
    }
}

/// `9` for digits, `a` for letters, other characters kept; runs collapsed
/// with their length, e.g. `9{18}` or `a{3}, 9{2} …`.
fn value_shape(value: &Value) -> String {
    let text = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => return format!("number {}", shape(&n.to_string())),
        Value::Null => return "absent".into(),
        other => return type_name(other).to_string(),
    };
    format!("string {}", shape(&text))
}

fn shape(text: &str) -> String {
    let mut out = String::new();
    let mut run: Option<(char, usize)> = None;
    let class = |c: char| match c {
        '0'..='9' => '9',
        c if c.is_alphabetic() => 'a',
        c => c,
    };
    for c in text.chars().map(class).chain(std::iter::once('\0')) {
        match run {
            Some((k, n)) if k == c => run = Some((k, n + 1)),
            _ => {
                if let Some((k, n)) = run {
                    if n == 1 {
                        out.push(k);
                    } else {
                        out.push_str(&format!("{k}{{{n}}}"));
                    }
                }
                run = Some((c, 1));
            }
        }
    }
    out
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Bool(_) => "bool",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
        _ => "other",
    }
}
