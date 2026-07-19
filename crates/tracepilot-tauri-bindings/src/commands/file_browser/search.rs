//! Bounded session-wide text-content search for the Explorer tab.

use super::security::{
    collect_entries, reject_hidden_filename, revalidate_within_session_dir, safe_session_file_path,
};
use super::types::{
    MAX_ENTRIES, MAX_SEARCH_BYTES_PER_FILE, MAX_SEARCH_MATCHES_PER_FILE, MAX_SEARCH_RESULTS,
    MAX_SEARCH_TOTAL_BYTES, SessionFileSearchMatch, SessionFileSearchResponse, SessionFileType,
};
use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use std::io::Read as _;

const MAX_EXCERPT_CHARS: usize = 240;

fn line_excerpt(line: &str) -> String {
    let normalized = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= MAX_EXCERPT_CHARS {
        return normalized;
    }
    let mut excerpt: String = normalized.chars().take(MAX_EXCERPT_CHARS).collect();
    excerpt.push('…');
    excerpt
}

/// Search readable files in one session using a bounded, case-insensitive
/// literal substring match. Binary, image, and SQLite files are never opened.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn session_search_files(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    query: String,
) -> CmdResult<SessionFileSearchResponse> {
    crate::validators::validate_session_id(&session_id)?;
    let query = query.trim();
    if query.chars().count() < 2 {
        return Err(BindingsError::Validation(
            "Content search requires at least 2 characters".into(),
        ));
    }
    if query.chars().count() > 256 {
        return Err(BindingsError::Validation(
            "Content search is limited to 256 characters".into(),
        ));
    }
    let query = query.to_lowercase();
    let session_state_dir = read_config(&state).session_state_dir();

    blocking_cmd!({
        let session_dir = session_state_dir.join(&session_id);
        let canonical_dir = session_dir.canonicalize().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BindingsError::Validation(format!("Session directory not found: {session_id}"))
            } else {
                BindingsError::Validation(format!("Failed to resolve session dir: {e}"))
            }
        })?;
        let mut entries = Vec::new();
        collect_entries(&canonical_dir, &canonical_dir, 0, &mut entries)?;

        let mut response = SessionFileSearchResponse {
            matches: Vec::new(),
            scanned_files: 0,
            skipped_files: 0,
            truncated: entries.len() >= MAX_ENTRIES,
        };
        let mut total_bytes = 0_u64;

        for entry in entries.into_iter().filter(|entry| !entry.is_directory) {
            if matches!(
                entry.file_type,
                SessionFileType::Binary | SessionFileType::Image | SessionFileType::Sqlite
            ) {
                response.skipped_files += 1;
                continue;
            }
            if total_bytes >= MAX_SEARCH_TOTAL_BYTES || response.matches.len() >= MAX_SEARCH_RESULTS
            {
                response.truncated = true;
                response.skipped_files += 1;
                continue;
            }

            let file_path = match safe_session_file_path(&canonical_dir, &entry.path)
                .and_then(|path| revalidate_within_session_dir(&canonical_dir, &path))
                .and_then(|path| {
                    reject_hidden_filename(&path)?;
                    Ok(path)
                }) {
                Ok(path) if path.is_file() => path,
                _ => {
                    response.skipped_files += 1;
                    continue;
                }
            };

            let remaining = MAX_SEARCH_TOTAL_BYTES - total_bytes;
            let limit = MAX_SEARCH_BYTES_PER_FILE.min(remaining);
            let file = match std::fs::File::open(&file_path) {
                Ok(file) => file,
                Err(_) => {
                    response.skipped_files += 1;
                    continue;
                }
            };
            let mut bytes = Vec::new();
            let count = match file.take(limit + 1).read_to_end(&mut bytes) {
                Ok(count) => count,
                Err(_) => {
                    response.skipped_files += 1;
                    continue;
                }
            };
            let file_truncated = count > limit as usize;
            if file_truncated {
                bytes.truncate(limit as usize);
                response.truncated = true;
            }
            total_bytes += bytes.len() as u64;
            response.scanned_files += 1;

            let content = String::from_utf8_lossy(&bytes);
            let mut file_matches = 0;
            for (index, line) in content.lines().enumerate() {
                if !line.to_lowercase().contains(query.as_str()) {
                    continue;
                }
                response.matches.push(SessionFileSearchMatch {
                    path: entry.path.clone(),
                    line_number: index + 1,
                    excerpt: line_excerpt(line),
                });
                file_matches += 1;
                if file_matches >= MAX_SEARCH_MATCHES_PER_FILE
                    || response.matches.len() >= MAX_SEARCH_RESULTS
                {
                    response.truncated = true;
                    break;
                }
            }
        }

        Ok::<_, BindingsError>(response)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excerpt_is_whitespace_normalized_and_bounded() {
        assert_eq!(line_excerpt("  one\t two   three "), "one two three");
        let long = "x".repeat(MAX_EXCERPT_CHARS + 20);
        let excerpt = line_excerpt(&long);
        assert_eq!(excerpt.chars().count(), MAX_EXCERPT_CHARS + 1);
        assert!(excerpt.ends_with('…'));
    }
}
