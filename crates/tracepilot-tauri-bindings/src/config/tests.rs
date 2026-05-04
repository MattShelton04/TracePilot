//! Unit tests for `config` split across sub-configs.

use super::*;

#[test]
fn current_version_matches_default() {
    let config = TracePilotConfig::default();
    assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
}

#[test]
fn migrate_v1_to_v3() {
    let mut config = TracePilotConfig {
        version: 1,
        ..TracePilotConfig::default()
    };
    assert!(config.migrate());
    assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
}

#[test]
fn migrate_current_version_is_noop() {
    let mut config = TracePilotConfig::default();
    assert!(!config.migrate());
    assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
}

#[test]
fn migrate_future_version_is_noop() {
    let mut config = TracePilotConfig {
        version: 999,
        ..TracePilotConfig::default()
    };
    assert!(!config.migrate());
    assert_eq!(config.version, 999);
}

#[test]
fn migrate_v0_bumps_through_all_versions() {
    let mut config = TracePilotConfig {
        version: 0,
        ..TracePilotConfig::default()
    };
    assert!(config.migrate());
    assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
}

#[test]
fn roundtrip_toml_serialization() {
    let config = TracePilotConfig::default();
    let toml_str = toml::to_string_pretty(&config).expect("serialize");
    let parsed: TracePilotConfig = toml::from_str(&toml_str).expect("deserialize");
    assert_eq!(parsed.version, config.version);
    assert_eq!(parsed.paths.index_db_path, config.paths.index_db_path);
}

#[test]
fn deserialize_missing_optional_sections_uses_defaults() {
    let minimal = r#"
        version = 2

        [paths]
        indexDbPath = "~/.copilot/tracepilot/index.db"
        sessionStateDir = "~/.copilot/tracepilot"
    "#;
    let config: TracePilotConfig = toml::from_str(minimal).expect("parse minimal config");
    assert_eq!(config.version, 2); // still v2 in TOML, migration upgrades it
    assert!(config.general.auto_index_on_launch);
    assert_eq!(config.ui.theme, "dark");
    assert!(config.features.render_markdown);
}

#[test]
fn pricing_model_entries_roundtrip_optional_metadata() {
    let toml = r#"
        version = 8

        [paths]
        copilotHome = "/custom/copilot"
        tracepilotHome = "/custom/tracepilot"
        indexDbPath = "/custom/tracepilot/index.db"
        sessionStateDir = "/custom/copilot/session-state"

        [pricing]
        costPerPremiumRequest = 0.04

        [[pricing.models]]
        model = "custom-model"
        aliases = ["Custom Model"]
        inputPerM = 1.0
        cachedInputPerM = 0.1
        cacheWritePerM = 0.2
        outputPerM = 2.0
        reasoningPerM = 3.0
        premiumRequests = 1.0
        source = "user"
        pricingKind = "usage-token-rate"
        effectiveFrom = "2026-06-01"
        sourceLabel = "Local settings override"
        status = "user-override"
    "#;

    let config: TracePilotConfig = toml::from_str(toml).expect("parse pricing metadata");
    let model = config.pricing.models.first().expect("pricing model");
    assert_eq!(model.aliases, vec!["Custom Model".to_string()]);
    assert_eq!(model.cache_write_per_m, Some(0.2));
    assert_eq!(model.reasoning_per_m, Some(3.0));
    assert_eq!(model.source.as_deref(), Some("user"));
    assert_eq!(model.effective_from.as_deref(), Some("2026-06-01"));

    let serialized = toml::to_string_pretty(&config).expect("serialize pricing metadata");
    assert!(serialized.contains("cacheWritePerM = 0.2"));
    assert!(serialized.contains("sourceLabel = \"Local settings override\""));
}

#[test]
fn default_pricing_uses_shared_published_token_rates() {
    let config = TracePilotConfig::default();
    let gpt_54_mini = config
        .pricing
        .models
        .iter()
        .find(|entry| entry.model == "gpt-5.4-mini")
        .expect("gpt-5.4-mini default price");

    assert_eq!(gpt_54_mini.input_per_m, 0.75);
    assert_eq!(gpt_54_mini.cached_input_per_m, 0.075);
    assert_eq!(gpt_54_mini.output_per_m, 4.5);
    assert_eq!(gpt_54_mini.source.as_deref(), Some("provider-wholesale"));
    assert_eq!(gpt_54_mini.status.as_deref(), Some("official"));
}

