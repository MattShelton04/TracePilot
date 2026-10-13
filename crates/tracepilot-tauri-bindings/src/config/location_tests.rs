//! Where `config.toml` lives for new and legacy installs, resolved against a
//! temporary home so the real one is never touched.

use super::*;
use tracepilot_core::paths::{CopilotPaths, TracePilotPaths, resolve_tracepilot_root};

/// What [`config_file_path`] resolves to for `home` when `COPILOT_HOME` is unset.
fn resolved(home: &Path) -> TracePilotPaths {
    resolve_tracepilot_root(Some(home), Some(&home.join(".copilot")), Path::exists).unwrap()
}

/// A config as an existing install wrote it, in the legacy folder.
fn write_legacy_config(home: &Path) -> TracePilotPaths {
    let copilot = CopilotPaths::from_user_home(home);
    let legacy = copilot.tracepilot();
    let mut config = TracePilotConfig::with_roots(&copilot, &legacy);
    config.general.setup_complete = true;
    config.save_to(&legacy.config_toml()).unwrap();
    legacy
}

#[test]
fn legacy_config_loads_and_saves_back_to_the_legacy_path() {
    let home = tempfile::tempdir().unwrap();
    let legacy = write_legacy_config(home.path());

    let path = resolved(home.path()).config_toml();
    assert_eq!(path, legacy.config_toml());
    let mut loaded = TracePilotConfig::load_at(&path).unwrap();
    assert_eq!(loaded.tracepilot_home(), legacy.root());

    loaded.ui.theme = "light".into();
    loaded
        .save_at(&resolved(home.path()).config_toml())
        .unwrap();
    let saved = TracePilotConfig::load_from(&legacy.config_toml()).unwrap();
    assert_eq!(saved.ui.theme, "light");
    assert!(!home.path().join(".tracepilot").exists());
}

#[test]
fn legacy_backup_alone_is_recovered_in_the_legacy_folder() {
    let home = tempfile::tempdir().unwrap();
    let legacy = write_legacy_config(home.path());
    // A second save leaves the first as the backup; then lose the main file.
    TracePilotConfig::load_from(&legacy.config_toml())
        .unwrap()
        .save_to(&legacy.config_toml())
        .unwrap();
    std::fs::remove_file(legacy.config_toml()).unwrap();

    let path = resolved(home.path()).config_toml();
    assert_eq!(path, legacy.config_toml());
    assert!(TracePilotConfig::load_at(&path).is_some());
    assert!(legacy.config_toml().exists());
    assert!(!home.path().join(".tracepilot").exists());
}

#[test]
fn fresh_default_config_uses_the_new_folder() {
    let home = tempfile::tempdir().unwrap();
    let resolved = resolved(home.path());
    let config =
        TracePilotConfig::with_roots(&CopilotPaths::from_user_home(home.path()), &resolved);

    let new_root = home.path().join(".tracepilot");
    assert_eq!(resolved.config_toml(), new_root.join("config.toml"));
    assert_eq!(config.tracepilot_home(), new_root);
    assert_eq!(config.index_db_path(), new_root.join("index.db"));
    assert_eq!(
        config.copilot_home(),
        home.path().join(".copilot"),
        "the Copilot home is unchanged"
    );
}
