//! Rewind points from `file-history-snapshot` and `file-history-delta`
//! records (record-shapes.md, bookkeeping records).
//!
//! The two records have different shapes:
//! - A snapshot names its prompt (`messageId`) and maps tracked paths to
//!   `snapshot.trackedFileBackups[path]`. An update (`isSnapshotUpdate`) adds
//!   to the same prompt's checkpoint.
//! - A delta tracks one file (`trackingPath`, `backup`) for the prompt its
//!   `snapshotMessageId` names. Its own `messageId` never opens a checkpoint.
//!
//! `backupFileName` is a file under `file-history/<session id>/`; `null`
//! means the file did not exist yet. Each checkpoint holds every file
//! tracked by then: its own records over the previous checkpoint's files,
//! carried forward after all records are read, so a late update to an
//! earlier prompt reaches later ones. Only the transcript is read here:
//! backups are opened one at a time, when a user asks for one
//! ([`crate::provider::FileHistory::read_version`]).

use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

use super::prompts::without_paste_tags;
use super::reader::Line;
use super::records::Rec;
use crate::provider::{FileCheckpoint, FileVersion, is_safe_backup_name};

/// The longest prompt opening kept as a checkpoint's label.
const MAX_PROMPT_CHARS: usize = 120;

/// One tracked file's backup and version.
type Tracked = BTreeMap<String, (Option<String>, Option<u32>)>;

/// A prompt's checkpoint as its own records describe it.
struct Point {
    message_id: String,
    timestamp: Option<String>,
    own: Tracked,
}

/// The record's tracked files, keyed by path: a snapshot's map, or a
/// delta's one file.
fn tracked_files(rec: Rec<'_>) -> Vec<(&str, &Value)> {
    match rec.kind() {
        "file-history-snapshot" => rec
            .0
            .pointer("/snapshot/trackedFileBackups")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(path, backup)| (path.as_str(), backup))
            .collect(),
        _ => rec
            .str("trackingPath")
            .zip(rec.0.get("backup"))
            .into_iter()
            .collect(),
    }
}

/// Checkpoints in transcript order. Empty when the session backed nothing up.
pub(super) fn checkpoints(lines: &[Line]) -> Vec<FileCheckpoint> {
    let mut points: Vec<Point> = Vec::new();
    let mut by_message: HashMap<String, usize> = HashMap::new();
    for line in lines {
        let rec = Rec(&line.value);
        let (message_id, timestamp) = match rec.kind() {
            "file-history-snapshot" => (
                rec.str("messageId")
                    .or_else(|| rec.ptr_str("/snapshot/messageId")),
                rec.ptr_str("/snapshot/timestamp"),
            ),
            "file-history-delta" => (rec.str("snapshotMessageId"), None),
            _ => continue,
        };
        let Some(message_id) = message_id else {
            continue;
        };
        let index = *by_message.entry(message_id.to_string()).or_insert_with(|| {
            points.push(Point {
                message_id: message_id.to_string(),
                timestamp: timestamp
                    .or_else(|| rec.str("timestamp"))
                    .map(str::to_string),
                own: Tracked::new(),
            });
            points.len() - 1
        });
        for (path, backup) in tracked_files(rec) {
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
            points[index]
                .own
                .insert(path.to_string(), (name.map(str::to_string), version));
        }
    }

    let prompts = prompt_openings(lines, &by_message);
    let mut previous = Tracked::new();
    let mut out = Vec::with_capacity(points.len());
    for (number, point) in points.into_iter().enumerate() {
        let mut tracked = previous.clone();
        tracked.extend(point.own);
        let files = tracked
            .iter()
            .map(|(path, (backup, version))| FileVersion {
                path: path.clone(),
                backup: backup.clone(),
                version: *version,
                changed: previous.get(path).is_none_or(|(prev, _)| prev != backup),
            })
            .collect();
        out.push(FileCheckpoint {
            number: u32::try_from(number + 1).unwrap_or(u32::MAX),
            prompt: prompts.get(point.message_id.as_str()).cloned(),
            message_id: point.message_id,
            timestamp: point.timestamp,
            files,
        });
        previous = tracked;
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
