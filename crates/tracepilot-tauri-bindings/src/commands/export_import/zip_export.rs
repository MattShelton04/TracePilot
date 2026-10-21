//! Tauri command for exporting a session folder as a raw zip archive.

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};

use tracepilot_export::ExportError;

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::{require_copilot_layout, with_session_locator};

/// Export a session folder as a raw zip archive.
///
/// All files in the session directory are zipped verbatim using Deflate
/// compression and written to `dest_path`.
#[tauri::command]
#[tracing::instrument(skip_all, err, fields(%session_id))]
pub async fn export_session_folder_zip(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    dest_path: String,
) -> CmdResult<()> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, move |session| {
        require_copilot_layout(&session, "Folder export")?;
        write_folder_zip(&session.locator.primary_path, Path::new(&dest_path))
    })
    .await
}

/// Zip `session_path` into `dest`.
///
/// The archive is written beside `dest` under a temporary name and moved into
/// place only once it is complete, so a failure leaves no truncated zip and
/// keeps a file the user chose to overwrite. Only that temporary file, which
/// this call created, is removed on failure.
fn write_folder_zip(session_path: &Path, dest: &Path) -> CmdResult<()> {
    tracepilot_core::utils::fs::ensure_parent_dir(dest)?;
    let partial = partial_path(dest);
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)
        .map_err(|e| ExportError::io(dest, e))?;

    let result = zip_folder(session_path, file).and_then(|()| {
        std::fs::rename(&partial, dest).map_err(|e| ExportError::io(dest, e).into())
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    result
}

/// A hidden sibling of `dest`, unique to this process.
fn partial_path(dest: &Path) -> PathBuf {
    let name = dest.file_name().unwrap_or_default().to_string_lossy();
    dest.with_file_name(format!(".{name}.{}.partial", std::process::id()))
}

/// Write every entry under `session_path` into `file`. A source file that
/// can't be read is named in the error.
fn zip_folder(session_path: &Path, file: File) -> CmdResult<()> {
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for entry in walkdir::WalkDir::new(session_path).follow_links(false) {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(session_path)?;

        if relative == Path::new("") {
            continue;
        }

        let zip_name = relative.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(&zip_name, options)?;
        } else {
            zip.start_file(&zip_name, options)?;
            let mut f = File::open(path).map_err(|e| ExportError::io(path, e))?;
            std::io::copy(&mut f, &mut zip).map_err(|e| ExportError::io(path, e))?;
        }
    }

    // Close the file before it is renamed into place.
    drop(zip.finish()?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::BindingsError;

    fn session_dir(root: &Path) -> PathBuf {
        let session = root.join("session");
        std::fs::create_dir_all(session.join("checkpoints")).unwrap();
        std::fs::write(session.join("events.jsonl"), "{}\n").unwrap();
        std::fs::write(session.join("checkpoints").join("001.md"), "# One").unwrap();
        session
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".partial"))
            .collect()
    }

    #[test]
    fn zips_the_session_folder() {
        let dir = tempfile::tempdir().unwrap();
        let session = session_dir(dir.path());
        let dest = dir.path().join("out").join("session.zip");

        write_folder_zip(&session, &dest).unwrap();

        let mut archive = zip::ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        let mut names: Vec<_> = archive.file_names().map(str::to_string).collect();
        names.sort();
        assert_eq!(
            names,
            ["checkpoints/", "checkpoints/001.md", "events.jsonl"]
        );
        let mut events = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("events.jsonl").unwrap(), &mut events)
            .unwrap();
        assert_eq!(events, "{}\n");
        assert!(leftovers(dest.parent().unwrap()).is_empty());
    }

    #[test]
    fn overwrites_an_existing_zip() {
        let dir = tempfile::tempdir().unwrap();
        let session = session_dir(dir.path());
        let dest = dir.path().join("session.zip");
        std::fs::write(&dest, "old").unwrap();

        write_folder_zip(&session, &dest).unwrap();

        let archive = zip::ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        assert_eq!(archive.len(), 3);
    }

    #[test]
    fn failure_leaves_no_partial_zip_and_keeps_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("gone");
        let new_dest = dir.path().join("new.zip");
        let kept_dest = dir.path().join("kept.zip");
        std::fs::write(&kept_dest, "earlier export").unwrap();

        assert!(write_folder_zip(&missing, &new_dest).is_err());
        assert!(write_folder_zip(&missing, &kept_dest).is_err());

        assert!(!new_dest.exists(), "a truncated zip was left behind");
        assert_eq!(
            std::fs::read_to_string(&kept_dest).unwrap(),
            "earlier export"
        );
        assert!(leftovers(dir.path()).is_empty());
    }

    /// A file another process holds open without sharing (as a running
    /// session can) is named in the error.
    #[cfg(windows)]
    #[test]
    fn unreadable_source_file_is_named() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = tempfile::tempdir().unwrap();
        let session = session_dir(dir.path());
        let locked = session.join("session.db");
        std::fs::write(&locked, "db").unwrap();
        let _held = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&locked)
            .unwrap();
        let dest = dir.path().join("session.zip");

        let err = write_folder_zip(&session, &dest).unwrap_err();

        assert!(matches!(err, BindingsError::Export(_)), "{err:?}");
        assert!(err.to_string().contains("session.db"), "{err}");
        assert!(!dest.exists());
        assert!(leftovers(dir.path()).is_empty());
    }
}
