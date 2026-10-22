//! Export writes that replace a file only once the new content is complete.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use tracepilot_export::ExportError;

use crate::error::CmdResult;

/// Create `dest` (and its folder) from what `write` puts in a file.
///
/// The content goes to a temporary sibling first and is moved over `dest`
/// only once `write` succeeds, so a failure (a full disk, a locked file)
/// leaves no truncated output and keeps a file the user chose to overwrite.
/// Only that temporary file, which this call created, is removed on failure.
/// Every I/O failure names `dest`.
pub(super) fn replace_file_with(
    dest: &Path,
    write: impl FnOnce(File) -> CmdResult<()>,
) -> CmdResult<()> {
    tracepilot_core::utils::fs::ensure_parent_dir(dest).map_err(|e| ExportError::io(dest, e))?;
    let partial = partial_path(dest);
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)
        .map_err(|e| ExportError::io(dest, e))?;

    // `write` owns the file, so it is closed before the rename.
    let result = write(file).and_then(|()| {
        std::fs::rename(&partial, dest).map_err(|e| ExportError::io(dest, e).into())
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    result
}

/// [`replace_file_with`] for content already in memory.
pub(super) fn replace_file(dest: &Path, content: &[u8]) -> CmdResult<()> {
    replace_file_with(dest, |mut file| {
        file.write_all(content)
            .and_then(|()| file.flush())
            .map_err(|e| ExportError::io(dest, e).into())
    })
}

/// A dot-prefixed sibling of `dest` (hidden on Unix), unique to this process.
fn partial_path(dest: &Path) -> PathBuf {
    let name = dest.file_name().unwrap_or_default().to_string_lossy();
    dest.with_file_name(format!(".{name}.{}.partial", std::process::id()))
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::error::BindingsError;

    /// Temporary files left in `dir` by a write.
    pub(in crate::commands::export_import) fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".partial"))
            .collect()
    }

    #[test]
    fn creates_the_folder_and_replaces_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("nested").join("out.md");

        replace_file(&dest, b"first").unwrap();
        replace_file(&dest, b"second").unwrap();

        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "second");
        assert!(leftovers(dest.parent().unwrap()).is_empty());
    }

    #[test]
    fn failed_write_keeps_the_earlier_file() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.md");
        std::fs::write(&dest, "earlier export").unwrap();

        let err = replace_file_with(&dest, |_file| {
            Err(ExportError::io(&dest, std::io::Error::other("disk full")).into())
        })
        .unwrap_err();

        assert!(err.to_string().contains("disk full"), "{err}");
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "earlier export");
        assert!(leftovers(dir.path()).is_empty());
    }

    #[test]
    fn unusable_folder_is_named() {
        let dir = tempfile::tempdir().unwrap();
        // A file where the folder should be makes creating the folder fail.
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, "").unwrap();
        let dest = blocker.join("out.md");

        let err = replace_file(&dest, b"content").unwrap_err();

        assert!(matches!(err, BindingsError::Export(_)), "{err:?}");
        assert!(err.to_string().contains("out.md"), "{err}");
    }

    /// A destination another process holds open without sharing (an editor,
    /// a sync client) fails with its name and keeps its content.
    #[cfg(windows)]
    #[test]
    fn locked_destination_is_named_and_kept() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("locked.md");
        std::fs::write(&dest, "earlier export").unwrap();
        let held = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&dest)
            .unwrap();

        let err = replace_file(&dest, b"new").unwrap_err();
        drop(held);

        assert!(err.to_string().contains("locked.md"), "{err}");
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "earlier export");
        assert!(leftovers(dir.path()).is_empty());
    }
}
