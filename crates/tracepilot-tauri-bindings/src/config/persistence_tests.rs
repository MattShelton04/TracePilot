use super::*;

#[test]
fn save_to_keeps_last_known_good_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");

    let mut first = TracePilotConfig::default();
    first.ui.theme = "light".to_string();
    first.save_to(&path).unwrap();

    let mut second = first.clone();
    second.ui.theme = "dark".to_string();
    second.save_to(&path).unwrap();

    let current = TracePilotConfig::load_from(&path).unwrap();
    let backup = TracePilotConfig::load_from(&config_backup_file_path(&path)).unwrap();
    assert_eq!(current.ui.theme, "dark");
    assert_eq!(backup.ui.theme, "light");
}

#[test]
fn load_falls_back_to_backup_without_overwriting_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    let backup_path = config_backup_file_path(&path);

    let mut expected = TracePilotConfig::default();
    expected.ui.theme = "light".to_string();
    std::fs::write(&path, "not valid TOML = [").unwrap();
    std::fs::write(&backup_path, toml::to_string_pretty(&expected).unwrap()).unwrap();

    let (recovered, from_backup) = TracePilotConfig::load_from_or_backup(&path).unwrap();

    assert!(from_backup);
    assert_eq!(recovered.ui.theme, "light");
    assert_eq!(
        TracePilotConfig::load_from(&backup_path).unwrap().ui.theme,
        "light"
    );
}

#[test]
fn save_to_preserves_good_backup_when_current_file_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    let backup_path = config_backup_file_path(&path);

    let mut backup = TracePilotConfig::default();
    backup.ui.theme = "light".to_string();
    std::fs::write(&backup_path, toml::to_string_pretty(&backup).unwrap()).unwrap();
    std::fs::write(&path, "not valid TOML = [").unwrap();

    let mut replacement = TracePilotConfig::default();
    replacement.ui.theme = "dark".to_string();
    replacement.save_to(&path).unwrap();

    assert_eq!(TracePilotConfig::load_from(&path).unwrap().ui.theme, "dark");
    assert_eq!(
        TracePilotConfig::load_from(&backup_path).unwrap().ui.theme,
        "light"
    );
}
