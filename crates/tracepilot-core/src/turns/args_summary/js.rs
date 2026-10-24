//! The JavaScript semantics `formatArgsSummary()` relies on, for JSON values:
//! truthiness, `String(value)`, `/\s+/` and `trim()`, and string length and
//! `slice()` counted in UTF-16 code units.

use serde_json::{Map, Value};

/// The ellipsis appended to a truncated summary.
const ELLIPSIS: &str = "…";

/// JavaScript truthiness: `null`, `false`, `0` and `""` are falsy.
pub(super) fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// `a[key]` when it is truthy.
pub(super) fn truthy_arg<'a>(a: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    a.get(key).filter(|value| truthy(Some(value)))
}

/// `a[first] ?? a[second] ?? …`: the first argument that is present and not null.
pub(super) fn nullish<'a>(a: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .find_map(|key| a.get(*key).filter(|value| !value.is_null()))
}

/// `a[key]` when it is a string (`typeof a[key] === "string"`).
pub(super) fn str_arg<'a>(a: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    a.get(key).and_then(Value::as_str)
}

/// JavaScript `String(value)` (also what a template literal prints).
pub(super) fn to_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number(n),
        Value::String(s) => s.clone(),
        // `Array.prototype.join(",")`, which prints null elements as "".
        Value::Array(items) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => to_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// A JSON number as JavaScript prints it. Integral values print without a
/// fraction (`2.0` → "2"); other values use Rust's shortest round-trip form,
/// which matches JavaScript's outside exponent notation.
pub(super) fn number(n: &serde_json::Number) -> String {
    if n.is_i64() || n.is_u64() {
        return n.to_string();
    }
    match n.as_f64() {
        // Also -0, which JavaScript prints as "0".
        Some(0.0) => "0".into(),
        Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
        Some(f) => f.to_string(),
        None => n.to_string(),
    }
}

/// A character in JavaScript's `\s` class, which `trim()` also strips.
pub(super) fn is_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// JavaScript `text.trim()`.
pub(super) fn trim(text: &str) -> &str {
    text.trim_matches(is_space)
}

/// JavaScript `text.replace(/\s+/g, " ").trim()`: one line.
pub(super) fn one_line(text: &str) -> String {
    text.split(is_space)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// JavaScript `text.length > max ? `${text.slice(0, max)}…` : text`, with
/// lengths in UTF-16 code units. JavaScript would keep half of a surrogate
/// pair split by the cut; this drops the whole character instead.
pub(super) fn truncate(text: &str, max: usize) -> String {
    let mut units = 0;
    for (index, c) in text.char_indices() {
        units += c.len_utf16();
        if units > max {
            return format!("{}{ELLIPSIS}", &text[..index]);
        }
    }
    text.to_string()
}

/// `truncateSummary()`: one line, at most `max` UTF-16 units plus "…".
pub(super) fn truncate_summary(text: &str, max: usize) -> String {
    truncate(&one_line(text), max)
}

/// `stringArg()`: a string argument as one truncated line, or "".
pub(super) fn string_arg(a: &Map<String, Value>, key: &str) -> String {
    str_arg(a, key)
        .map(|s| truncate_summary(s, 100))
        .unwrap_or_default()
}
