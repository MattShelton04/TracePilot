//! Raising Claude Code's `cleanupPeriodDays` in its user `settings.json`.
//!
//! The file belongs to Claude Code, so it is edited as text: only the one
//! value is replaced, or one entry appended, and every other key, its order
//! and the file's formatting stay as they were. A file that isn't a strict
//! JSON object is refused rather than rewritten, and the value is never
//! lowered. The caller picks and checks the path.
//!
//! `json_io::atomic_json_write` isn't used: it re-serializes (sorting the
//! keys) and on Windows replaces a fixed `.json.bak` sibling, which could be
//! the user's own backup. The replacement here goes through a uniquely named
//! temporary file in the same folder and touches nothing else.

use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use crate::error::{OrchestratorError, Result};

/// The key Claude Code reads.
pub const CLEANUP_PERIOD_KEY: &str = "cleanupPeriodDays";
/// Claude Code rejects values below 1.
pub const MIN_CLEANUP_PERIOD_DAYS: u32 = 1;
/// A hundred years; anything longer is surely a typo.
pub const MAX_CLEANUP_PERIOD_DAYS: u32 = 36_500;
/// Larger files aren't edited; a user settings file is a few KiB.
const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;
const BOM: &str = "\u{FEFF}";

static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// What [`raise_claude_cleanup_period`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupPeriodRaise {
    /// The file now sets the requested value.
    Written,
    /// The file already keeps transcripts at least this many days; untouched.
    AlreadyAtLeast(u64),
}

/// Set `cleanupPeriodDays` to `days` in the settings file at `settings_path`
/// unless it already keeps transcripts at least that long. A missing file is
/// created; its folder must already exist.
pub fn raise_claude_cleanup_period(settings_path: &Path, days: u32) -> Result<CleanupPeriodRaise> {
    if !(MIN_CLEANUP_PERIOD_DAYS..=MAX_CLEANUP_PERIOD_DAYS).contains(&days) {
        return Err(refused(format!(
            "Choose a whole number of days from {MIN_CLEANUP_PERIOD_DAYS} to {MAX_CLEANUP_PERIOD_DAYS}."
        )));
    }
    if !settings_path.parent().is_some_and(Path::is_dir) {
        return Err(refused("The Claude Code folder doesn't exist.".into()));
    }
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_poisoned| refused("Another settings update failed; try again.".into()))?;
    let existing = read_settings(settings_path)?;
    let updated = match &existing {
        None => format!("{{\n  \"{CLEANUP_PERIOD_KEY}\": {days}\n}}\n"),
        Some((text, _)) => match edit_cleanup_period(text, days)? {
            Edit::Keep(current) => return Ok(CleanupPeriodRaise::AlreadyAtLeast(current)),
            Edit::Replace(text) => text,
        },
    };
    let permissions = existing.map(|(_, permissions)| permissions);
    replace_file(settings_path, updated.as_bytes(), permissions)?;
    Ok(CleanupPeriodRaise::Written)
}