#[test]
fn deserialize_v1_config_and_migrate() {
    let v1_toml = r#"
        version = 1

        [paths]
        indexDbPath = "/custom/path/index.db"
        sessionStateDir = "/custom/path"

        [ui]
        theme = "light"
    "#;
    let mut config: TracePilotConfig = toml::from_str(v1_toml).expect("parse v1 config");
    assert_eq!(config.version, 1);
    assert!(config.migrate());
    assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
    assert_eq!(
        config.paths.index_db_path,
        std::path::PathBuf::from("/custom/path")
            .join("index.db")
            .to_string_lossy()
    );
    assert_eq!(config.paths.tracepilot_home, "/custom/path");
    assert_eq!(config.paths.session_state_dir, "/custom/path");
    assert_eq!(config.ui.theme, "light");
    // New v2 field gets default value
    assert!(config.features.render_markdown);
}

#[test]
fn migrate_v6_derives_index_db_from_tracepilot_home() {
    let v5_toml = r#"
        version = 5

        [paths]
        copilotHome = "/custom/copilot"
        indexDbPath = "/custom/tracepilot/legacy-name.sqlite"
        sessionStateDir = "/custom/sessions"
    "#;
    let mut config: TracePilotConfig = toml::from_str(v5_toml).expect("parse v5 config");
    assert!(config.migrate());
    assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
    assert_eq!(config.paths.copilot_home, "/custom/copilot");
    assert_eq!(config.paths.tracepilot_home, "/custom/tracepilot");
    assert_eq!(
        config.paths.index_db_path,
        std::path::PathBuf::from("/custom/tracepilot")
            .join("index.db")
            .to_string_lossy()
    );
    assert_eq!(config.paths.session_state_dir, "/custom/sessions");
    assert_eq!(
        config.session_state_dir(),
        std::path::PathBuf::from("/custom/sessions")
    );
}

#[test]
fn normalize_paths_derives_empty_session_dir_from_copilot_home() {
    let mut config = TracePilotConfig::default();
    config.paths.copilot_home = std::path::PathBuf::from("/custom/copilot")
        .to_string_lossy()
        .to_string();
    config.paths.session_state_dir.clear();
    config.normalize_paths();

    assert_eq!(
        config.paths.session_state_dir,
        std::path::PathBuf::from("/custom/copilot")
            .join("session-state")
            .to_string_lossy()
    );
}

#[test]
fn normalize_paths_fills_empty_homes_and_syncs_index_db() {
    let dir = tempfile::tempdir().unwrap();
    let tracepilot_home = dir.path().join("tracepilot-data");
    let mut config = TracePilotConfig::default();
    config.paths.tracepilot_home = tracepilot_home.to_string_lossy().to_string();
    config.paths.index_db_path = dir
        .path()
        .join("old")
        .join("file.db")
        .to_string_lossy()
        .to_string();
    config.normalize_paths();

    assert_eq!(
        config.paths.tracepilot_home,
        tracepilot_home.to_string_lossy()
    );
    assert_eq!(
        config.paths.index_db_path,
        tracepilot_home.join("index.db").to_string_lossy()
    );
    assert_eq!(
        config.paths.session_state_dir,
        tracepilot_core::paths::CopilotPaths::from_home(&config.paths.copilot_home)
            .session_state_dir()
            .to_string_lossy()
    );
}

// ── File I/O tests (use tempfile) ──────────────────────────────

#[test]
fn save_to_load_from_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");

    let config = TracePilotConfig::default();
    config.save_to(&path).expect("save_to should succeed");

    let loaded = TracePilotConfig::load_from(&path).expect("load_from should succeed");
    assert_eq!(loaded.version, config.version);
    assert_eq!(
        loaded.paths.session_state_dir,
        config.paths.session_state_dir
    );
    assert_eq!(loaded.paths.index_db_path, config.paths.index_db_path);
    assert_eq!(loaded.ui.theme, config.ui.theme);
    assert_eq!(
        loaded.pricing.cost_per_premium_request,
        config.pricing.cost_per_premium_request
    );
}

#[test]
fn save_to_creates_parent_directories() {
    let dir = tempfile::tempdir().unwrap();
    let nested = dir.path().join("a").join("b").join("c").join("config.toml");

    let config = TracePilotConfig::default();
    config
        .save_to(&nested)
        .expect("save_to should create parent dirs");

    assert!(nested.exists());
    let loaded = TracePilotConfig::load_from(&nested).expect("load_from nested path");
    assert_eq!(loaded.version, config.version);
}

