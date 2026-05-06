//! Tauri command for exporting a session folder as a raw zip archive.

use std::path::{Path, PathBuf};

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::with_session_path;

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
    with_session_path(&state, sid, move |session_path| {
        let dest = PathBuf::from(&dest_path);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let file = std::fs::File::create(&dest)?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for entry in walkdir::WalkDir::new(&session_path).follow_links(false) {
            let entry = entry?;
            let path = entry.path();
            let relative = path.strip_prefix(&session_path)?;

            if relative == Path::new("") {
                continue;
            }

            let zip_name = relative.to_string_lossy().replace('\\', "/");

            if path.is_dir() {
                zip.add_directory(&zip_name, options)?;
            } else {
                zip.start_file(&zip_name, options)?;
                let mut f = std::fs::File::open(path)?;
                std::io::copy(&mut f, &mut zip)?;
            }
        }

        zip.finish()?;

        Ok(())
    })
    .await
}
