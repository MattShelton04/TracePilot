//! Tauri IPC commands for the session file browser.

use super::security::{
    collect_entries, reject_hidden_filename, revalidate_within_session_dir, safe_session_file_path,
};
use super::types::{
    MAX_FULL_READ_BYTES, MAX_READ_BYTES, MAX_SQLITE_CELL_BYTES, MAX_SQLITE_COLUMNS_PER_TABLE,
    MAX_SQLITE_ROWS_PER_TABLE, MAX_SQLITE_TABLES, MAX_SQLITE_TEXT_BYTES_PER_TABLE,
    SessionFileEntry, SessionFileType,
};
use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;

/// List all files in a session's directory tree.
///
/// Returns a flat list of [`SessionFileEntry`] values (files and directories)
/// with paths relative to the session directory root.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn session_list_files(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<SessionFileEntry>> {
    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();

    blocking_cmd!({
        let session_dir = session_state_dir.join(&session_id);

        let mut entries = Vec::new();
        // Canonicalize before walking so we have an authoritative prefix to
        // verify subdirectories against (TOCTOU mitigation).
        // Drop the separate `exists()` precheck — let `canonicalize()` fail
        // with NotFound to eliminate the race window between the two calls.
        let canonical_dir = session_dir.canonicalize().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BindingsError::Validation(format!("Session directory not found: {}", session_id))
            } else {
                BindingsError::Validation(format!("Failed to resolve session dir: {e}"))
            }
        })?;
        collect_entries(&canonical_dir, &canonical_dir, 0, &mut entries)?;
        entries.sort_by(|a, b| {
            b.is_directory
                .cmp(&a.is_directory)
                .then_with(|| a.path.cmp(&b.path))
        });
        Ok::<_, BindingsError>(entries)
    })
}

/// Read the text content of a file within a session directory.
///
/// Returns a 1 MiB preview by default, or up to 16 MiB after an explicit
/// larger-read request.
/// Binary files (`.db`, `.sqlite`, etc.) cannot be read and return an error.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id, %relative_path))]
pub async fn session_read_file(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    relative_path: String,
    full: Option<bool>,
) -> CmdResult<String> {
    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();

    blocking_cmd!({
        let session_dir = session_state_dir.join(&session_id);
        let file_path = safe_session_file_path(&session_dir, &relative_path)?;

        if !file_path.exists() {
            return Err(BindingsError::Validation(format!(
                "File not found: {}",
                relative_path
            )));
        }

        // Re-canonicalize after the exists() check to close the TOCTOU window:
        // between safe_session_file_path (which skips canonicalization for
        // non-existent files) and here, the path could have been replaced with
        // a symlink pointing outside the session directory.
        let file_path = revalidate_within_session_dir(&session_dir, &file_path)?;

        if file_path.is_dir() {
            return Err(BindingsError::Validation(format!(
                "'{}' is a directory, not a file",
                relative_path
            )));
        }

        // Refuse to read binary formats or hidden dotfiles.
        reject_hidden_filename(&file_path)?;
        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let file_type = SessionFileType::from_name(&file_name);
        if matches!(
            file_type,
            SessionFileType::Binary | SessionFileType::Image | SessionFileType::Sqlite
        ) {
            return Err(BindingsError::Validation(format!(
                "'{}' is a binary file and cannot be displayed as text",
                relative_path
            )));
        }

        // Open the file once and read through a size-limited handle to close
        // the TOCTOU window between a metadata() size check and the subsequent
        // read (relevant for active sessions where events.jsonl grows rapidly).
        use std::io::Read as _;
        let file = std::fs::File::open(&file_path)?;
        let read_limit = if full.unwrap_or(false) {
            MAX_FULL_READ_BYTES
        } else {
            MAX_READ_BYTES
        };
        let mut buf = Vec::new();
        // take(MAX + 1) lets us detect truncation without a separate metadata call.
        let n = file.take(read_limit + 1).read_to_end(&mut buf)?;
        let truncated = n > read_limit as usize;
        if truncated {
            buf.truncate(read_limit as usize);
            // Walk back to the last valid UTF-8 boundary so we don't split a
            // multi-byte codepoint at the cut point (continuation bytes have
            // the high bits 0b10xxxxxx, i.e. (byte & 0xC0) == 0x80).
            while !buf.is_empty() && (buf[buf.len() - 1] & 0xC0 == 0x80) {
                buf.pop();
            }
        }

        let mut content = String::from_utf8_lossy(&buf).into_owned();
        if truncated {
            use tracepilot_core::utils::InfallibleWrite as _;
            content.push_fmt(format_args!(
                "\n\n[... file truncated — showing first {} bytes ...]",
                read_limit
            ));
        }

        Ok::<_, BindingsError>(content)
    })
}

/// Read all user tables from a SQLite database file within a session directory.
///
/// Returns at most `MAX_ROWS_PER_TABLE` rows per table to keep IPC payloads
/// manageable. The file must be a `.db`, `.sqlite`, or `.sqlite3` file located
/// inside the session directory (path traversal is rejected).
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id, %relative_path))]
pub async fn session_read_sqlite(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    relative_path: String,
) -> CmdResult<Vec<tracepilot_core::parsing::session_db::CustomTableInfo>> {
    use tracepilot_core::parsing::session_db::{list_tables, read_custom_table_bounded};

    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();

    blocking_cmd!({
        let session_dir = session_state_dir.join(&session_id);
        let file_path = safe_session_file_path(&session_dir, &relative_path)?;

        if !file_path.exists() {
            return Err(BindingsError::Validation(format!(
                "File not found: {}",
                relative_path
            )));
        }

        // Re-canonicalize after exists() to close the TOCTOU window (same
        // rationale as session_read_file above).
        let file_path = revalidate_within_session_dir(&session_dir, &file_path)?;

        // Only allow recognised SQLite extensions; reject hidden files.
        reject_hidden_filename(&file_path)?;
        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if SessionFileType::from_name(&file_name) != SessionFileType::Sqlite {
            return Err(BindingsError::Validation(format!(
                "'{}' is not a SQLite database file",
                relative_path
            )));
        }

        // Cap table count to prevent a crafted .db with thousands of tables
        // from producing a multi-gigabyte IPC payload.
        let table_names: Vec<_> = list_tables(&file_path)
            .map_err(|e| BindingsError::Validation(format!("Failed to list tables: {}", e)))?
            .into_iter()
            .take(MAX_SQLITE_TABLES)
            .collect();

        let mut tables = Vec::with_capacity(table_names.len());
        for name in &table_names {
            match read_custom_table_bounded(
                &file_path,
                name,
                MAX_SQLITE_ROWS_PER_TABLE,
                MAX_SQLITE_COLUMNS_PER_TABLE,
                MAX_SQLITE_CELL_BYTES,
                MAX_SQLITE_TEXT_BYTES_PER_TABLE,
            ) {
                Ok(info) => tables.push(info),
                Err(e) => {
                    tracing::warn!("Skipping table '{}': {}", name, e);
                }
            }
        }

        Ok::<_, BindingsError>(tables)
    })
}