#[test]
fn save_to_preserves_user_settings_through_io() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");

    let mut config = TracePilotConfig::default();
    config.ui.theme = "midnight-aurora".to_string();
    config.ui.check_for_updates = false;
    config.pricing.cost_per_premium_request = 0.08;
    config.features.export_view = true;
    config.general.cli_command = "gh-copilot".to_string();

    config.save_to(&path).expect("save");
    let loaded = TracePilotConfig::load_from(&path).expect("load");

    assert_eq!(loaded.ui.theme, "midnight-aurora");
    assert!(!loaded.ui.check_for_updates);
    assert_eq!(loaded.pricing.cost_per_premium_request, 0.08);
    assert!(loaded.features.export_view);
    assert_eq!(loaded.general.cli_command, "gh-copilot");
}

#[test]
fn save_to_overwrites_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");

    let mut config = TracePilotConfig::default();
    config.save_to(&path).expect("initial save");

    config.ui.theme = "arctic".to_string();
    config.save_to(&path).expect("overwrite save");

    let loaded = TracePilotConfig::load_from(&path).expect("load after overwrite");
    assert_eq!(loaded.ui.theme, "arctic");
}

#[test]
fn default_pricing_models_match_available_models() {
    let pricing = super::defaults::default_model_prices();
    let available = tracepilot_orchestrator::launcher::available_models();

    let pricing_ids: Vec<_> = pricing.iter().map(|entry| entry.model.as_str()).collect();
    let available_ids: Vec<_> = available.iter().map(|entry| entry.id.as_str()).collect();

    assert_eq!(pricing_ids, available_ids);
}

#[test]
fn load_from_nonexistent_file_returns_io_error() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("does_not_exist.toml");

    let err = TracePilotConfig::load_from(&missing).unwrap_err();
    assert!(
        matches!(err, BindingsError::Io(_)),
        "expected Io error, got: {err:?}"
    );
}

#[test]
fn load_from_empty_file_returns_toml_error() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("empty.toml");
    std::fs::write(&path, "").unwrap();

    let err = TracePilotConfig::load_from(&path).unwrap_err();
    assert!(
        matches!(err, BindingsError::TomlDeserialize(_)),
        "expected TomlDeserialize error, got: {err:?}"
    );
}

#[test]
fn load_from_corrupt_toml_returns_toml_error() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("corrupt.toml");
    std::fs::write(&path, "this is not {{valid}} toml!!!").unwrap();

    let err = TracePilotConfig::load_from(&path).unwrap_err();
    assert!(
        matches!(err, BindingsError::TomlDeserialize(_)),
        "expected TomlDeserialize error, got: {err:?}"
    );
}

#[test]
fn load_from_wrong_schema_returns_toml_error() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("wrong_schema.toml");
    // version should be u32, paths.sessionStateDir should be string
    std::fs::write(
        &path,
        r#"
        version = "not_a_number"

        [paths]
        sessionStateDir = 42
        indexDbPath = true
    "#,
    )
    .unwrap();

    let err = TracePilotConfig::load_from(&path).unwrap_err();
    assert!(
        matches!(err, BindingsError::TomlDeserialize(_)),
        "expected TomlDeserialize error, got: {err:?}"
    );
}

#[test]
fn migration_through_file_io_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");

    // Write a v1 config directly to disk
    let v1_toml = r#"
        version = 1

        [paths]
        indexDbPath = "/test/index.db"
        sessionStateDir = "/test/sessions"

        [ui]
        theme = "solar-flare"
    "#;
    std::fs::write(&path, v1_toml).unwrap();

    // Load, migrate, save
    let mut config = TracePilotConfig::load_from(&path).expect("load v1");
    assert_eq!(config.version, 1);
    assert!(config.migrate());
    assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
    config.save_to(&path).expect("save migrated");

    // Reload and verify migration persisted
    let reloaded = TracePilotConfig::load_from(&path).expect("reload");
    assert_eq!(reloaded.version, TracePilotConfig::CURRENT_VERSION);
    assert_eq!(reloaded.ui.theme, "solar-flare");
    assert_eq!(
        reloaded.paths.index_db_path,
        std::path::PathBuf::from("/test")
            .join("index.db")
            .to_string_lossy()
    );
    assert_eq!(reloaded.paths.session_state_dir, "/test/sessions");
    // v2 default applied
    assert!(reloaded.features.render_markdown);
}
