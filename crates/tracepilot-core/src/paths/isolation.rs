//! Process-wide application-data isolation for automation and benchmarks.

use std::path::{Component, Path, PathBuf};

use thiserror::Error;

pub const TRACEPILOT_DATA_ROOT_ENV: &str = "TRACEPILOT_DATA_ROOT";

/// Invalid process-wide application-data isolation configuration.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DataRootError {
    #[error("{TRACEPILOT_DATA_ROOT_ENV} must be an absolute path: {0}")]
    Relative(PathBuf),
    #[error("{TRACEPILOT_DATA_ROOT_ENV} must not contain '.' or '..' components: {0}")]
    Traversal(PathBuf),
    #[error("{TRACEPILOT_DATA_ROOT_ENV} must not be a filesystem root: {0}")]
    FilesystemRoot(PathBuf),
}

/// Return the optional process-wide isolation boundary.
///
/// When present, this path replaces all user-home-derived TracePilot and
/// Copilot defaults. Invalid values never fall back to the real user home.
pub fn isolated_data_root() -> Result<Option<PathBuf>, DataRootError> {
    let Some(raw) = std::env::var_os(TRACEPILOT_DATA_ROOT_ENV) else {
        return Ok(None);
    };
    let root = PathBuf::from(raw);
    validate_data_root(&root)?;
    Ok(Some(root))
}

pub fn validate_data_root(root: &Path) -> Result<(), DataRootError> {
    if !root.is_absolute() {
        return Err(DataRootError::Relative(root.to_path_buf()));
    }
    if root
        .components()
        .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(DataRootError::Traversal(root.to_path_buf()));
    }
    if root.parent().is_none() {
        return Err(DataRootError::FilesystemRoot(root.to_path_buf()));
    }
    Ok(())
}

pub fn path_is_within_data_root(root: &Path, candidate: &Path) -> bool {
    if !candidate.is_absolute()
        || candidate
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
        || !path_has_root_prefix(root, candidate)
    {
        return false;
    }

    if root.exists() {
        let Ok(metadata) = root.symlink_metadata() else {
            return false;
        };
        if metadata_is_redirect(&metadata) {
            return false;
        }
    }
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let relative = candidate
        .components()
        .skip(root.components().count())
        .collect::<PathBuf>();
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        if current.exists() {
            let Ok(metadata) = current.symlink_metadata() else {
                return false;
            };
            if metadata_is_redirect(&metadata) {
                return false;
            }
            let Ok(canonical) = current.canonicalize() else {
                return false;
            };
            if !canonical.starts_with(&canonical_root) {
                return false;
            }
        }
    }
    true
}

#[cfg(not(windows))]
fn path_has_root_prefix(root: &Path, candidate: &Path) -> bool {
    candidate.starts_with(root)
}

#[cfg(windows)]
fn path_has_root_prefix(root: &Path, candidate: &Path) -> bool {
    let root = root
        .to_string_lossy()
        .trim_end_matches(|character| character == '\\' || character == '/')
        .to_lowercase();
    let candidate = candidate.to_string_lossy().to_lowercase();
    candidate == root
        || candidate
            .strip_prefix(&root)
            .is_some_and(|suffix| suffix.starts_with('\\') || suffix.starts_with('/'))
}

fn metadata_is_redirect(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{
        CopilotPaths, TRACEPILOT_INDEX_DB_FILE, TracePilotPaths, default_copilot_home,
        default_copilot_home_opt, default_index_db_path, default_session_state_dir,
        default_tracepilot_root,
    };

    #[test]
    fn isolated_layout_keeps_copilot_and_tracepilot_data_under_one_boundary() {
        let root = if cfg!(windows) {
            Path::new(r"C:\tracepilot-benchmark")
        } else {
            Path::new("/var/tmp/tracepilot-benchmark")
        };
        validate_data_root(root).unwrap();

        let copilot = CopilotPaths::from_home(root.join("copilot"));
        let tracepilot = TracePilotPaths::from_root(root.join("tracepilot"));
        let session_state = copilot.session_state_dir();
        let index_db = tracepilot.index_db();

        assert_eq!(session_state, root.join("copilot/session-state"));
        assert_eq!(
            tracepilot.config_toml(),
            root.join("tracepilot/config.toml")
        );
        assert_eq!(index_db, root.join("tracepilot/index.db"));
        for path in [
            copilot.home(),
            session_state.as_path(),
            tracepilot.root(),
            index_db.as_path(),
        ] {
            assert!(path_is_within_data_root(root, path));
        }
    }

    #[test]
    fn isolation_boundary_rejects_relative_root_and_parent_traversal() {
        assert!(matches!(
            validate_data_root(Path::new("relative/data")),
            Err(DataRootError::Relative(_))
        ));
        let root = if cfg!(windows) {
            PathBuf::from(r"C:\tracepilot\..\outside")
        } else {
            PathBuf::from("/tmp/tracepilot/../outside")
        };
        assert!(matches!(
            validate_data_root(&root),
            Err(DataRootError::Traversal(_))
        ));
    }

    #[test]
    fn path_boundary_rejects_relative_and_escaping_candidates() {
        let root = if cfg!(windows) {
            Path::new(r"C:\isolated")
        } else {
            Path::new("/isolated")
        };
        let inside = root.join("tracepilot/index.db");
        let escaped = root.join("tracepilot/../../real/index.db");
        assert!(path_is_within_data_root(root, &inside));
        assert!(!path_is_within_data_root(
            root,
            Path::new("relative/index.db")
        ));
        assert!(!path_is_within_data_root(root, &escaped));
    }

    #[test]
    fn env_unset_preserves_legacy_user_home_defaults() {
        if std::env::var_os(TRACEPILOT_DATA_ROOT_ENV).is_some() {
            return;
        }
        let user_home = crate::utils::home_dir();
        let copilot = CopilotPaths::from_user_home(&user_home);
        let tracepilot = copilot.tracepilot();

        assert_eq!(default_copilot_home(), copilot.home());
        assert_eq!(default_copilot_home_opt().as_deref(), Some(copilot.home()));
        assert_eq!(default_session_state_dir(), copilot.session_state_dir());
        assert_eq!(default_tracepilot_root(), tracepilot.root());
        assert_eq!(default_index_db_path(), tracepilot.index_db());
    }

    #[test]
    fn path_boundary_rejects_redirected_existing_component() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("isolated");
        let outside = temp.path().join("outside");
        let redirected = root.join("tracepilot");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        #[cfg(windows)]
        if let Err(error) = std::os::windows::fs::symlink_dir(&outside, &redirected) {
            const ERROR_PRIVILEGE_NOT_HELD: i32 = 1314;
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.raw_os_error() == Some(ERROR_PRIVILEGE_NOT_HELD)
            {
                let status = std::process::Command::new("cmd.exe")
                    .args(["/d", "/c", "mklink", "/J"])
                    .arg(&redirected)
                    .arg(&outside)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                    .unwrap();
                assert!(status.success(), "failed to create test junction");
            } else {
                panic!("failed to create test directory link: {error}");
            }
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &redirected).unwrap();

        assert!(!path_is_within_data_root(
            &root,
            &redirected.join(TRACEPILOT_INDEX_DB_FILE)
        ));
    }
}