/// Write `bytes` to a temporary file beside `path`, then rename it over
/// `path`, which replaces an existing file on every platform. The temporary
/// file is removed if anything fails.
fn replace_file(
    path: &Path,
    bytes: &[u8],
    permissions: Option<std::fs::Permissions>,
) -> Result<()> {
    let folder = path
        .parent()
        .ok_or_else(|| refused("The Claude Code folder doesn't exist.".into()))?;
    let mut temp = tempfile::Builder::new()
        .prefix(".settings.json.")
        .suffix(".tmp")
        .tempfile_in(folder)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    // The temporary file is private; keep the original's permissions.
    if let Some(permissions) = permissions {
        std::fs::set_permissions(temp.path(), permissions)?;
    }
    temp.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn refused(message: String) -> OrchestratorError {
    OrchestratorError::Config(message)
}

fn left_unchanged(reason: &str) -> OrchestratorError {
    refused(format!("settings.json {reason}, so it was left unchanged."))
}

/// The file's text and permissions, or `None` when there is no file.
fn read_settings(path: &Path) -> Result<Option<(String, std::fs::Permissions)>> {
    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !meta.is_file() {
        return Err(left_unchanged("isn't a regular file"));
    }
    if meta.permissions().readonly() {
        return Err(left_unchanged("is read-only"));
    }
    if meta.len() > MAX_SETTINGS_BYTES {
        return Err(left_unchanged("is larger than 1 MiB"));
    }
    let bytes = std::fs::read(path)?;
    let text = String::from_utf8(bytes).map_err(|_not_utf8| left_unchanged("isn't valid JSON"))?;
    Ok(Some((text, meta.permissions())))
}

#[derive(Debug, PartialEq, Eq)]
enum Edit {
    Keep(u64),
    Replace(String),
}

/// The file's text with `cleanupPeriodDays` set to `days`, or `Keep` when
/// it is already at least that.
fn edit_cleanup_period(text: &str, days: u32) -> Result<Edit> {
    let (bom, body) = match text.strip_prefix(BOM) {
        Some(body) => (BOM, body),
        None => ("", text),
    };
    let Ok(serde_json::Value::Object(mut before)) = serde_json::from_str(body) else {
        return Err(left_unchanged("isn't valid JSON"));
    };
    let object = top_level_entries(body).ok_or_else(|| left_unchanged("isn't valid JSON"))?;
    let mut existing = object
        .entries
        .iter()
        .filter(|entry| entry.key == CLEANUP_PERIOD_KEY);
    let found = existing.next();
    if existing.next().is_some() {
        return Err(left_unchanged("sets cleanupPeriodDays more than once"));
    }
    if let Some(current) = before.get(CLEANUP_PERIOD_KEY).and_then(whole_days)
        && current >= u64::from(days)
    {
        return Ok(Edit::Keep(current));
    }

    let edited = match (found, object.entries.first(), object.entries.last()) {
        // Replace the value, keeping the spacing around it.
        (Some(entry), _, _) => splice(body, entry.value_start..entry.value_end, &days.to_string()),
        // Append after the last entry, spaced like the first one.
        (None, Some(first), Some(last)) => {
            let indent = &body[object.open + 1..first.key_start];
            let colon = &body[first.key_end..first.value_start];
            let entry = format!(",{indent}\"{CLEANUP_PERIOD_KEY}\"{colon}{days}");
            splice(body, last.value_end..last.value_end, &entry)
        }
        // An empty object.
        _ => {
            let newline = if body.contains("\r\n") { "\r\n" } else { "\n" };
            let entry = format!("{newline}  \"{CLEANUP_PERIOD_KEY}\": {days}{newline}");
            splice(body, object.open + 1..object.close, &entry)
        }
    };

    // The edit must change exactly the one value.
    let Ok(serde_json::Value::Object(mut after)) = serde_json::from_str(&edited) else {
        return Err(left_unchanged("couldn't be edited safely"));
    };
    let written = after.remove(CLEANUP_PERIOD_KEY);
    before.remove(CLEANUP_PERIOD_KEY);
    if written != Some(serde_json::Value::from(days)) || before != after {
        return Err(left_unchanged("couldn't be edited safely"));
    }
    Ok(Edit::Replace(format!("{bom}{edited}")))
}

fn splice(text: &str, range: std::ops::Range<usize>, with: &str) -> String {
    let mut out = String::with_capacity(text.len() + with.len());
    out.push_str(&text[..range.start]);
    out.push_str(with);
    out.push_str(&text[range.end..]);
    out
}

/// A whole number of days, as JavaScript reads JSON (`30.0` is 30).
fn whole_days(value: &serde_json::Value) -> Option<u64> {
    if let Some(days) = value.as_u64() {
        return Some(days);
    }
    let days = value.as_f64()?;
    (days >= 0.0 && days.fract() == 0.0).then(|| days.min(u64::MAX as f64) as u64)
}

/// Byte offsets of a top-level object's braces and entries.
struct TopLevel {
    open: usize,
    close: usize,
    entries: Vec<Entry>,
}

struct Entry {
    key: String,
    /// The key's opening quote.
    key_start: usize,
    /// Just past the key's closing quote.
    key_end: usize,
    value_start: usize,
    value_end: usize,
}

/// Walk the top level of a JSON object that serde has already accepted.
/// `None` means the text isn't shaped as expected.
fn top_level_entries(text: &str) -> Option<TopLevel> {
    let bytes = text.as_bytes();
    let open = skip_whitespace(bytes, 0);
    if bytes.get(open) != Some(&b'{') {
        return None;
    }
    let mut entries = Vec::new();
    let mut at = skip_whitespace(bytes, open + 1);
    if bytes.get(at) == Some(&b'}') {
        return Some(TopLevel {
            open,
            close: at,
            entries,
        });
    }
    loop {
        if bytes.get(at) != Some(&b'"') {
            return None;
        }
        let key_start = at;
        let key_end = skip_string(bytes, key_start)?;
        // Decoded, so an escaped spelling of the key still matches.
        let key: String = serde_json::from_str(&text[key_start..key_end]).ok()?;
        at = skip_whitespace(bytes, key_end);
        if bytes.get(at) != Some(&b':') {
            return None;
        }
        let value_start = skip_whitespace(bytes, at + 1);
        let value_end = skip_value(bytes, value_start)?;
        entries.push(Entry {
            key,
            key_start,
            key_end,
            value_start,
            value_end,
        });
        at = skip_whitespace(bytes, value_end);
        match bytes.get(at)? {
            b',' => at = skip_whitespace(bytes, at + 1),
            b'}' => {
                return Some(TopLevel {
                    open,
                    close: at,
                    entries,
                });
            }
            _ => return None,
        }
    }
}

fn skip_whitespace(bytes: &[u8], mut at: usize) -> usize {
    while matches!(bytes.get(at), Some(b' ' | b'\t' | b'\n' | b'\r')) {
        at += 1;
    }
    at
}

/// Just past the closing quote of the string that opens at `at`.
fn skip_string(bytes: &[u8], at: usize) -> Option<usize> {
    let mut at = at + 1;
    loop {
        match bytes.get(at)? {
            b'\\' => at += 2,
            b'"' => return Some(at + 1),
            _ => at += 1,
        }
    }
}

/// Just past the value that starts at `at`.
fn skip_value(bytes: &[u8], at: usize) -> Option<usize> {
    match bytes.get(at)? {
        b'"' => skip_string(bytes, at),
        b'{' | b'[' => {
            let mut depth = 0usize;
            let mut at = at;
            loop {
                match bytes.get(at)? {
                    b'"' => {
                        at = skip_string(bytes, at)?;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(at + 1);
                        }
                    }
                    _ => {}
                }
                at += 1;
            }
        }
        _ => {
            let mut end = at;
            while !matches!(
                bytes.get(end),
                None | Some(b' ' | b'\t' | b'\n' | b'\r' | b',' | b'}' | b']')
            ) {
                end += 1;
            }
            Some(end)
        }
    }
}

#[cfg(test)]
mod tests;
