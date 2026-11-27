//! Listing the sessions under `projects/`. It runs on every refresh, so it
//! reads entry types and sizes from the directory listing (free on Windows)
//! instead of a stat per entry, and lists `subagents/` only for sessions
//! that have a folder beside their transcript.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::error::{Result, TracePilotError};
use crate::ids::SessionId;
use crate::parsing::snapshot::check_cancelled;
use crate::provider::{SessionLocator, SessionRole, SessionSource};

/// Every session transcript in the project folders of `projects`, sorted by
/// path.
pub(super) fn list_sessions(
    projects: std::fs::ReadDir,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<Vec<SessionLocator>> {
    let mut sessions = Vec::new();
    for project in projects {
        check_cancelled(&is_cancelled)?;
        let project = project?;
        if !entry_is(&project, std::fs::FileType::is_dir, Path::is_dir) {
            continue;
        }
        let project = project.path();
        let files = std::fs::read_dir(&project)
            .map_err(|e| TracePilotError::io_context("Failed to read", project.display(), e))?;
        let mut transcripts = Vec::new();
        let mut folders = HashSet::new();
        for file in files {
            check_cancelled(&is_cancelled)?;
            let file = file?;
            let path = file.path();
            if entry_is(&file, std::fs::FileType::is_dir, Path::is_dir) {
                // Lowercased: Windows matches names in any case, as the
                // `subagents/` listing this stands in for did.
                folders.insert(file.file_name().to_string_lossy().to_lowercase());
            } else if let Some(id) = session_id(&path)
                && entry_is(&file, std::fs::FileType::is_file, Path::is_file)
            {
                transcripts.push((id, path, entry_len(&file)));
            }
        }
        for (id, path, main_len) in transcripts {
            let has_folder = path
                .file_stem()
                .is_some_and(|stem| folders.contains(&stem.to_string_lossy().to_lowercase()));
            sessions.push(discovered(id, path, main_len, has_folder)?);
        }
    }
    check_cancelled(&is_cancelled)?;
    sessions.sort_by(|a, b| a.primary_path.cmp(&b.primary_path));
    Ok(sessions)
}

pub(super) fn locator(id: SessionId, main: PathBuf) -> Result<SessionLocator> {
    let main_len = std::fs::metadata(&main).map_or(0, |metadata| metadata.len());
    discovered(id, main, main_len, true)
}

/// A locator for a transcript of `main_len` bytes. Its subagent files
/// are listed only when the session has a folder beside the transcript.
fn discovered(
    id: SessionId,
    main: PathBuf,
    main_len: u64,
    has_folder: bool,
) -> Result<SessionLocator> {
    let subagent_bytes: u64 = if has_folder {
        session_files(&main)?
            .iter()
            .skip(1)
            .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
            .filter_map(|path| std::fs::metadata(path).ok())
            .map(|metadata| metadata.len())
            .sum()
    } else {
        0
    };
    let source_bytes_hint = main_len.saturating_add(subagent_bytes);
    Ok(SessionLocator {
        source: SessionSource::ClaudeCode,
        id,
        primary_path: main,
        parent_id: None,
        role: SessionRole::Primary,
        source_bytes_hint,
    })
}

/// The main transcript and every subagent transcript and `meta.json`: the
/// files a load reads.
pub(super) fn session_files(main: &Path) -> Result<Vec<PathBuf>> {
    let mut files = vec![main.to_path_buf()];
    let dir = main.with_extension("").join("subagents");
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(files),
        Err(error) => {
            return Err(TracePilotError::io_context(
                "Failed to read",
                dir.display(),
                error,
            ));
        }
    };
    for entry in entries {
        let path = entry?.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with("agent-") && (name.ends_with(".jsonl") || name.ends_with(".meta.json"))
        {
            files.push(path);
        }
    }
    Ok(files)
}

/// Whether a listed entry is of a kind, from the listing's own type. A link
/// (or Windows junction) is followed with a stat, as `Path::is_dir` would.
fn entry_is(
    entry: &std::fs::DirEntry,
    kind: fn(&std::fs::FileType) -> bool,
    followed: fn(&Path) -> bool,
) -> bool {
    match entry.file_type() {
        Ok(file_type) if !file_type.is_symlink() => kind(&file_type),
        _ => followed(&entry.path()),
    }
}

/// A listed file's size: from the listing on Windows, followed for a link.
fn entry_len(entry: &std::fs::DirEntry) -> u64 {
    let metadata = match entry.file_type() {
        Ok(file_type) if !file_type.is_symlink() => entry.metadata(),
        _ => std::fs::metadata(entry.path()),
    };
    metadata.map_or(0, |metadata| metadata.len())
}

/// `<uuid>.jsonl` → the session id.
pub(super) fn session_id(path: &Path) -> Option<SessionId> {
    if path.extension().is_none_or(|ext| ext != "jsonl") {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    let id = uuid::Uuid::parse_str(stem).ok()?;
    Some(SessionId::from_validated(id.to_string()))
}
