use super::*;
use std::io::{Read, Write};

fn assert_no_staging_files(skill_dir: &Path) {
    assert!(std::fs::read_dir(skill_dir).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".tracepilot-asset-")
    }));
}

struct FailingWriter<'a> {
    file: &'a mut std::fs::File,
    remaining: usize,
}

impl Write for FailingWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.remaining == 0 {
            return Err(std::io::Error::other("injected write failure"));
        }
        let count = self.file.write(&bytes[..bytes.len().min(self.remaining)])?;
        self.remaining -= count;
        Ok(count)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

#[test]
fn failed_write_removes_partial_staging_and_allows_retry() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let error = write_asset_file(&skill_dir, "retry.txt", None, |file| {
        FailingWriter { file, remaining: 4 }.write_all(b"partially written content")
    })
    .unwrap_err();
    assert!(error.to_string().contains("injected write failure"));
    assert!(!skill_dir.join("retry.txt").exists());
    assert_no_staging_files(&skill_dir);
    add_asset(&skill_dir, "retry.txt", b"complete").unwrap();
    assert_eq!(
        std::fs::read(skill_dir.join("retry.txt")).unwrap(),
        b"complete"
    );
}

struct FailingReader;

impl Read for FailingReader {
    fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
        Err(std::io::Error::other("injected read failure"))
    }
}

#[test]
fn failed_copy_removes_partial_staging_and_allows_retry() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let mut source = std::io::Cursor::new(b"copied prefix").chain(FailingReader);
    let error = write_asset_file(&skill_dir, "retry.py", None, |destination| {
        std::io::copy(&mut source, destination).map(|_| ())
    })
    .unwrap_err();
    assert!(error.to_string().contains("injected read failure"));
    assert!(!skill_dir.join("retry.py").exists());
    assert_no_staging_files(&skill_dir);
    copy_asset_from(&skill_dir, "retry.py", &skill_dir.join("helper.py")).unwrap();
    assert_eq!(
        std::fs::read(skill_dir.join("retry.py")).unwrap(),
        b"# python helper"
    );
}

#[test]
fn publication_collision_preserves_winner_and_removes_readonly_staging() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let mut permissions = std::fs::metadata(skill_dir.join("helper.py"))
        .unwrap()
        .permissions();
    permissions.set_readonly(true);
    let destination = skill_dir.join("winner.txt");
    let error = write_asset_file(&skill_dir, "winner.txt", Some(&permissions), |staged| {
        staged.write_all(b"loser")?;
        // A different request creates the destination after preflight.
        std::fs::write(&destination, b"winner")
    })
    .unwrap_err();
    assert!(error.to_string().contains("already exists"));
    assert_eq!(std::fs::read(&destination).unwrap(), b"winner");
    assert!(
        !std::fs::metadata(destination)
            .unwrap()
            .permissions()
            .readonly()
    );
    assert_no_staging_files(&skill_dir);
}
