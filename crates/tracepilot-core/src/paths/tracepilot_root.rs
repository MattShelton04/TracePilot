//! Where TracePilot's own folder lives on this machine.
//!
//! New installs use `~/.tracepilot`. Installs made before that default changed
//! keep `<COPILOT_HOME or ~/.copilot>/tracepilot`, recognised by the
//! `config.toml` (or `config.toml.bak`) already there. Nothing is moved, copied
//! or deleted between the two.

use std::path::{Path, PathBuf};

use super::{COPILOT_DIR_NAME, TRACEPILOT_DIR_NAME, TracePilotPaths, cli_install};

/// Pick the TracePilot root from a user home and the legacy Copilot home:
///
/// 1. `<home>/.tracepilot` if it holds `config.toml` or `config.toml.bak`;
/// 2. otherwise `<legacy copilot home>/tracepilot` if it holds either (an
///    existing install keeps its folder for the config and as the default);
/// 3. otherwise `<home>/.tracepilot` (a fresh install, or after a factory reset).
///
/// `exists` is injected so tests never look at the real home folder.
pub fn resolve_tracepilot_root(
    user_home: Option<&Path>,
    legacy_copilot_home: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
) -> Option<TracePilotPaths> {
    let has_config = |paths: &TracePilotPaths| {
        exists(&paths.config_toml()) || exists(&paths.config_toml_backup())
    };
    let current = user_home.map(TracePilotPaths::from_user_home);
    let legacy = legacy_copilot_home.map(TracePilotPaths::from_copilot_home);
    if current.as_ref().is_some_and(has_config) {
        return current;
    }
    if legacy.as_ref().is_some_and(has_config) {
        return legacy;
    }
    // Without a user home, the legacy shape is the only one left.
    current.or(legacy)
}

/// [`resolve_tracepilot_root`] behind the optional isolation root, which wins
/// outright and keeps its `<data root>/tracepilot` layout.
fn resolve_with_isolation(
    isolated_root: Option<&Path>,
    user_home: Option<&Path>,
    legacy_copilot_home: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
) -> Option<TracePilotPaths> {
    match isolated_root {
        Some(root) => Some(TracePilotPaths::from_root(root.join(TRACEPILOT_DIR_NAME))),
        None => resolve_tracepilot_root(user_home, legacy_copilot_home, exists),
    }
}

/// The root for this process, read from the environment and the disk on every
/// call. Not cached, so a factory reset followed by setup in the same run
/// lands in `~/.tracepilot`.
pub(super) fn current_tracepilot_root(isolated_root: Option<&Path>) -> Option<TracePilotPaths> {
    let home = crate::utils::home_dir_opt();
    // COPILOT_HOME only locates the legacy folder; it never moves a new one.
    let legacy: Option<PathBuf> = cli_install::copilot_home_override()
        .or_else(|| home.as_ref().map(|home| home.join(COPILOT_DIR_NAME)));
    resolve_with_isolation(
        isolated_root,
        home.as_deref(),
        legacy.as_deref(),
        Path::exists,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn home() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Users\alice")
        } else {
            PathBuf::from("/home/alice")
        }
    }

    fn resolve(legacy: &Path, files: &[PathBuf]) -> PathBuf {
        let files: HashSet<_> = files.iter().cloned().collect();
        resolve_tracepilot_root(Some(&home()), Some(legacy), |path| files.contains(path))
            .unwrap()
            .root()
            .to_path_buf()
    }

    #[test]
    fn fresh_install_uses_the_new_folder() {
        let legacy = home().join(".copilot");
        assert_eq!(resolve(&legacy, &[]), home().join(".tracepilot"));
    }

    #[test]
    fn legacy_config_keeps_the_legacy_folder() {
        let legacy = home().join(".copilot");
        let config = legacy.join("tracepilot/config.toml");
        assert_eq!(resolve(&legacy, &[config]), legacy.join("tracepilot"));
    }

    #[test]
    fn legacy_backup_alone_keeps_the_legacy_folder() {
        let legacy = home().join(".copilot");
        let backup = legacy.join("tracepilot/config.toml.bak");
        assert_eq!(resolve(&legacy, &[backup]), legacy.join("tracepilot"));
    }

    #[test]
    fn new_folder_wins_when_both_have_a_config() {
        let legacy = home().join(".copilot");
        let files = [
            legacy.join("tracepilot/config.toml"),
            home().join(".tracepilot/config.toml.bak"),
        ];
        assert_eq!(resolve(&legacy, &files), home().join(".tracepilot"));
    }

    #[test]
    fn legacy_folder_moved_by_copilot_home_is_still_found() {
        let moved = home().join("elsewhere/copilot");
        let config = moved.join("tracepilot/config.toml");
        assert_eq!(resolve(&moved, &[config]), moved.join("tracepilot"));
        // An unmoved ~/.copilot is ignored once COPILOT_HOME points elsewhere.
        let unmoved = home().join(".copilot/tracepilot/config.toml");
        assert_eq!(resolve(&moved, &[unmoved]), home().join(".tracepilot"));
    }

    #[test]
    fn without_a_user_home_the_legacy_shape_remains() {
        let legacy = home().join("copilot");
        let resolved = resolve_tracepilot_root(None, Some(&legacy), |_| false).unwrap();
        assert_eq!(resolved.root(), legacy.join("tracepilot"));
        assert!(resolve_tracepilot_root(None, None, |_| true).is_none());
    }

    #[test]
    fn isolation_is_unaffected_by_either_home() {
        let root = home().join("isolated");
        let legacy = home().join(".copilot");
        let resolved =
            resolve_with_isolation(Some(&root), Some(&home()), Some(&legacy), |_| true).unwrap();
        assert_eq!(resolved.root(), root.join("tracepilot"));
        assert_eq!(resolved.config_toml(), root.join("tracepilot/config.toml"));
    }
}
