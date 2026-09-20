use serde::Serialize;
use serde_json::{Value, json};
use std::fs::{File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use tracepilot_core::parsing::events::TypedEventData;

use super::model::{
    AnyError, FIXTURE_VERSION, FixtureManifest, MANIFEST_FILE, MARKER_FILE, ManifestSession,
};

pub(super) fn largest_corpus(session: &ManifestSession) -> Value {
    json!({
        "sessionId": session.id,
        "profile": session.profile,
        "events": session.event_count,
        "turns": session.turn_count,
        "toolCalls": session.tool_call_count,
        "stressBytes": session.stress_bytes
    })
}

pub(super) fn verify_corpus(
    root: &Path,
    sessions_root: &Path,
    manifest: &FixtureManifest,
) -> Result<Value, AnyError> {
    if root != Path::new(&manifest.root) {
        return fail(format!(
            "manifest root '{}' does not match corpus '{}'",
            manifest.root,
            root.display()
        ));
    }
    if manifest.fixture_version != FIXTURE_VERSION {
        return fail(format!(
            "unsupported fixture version {}; expected {FIXTURE_VERSION}",
            manifest.fixture_version
        ));
    }
    if manifest.sessions.len() != manifest.totals.session_count {
        return fail("manifest session list and total disagree");
    }
    let discovered = tracepilot_core::session::discovery::discover_sessions(sessions_root)?;
    if discovered.len() != manifest.totals.session_count {
        return fail(format!(
            "discovered {} sessions, expected {}",
            discovered.len(),
            manifest.totals.session_count
        ));
    }
    let actual_files = count_files(root)?;
    if actual_files < manifest.totals.file_count {
        return fail(format!(
            "corpus has {actual_files} files, expected at least {}",
            manifest.totals.file_count
        ));
    }

    let mut events = 0usize;
    let mut turns = 0usize;
    for session in &manifest.sessions {
        let session_dir = sessions_root.join(&session.id);
        let parsed = tracepilot_core::parsing::events::parse_typed_events(
            &session_dir.join("events.jsonl"),
        )?;
        validate_parsed(session, &parsed)?;
        let reconstructed = tracepilot_core::turns::reconstruct_turns(&parsed.events);
        if reconstructed.len() != session.turn_count {
            return fail(format!(
                "{} reconstructed {} turns, expected {}",
                session.id,
                reconstructed.len(),
                session.turn_count
            ));
        }
        let summary = tracepilot_core::summary::load_session_summary_from_events(
            &session_dir,
            &parsed.events,
        )?;
        if summary.id != session.id || summary.summary.as_deref() != Some(session.title.as_str()) {
            return fail(format!("{} workspace identity/title mismatch", session.id));
        }
        events += parsed.events.len();
        turns += reconstructed.len();
    }
    if events != manifest.totals.event_count || turns != manifest.totals.turn_count {
        return fail("verified event/turn totals do not match manifest");
    }
    Ok(json!({
        "discoveredSessions": discovered.len(),
        "parsedEvents": events,
        "reconstructedTurns": turns,
        "actualFiles": actual_files,
        "minimumOwnedFiles": manifest.totals.file_count,
        "allParseDiagnosticsClean": true,
        "allSessionStartIdsMatchDirectory": true
    }))
}

pub(super) fn validate_parsed(
    session: &ManifestSession,
    parsed: &tracepilot_core::parsing::events::ParsedEvents,
) -> Result<(), AnyError> {
    if parsed.events.len() != session.event_count {
        return fail(format!(
            "{} parsed {} events, expected {}",
            session.id,
            parsed.events.len(),
            session.event_count
        ));
    }
    if parsed.diagnostics.has_warnings() {
        return fail(format!(
            "{} has parse warnings: malformed={}, fallback={}",
            session.id, parsed.diagnostics.malformed_lines, parsed.diagnostics.fallback_events
        ));
    }
    let start_id = parsed.events.iter().find_map(|event| {
        if let TypedEventData::SessionStart(data) = &event.typed_data {
            data.session_id.as_deref()
        } else {
            None
        }
    });
    if start_id != Some(session.id.as_str()) {
        return fail(format!(
            "{} session.start ID was {:?}",
            session.id, start_id
        ));
    }
    Ok(())
}

pub(super) fn load_owned_manifest(root: &Path) -> Result<FixtureManifest, AnyError> {
    let marker = root.join(MARKER_FILE);
    if !marker.is_file() {
        return fail(format!(
            "refusing to probe unowned root without {}: {}",
            MARKER_FILE,
            root.display()
        ));
    }
    let marker_text = std::fs::read_to_string(&marker)?;
    if !marker_text.contains("tracepilot-performance-corpus")
        || !marker_text.contains(&format!("fixture-version={FIXTURE_VERSION}"))
    {
        return fail(format!(
            "unrecognized corpus ownership marker: {}",
            marker.display()
        ));
    }
    Ok(serde_json::from_reader(File::open(
        root.join(MANIFEST_FILE),
    )?)?)
}

pub(super) fn create_new_text(path: &Path, content: &str) -> Result<(), AnyError> {
    let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

pub(super) fn create_new_json(path: &Path, value: &impl Serialize) -> Result<(), AnyError> {
    let file = OpenOptions::new().create_new(true).write(true).open(path)?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer_pretty(&mut writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

pub(super) fn write_json_output(
    value: &impl Serialize,
    output: Option<PathBuf>,
) -> Result<(), AnyError> {
    match output {
        Some(path) => create_new_json(&path, value),
        None => {
            let stdout = io::stdout();
            let mut lock = stdout.lock();
            serde_json::to_writer_pretty(&mut lock, value)?;
            lock.write_all(b"\n")?;
            Ok(())
        }
    }
}

pub(super) fn count_files(root: &Path) -> Result<usize, AnyError> {
    let mut count = 0usize;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                pending.push(entry.path());
            } else {
                count += 1;
            }
        }
    }
    Ok(count)
}

pub(super) fn nanos_u64(nanos: u128) -> u64 {
    u64::try_from(nanos).unwrap_or(u64::MAX)
}

pub(super) fn fail<T>(message: impl Into<String>) -> Result<T, AnyError> {
    Err(io::Error::other(message.into()).into())
}
