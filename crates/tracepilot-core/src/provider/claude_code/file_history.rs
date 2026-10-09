//! Rewind points from `file-history-snapshot` and `file-history-delta`
//! records (record-shapes.md, bookkeeping records).
//!
//! Each record names the prompt it belongs to (`messageId`) and maps tracked
//! paths to `snapshot.trackedFileBackups[path].backupFileName`, a file under
//! `file-history/<session id>/`; `null` means the file did not exist yet. A
//! prompt's first record starts a checkpoint holding every file tracked so
//! far; later records for the same prompt update it. Only the transcript is
//! read here: backups are opened one at a time, when a user asks for one
//! ([`crate::provider::FileHistory::read_version`]).

use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

use super::prompts::without_paste_tags;
use super::reader::Line;
use super::records::Rec;
use crate::provider::{FileCheckpoint, FileVersion, is_safe_backup_name};

const RECORD_TYPES: &[&str] = &["file-history-snapshot", "file-history-delta"];

/// The longest prompt opening kept as a checkpoint's label.
const MAX_PROMPT_CHARS: usize = 120;

/// One tracked file's backup and version.
type Tracked = BTreeMap<String, (Option<String>, Option<u32>)>;

/// Checkpoints in transcript order. Empty when the session backed nothing up.
pub(super) fn checkpoints(lines: &[Line]) -> Vec<FileCheckpoint> {
    let mut order: Vec<(String, Option<String>, Tracked)> = Vec::new();
    let mut by_message: HashMap<String, usize> = HashMap::new();
    for line in lines {
        let rec = Rec(&line.value);
        if !RECORD_TYPES.contains(&rec.kind()) {
            continue;
        }
        let snapshot = rec.0.get("snapshot");
        let Some(message_id) = rec
            .str("messageId")
            .or_else(|| snapshot.and_then(|s| s.get("messageId")?.as_str()))
        else {
            continue;
        };
        let index = *by_message.entry(message_id.to_string()).or_insert_with(|| {
            let carried = order.last().map(|(_, _, files)| files.clone());
            let timestamp = snapshot
                .and_then(|s| s.get("timestamp")?.as_str())
                .or_else(|| rec.str("timestamp"))
                .map(str::to_string);
            order.push((
                message_id.to_string(),
                timestamp,
                carried.unwrap_or_default(),
            ));
            order.len() - 1
        });
        let backups = snapshot
            .and_then(|s| s.get("trackedFileBackups"))
            .and_then(Value::as_object);
        for (path, backup) in backups.into_iter().flatten() {
            let name = backup.get("backupFileName").and_then(Value::as_str);
            // A name that is not a plain file name is never kept: it could
            // only point outside the backup directory.
            if name.is_some_and(|name| !is_safe_backup_name(name)) {
                continue;
            }
            let version = backup
                .get("version")
                .and_then(Value::as_u64)
                .and_then(|v| u32::try_from(v).ok());
            order[index]
                .2
                .insert(path.clone(), (name.map(str::to_string), version));
        }
    }

    let prompts = prompt_openings(lines, &by_message);
    let mut previous: Option<&Tracked> = None;
    let mut out = Vec::with_capacity(order.len());
    for (number, (message_id, timestamp, tracked)) in order.iter().enumerate() {
        let files = tracked
            .iter()
            .map(|(path, (backup, version))| FileVersion {
                path: path.clone(),
                backup: backup.clone(),
                version: *version,
                changed: previous
                    .and_then(|prev| prev.get(path))
                    .is_none_or(|(prev, _)| prev != backup),
            })
            .collect();
        out.push(FileCheckpoint {
            number: u32::try_from(number + 1).unwrap_or(u32::MAX),
            message_id: message_id.clone(),
            timestamp: timestamp.clone(),
            prompt: prompts.get(message_id.as_str()).cloned(),
            files,
        });
        previous = Some(tracked);
    }
    out
}

/// The opening line of each checkpoint's prompt.
fn prompt_openings(lines: &[Line], wanted: &HashMap<String, usize>) -> HashMap<String, String> {
    let mut openings = HashMap::new();
    for line in lines {
        let rec = Rec(&line.value);
        let Some(uuid) = rec.uuid().filter(|uuid| wanted.contains_key(*uuid)) else {
            continue;
        };
        if rec.kind() != "user" {
            continue;
        }
        let Some(text) = rec.text() else { continue };
        let text = without_paste_tags(&text);
        let Some(first) = text.lines().map(str::trim).find(|l| !l.is_empty()) else {
            continue;
        };
        let mut opening: String = first.chars().take(MAX_PROMPT_CHARS).collect();
        if first.chars().count() > MAX_PROMPT_CHARS {
            opening.push('…');
        }
        openings.insert(uuid.to_string(), opening);
    }
    openings
}
