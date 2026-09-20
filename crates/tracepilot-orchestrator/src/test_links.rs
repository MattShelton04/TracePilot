//! Portable directory links for tests, including unprivileged Windows runners.
use std::path::Path;

pub(crate) fn directory_link(target: &Path, link: &Path) {
    std::fs::create_dir_all(link.parent().unwrap()).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    if let Err(error) = std::os::windows::fs::symlink_dir(target, link) {
        if error.kind() != std::io::ErrorKind::PermissionDenied
            && error.raw_os_error() != Some(1314)
        {
            panic!("Unable to create directory link: {error}");
        }
        let output = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(link.to_string_lossy().replace('/', "\\"))
            .arg(target.to_string_lossy().replace('/', "\\"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Unable to create directory junction: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
