//! Claude Code's transcript retention (`cleanupPeriodDays`), read and raised
//! from the notice in Settings → Claude Code. Only the user `settings.json`
//! in the configured Claude Code folder is read or written. Project and
//! managed settings, which take precedence over it, are not. Nothing else
//! from the file is returned or logged.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use tracepilot_orchestrator::OrchestratorError;
use tracepilot_orchestrator::config_injector::raise_claude_cleanup_period as raise_in_file;

use crate::blocking_cmd;
use crate::config::{SharedConfig, canonical_claude_config_dir};
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{has_local_root, read_config};

const SETTINGS_FILE: &str = "settings.json";
/// Larger files aren't parsed; a user settings file is a few KiB.
const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;

/// What the user settings file says about `cleanupPeriodDays`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeCleanupPeriodState {
    /// A whole number of days, which may be below Claude Code's minimum of 1.
    Set,
    /// The file doesn't set it, so Claude Code's default applies.
    NotSet,
    /// The folder has no settings file.
    NoFile,
    /// The configured folder is missing, relative, a network share or blank,
    /// so nothing was read.
    FolderInvalid,
    /// The file couldn't be read as a JSON object: unreadable, too large or malformed.
    FileInvalid,
    /// It is set to something other than a non-negative whole number.
    ValueInvalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCleanupPeriod {
    pub state: ClaudeCleanupPeriodState,
    /// The value when `state` is `set`.
    pub days: Option<u32>,
    /// The settings file that was read, or would be; empty when no folder
    /// is configured.
    pub file: String,
}

/// Only the one key is deserialized; serde skips the rest of the file.
#[derive(Deserialize)]
struct UserSettings {
    #[serde(rename = "cleanupPeriodDays")]
    cleanup_period_days: Option<serde_json::Value>,
}

/// The `cleanupPeriodDays` in the configured Claude Code folder's
/// `settings.json`. A missing or malformed file is a state, not an error.
#[tauri::command]
#[specta::specta]
pub async fn get_claude_cleanup_period(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<ClaudeCleanupPeriod> {
    let dir = read_config(&state).claude_config_dir();
    blocking_cmd!(Ok::<_, BindingsError>(read_cleanup_period(&dir)))
}

pub(crate) fn read_cleanup_period(config_dir: &Path) -> ClaudeCleanupPeriod {
    use ClaudeCleanupPeriodState as State;
    let outcome = |state, days, file: &Path| ClaudeCleanupPeriod {
        state,
        days,
        file: file.to_string_lossy().into_owned(),
    };
    // The same check as saving the folder (ADR 0012): local, existing, canonical.
    let Ok(dir) = canonical_claude_config_dir(&config_dir.to_string_lossy()) else {
        let file = if config_dir.as_os_str().is_empty() {
            PathBuf::new()
        } else {
            config_dir.join(SETTINGS_FILE)
        };
        return outcome(State::FolderInvalid, None, &file);
    };
    let path = dir.join(SETTINGS_FILE);
    let bytes = match read_bounded(&path) {
        Ok(bytes) => bytes,
        Err(state) => return outcome(state, None, &path),
    };
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    // Serde would also fill the struct from an array; settings are an object.
    let is_object = bytes.trim_ascii_start().first() == Some(&b'{');
    let (state, days) = match serde_json::from_slice::<UserSettings>(bytes) {
        Err(_) => (State::FileInvalid, None),
        Ok(_) if !is_object => (State::FileInvalid, None),
        Ok(UserSettings {
            cleanup_period_days: None,
        }) => (State::NotSet, None),
        Ok(UserSettings {
            cleanup_period_days: Some(value),
        }) => match whole_days(&value) {
            Some(days) => (State::Set, Some(days)),
            None => (State::ValueInvalid, None),
        },
    };
    outcome(state, days, &path)
}

/// Raise `cleanupPeriodDays` in the configured Claude Code folder's
/// `settings.json` to `days`, creating the file if needed. A longer value is
/// kept, never lowered. Returns the value read back afterwards.
#[tauri::command]
#[specta::specta]
pub async fn raise_claude_cleanup_period(
    state: tauri::State<'_, SharedConfig>,
    days: u32,
) -> CmdResult<ClaudeCleanupPeriod> {
    let dir = read_config(&state).claude_config_dir();
    blocking_cmd!(raise_cleanup_period(&dir, days))
}

pub(crate) fn raise_cleanup_period(
    config_dir: &Path,
    days: u32,
) -> Result<ClaudeCleanupPeriod, BindingsError> {
    // Checked like saving the folder (ADR 0012); a missing folder isn't created.
    let dir = canonical_claude_config_dir(&config_dir.to_string_lossy()).map_err(|_invalid| {
        BindingsError::Validation(
            "The Claude Code folder isn't valid, so nothing was changed. Check it in Settings → Claude Code."
                .into(),
        )
    })?;
    let target = writable_target(&dir.join(SETTINGS_FILE))?;
    match raise_in_file(&target, days) {
        Ok(_) => Ok(read_cleanup_period(&dir)),
        // Its messages are written for the user.
        Err(OrchestratorError::Config(message)) => Err(BindingsError::Validation(message)),
        Err(error) => Err(error.into()),
    }
}

/// The file to replace: `path`, or the local file a link at `path` points
/// to, so that the link survives the replacement.
fn writable_target(path: &Path) -> Result<PathBuf, BindingsError> {
    let is_link = std::fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink());
    if !is_link {
        return Ok(path.to_path_buf());
    }
    let unusable = || {
        BindingsError::Validation(
            "settings.json links to a file that isn't a local file, so it was left unchanged."
                .into(),
        )
    };
    let target = tracepilot_core::utils::fs::canonicalize(path).map_err(|_broken| unusable())?;
    let regular = std::fs::metadata(&target).is_ok_and(|meta| meta.is_file());
    if !has_local_root(&target) || !regular {
        return Err(unusable());
    }
    Ok(target)
}

/// A non-negative whole number, as JavaScript reads JSON (`30.0` is 30).
/// Values past `u32::MAX` saturate.
fn whole_days(value: &serde_json::Value) -> Option<u32> {
    if let Some(days) = value.as_u64() {
        return Some(u32::try_from(days).unwrap_or(u32::MAX));
    }
    let days = value.as_f64()?;
    (days >= 0.0 && days.fract() == 0.0).then(|| days.min(f64::from(u32::MAX)) as u32)
}

/// The file's bytes, if it is a local regular file of at most
/// [`MAX_SETTINGS_BYTES`]. A link is followed only to a local target.
fn read_bounded(path: &Path) -> Result<Vec<u8>, ClaudeCleanupPeriodState> {
    use ClaudeCleanupPeriodState as State;
    let target = match tracepilot_core::utils::fs::canonicalize(path) {
        Ok(target) => target,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(State::NoFile),
        Err(_) => return Err(State::FileInvalid),
    };
    // Checked before opening too, so a FIFO or device is never opened.
    let regular = std::fs::metadata(&target).is_ok_and(|meta| meta.is_file());
    if !has_local_root(&target) || !regular {
        return Err(State::FileInvalid);
    }
    let file = std::fs::File::open(&target).map_err(|_unreadable| State::FileInvalid)?;
    match file.metadata() {
        Ok(meta) if meta.is_file() && meta.len() <= MAX_SETTINGS_BYTES => {}
        _ => return Err(State::FileInvalid),
    }
    let mut bytes = Vec::new();
    file.take(MAX_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_unreadable| State::FileInvalid)?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err(State::FileInvalid);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::ClaudeCleanupPeriodState as State;
    use super::*;

    fn read_with(contents: Option<&[u8]>) -> ClaudeCleanupPeriod {
        let temp = tempfile::tempdir().unwrap();
        if let Some(contents) = contents {
            std::fs::write(temp.path().join(SETTINGS_FILE), contents).unwrap();
        }
        read_cleanup_period(temp.path())
    }

    fn state_and_days(contents: &str) -> (State, Option<u32>) {
        let result = read_with(Some(contents.as_bytes()));
        (result.state, result.days)
    }

    #[test]
    fn a_whole_number_is_read() {
        let result = read_with(Some(br#"{"model":"x","cleanupPeriodDays":3650}"#));
        assert_eq!((result.state, result.days), (State::Set, Some(3650)));
        assert!(result.file.ends_with(SETTINGS_FILE));
        assert_eq!(
            state_and_days(r#"{"cleanupPeriodDays":30.0}"#),
            (State::Set, Some(30))
        );
        assert_eq!(
            state_and_days("\u{FEFF}{\"cleanupPeriodDays\":7}"),
            (State::Set, Some(7))
        );
        assert_eq!(
            state_and_days(r#"{"cleanupPeriodDays":99999999999}"#),
            (State::Set, Some(u32::MAX))
        );
    }

    #[test]
    fn zero_is_returned_for_the_ui_to_flag() {
        assert_eq!(
            state_and_days(r#"{"cleanupPeriodDays":0}"#),
            (State::Set, Some(0))
        );
    }

    #[test]
    fn a_missing_key_or_file_falls_back_to_the_default() {
        assert_eq!(state_and_days(r#"{"model":"x"}"#), (State::NotSet, None));
        assert_eq!(
            state_and_days(r#"{"cleanupPeriodDays":null}"#),
            (State::NotSet, None)
        );
        let missing = read_with(None);
        assert_eq!((missing.state, missing.days), (State::NoFile, None));
        assert!(missing.file.ends_with(SETTINGS_FILE));
    }

    #[test]
    fn an_unusable_folder_is_reported_as_such() {
        let temp = tempfile::tempdir().unwrap();
        let gone = read_cleanup_period(&temp.path().join("absent"));
        assert_eq!((gone.state, gone.days), (State::FolderInvalid, None));
        assert!(gone.file.ends_with(SETTINGS_FILE));
        let relative = read_cleanup_period(Path::new("claude"));
        assert_eq!(relative.state, State::FolderInvalid);
        let blank = read_cleanup_period(Path::new(""));
        assert_eq!(
            (blank.state, blank.file.as_str()),
            (State::FolderInvalid, "")
        );
        #[cfg(windows)]
        assert_eq!(
            read_cleanup_period(Path::new(r"\\host\share\claude")).state,
            State::FolderInvalid
        );
    }

    #[test]
    fn other_values_are_invalid() {
        for value in [r#""90""#, "7.5", "-3", "true", "[30]", "{}"] {
            let contents = format!(r#"{{"cleanupPeriodDays":{value}}}"#);
            assert_eq!(
                state_and_days(&contents),
                (State::ValueInvalid, None),
                "{value}"
            );
        }
    }

    #[test]
    fn a_malformed_file_is_invalid() {
        for contents in [
            "",
            "{",
            "[1,2]",
            "[30]",
            "30",
            r#"{"cleanupPeriodDays":30,}"#,
        ] {
            assert_eq!(
                state_and_days(contents),
                (State::FileInvalid, None),
                "{contents:?}"
            );
        }
        assert_eq!(
            read_with(Some(&[0xFF, 0xFE, 0x00])).state,
            State::FileInvalid
        );
    }

    #[test]
    fn an_oversized_file_is_not_parsed() {
        let mut contents = br#"{"cleanupPeriodDays":90,"pad":""#.to_vec();
        contents.resize(MAX_SETTINGS_BYTES as usize + 1, b' ');
        contents.extend_from_slice(br#""}"#);
        assert_eq!(read_with(Some(&contents)).state, State::FileInvalid);
    }

    fn raise_in(
        contents: Option<&str>,
        days: u32,
    ) -> (Result<ClaudeCleanupPeriod, BindingsError>, Option<String>) {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join(SETTINGS_FILE);
        if let Some(contents) = contents {
            std::fs::write(&path, contents).unwrap();
        }
        let result = raise_cleanup_period(temp.path(), days);
        (result, std::fs::read_to_string(&path).ok())
    }

    #[test]
    fn raising_returns_the_value_read_back() {
        let (result, after) = raise_in(Some(r#"{"model":"x","cleanupPeriodDays":30}"#), 3650);
        let result = result.unwrap();
        assert_eq!((result.state, result.days), (State::Set, Some(3650)));
        assert_eq!(after.unwrap(), r#"{"model":"x","cleanupPeriodDays":3650}"#);

        let (result, after) = raise_in(None, 3650);
        assert_eq!(result.unwrap().days, Some(3650));
        assert_eq!(
            after.unwrap(),
            "{
  \"cleanupPeriodDays\": 3650
}
"
        );
    }

    #[test]
    fn raising_keeps_a_longer_value() {
        let contents = r#"{"cleanupPeriodDays":9000}"#;
        let (result, after) = raise_in(Some(contents), 3650);
        assert_eq!(result.unwrap().days, Some(9000));
        assert_eq!(after.as_deref(), Some(contents));
    }

    #[test]
    fn raising_reports_refusals_readably() {
        let (result, after) = raise_in(Some("{oops"), 3650);
        let error = result.unwrap_err();
        assert!(matches!(error, BindingsError::Validation(_)));
        assert_eq!(
            error.to_string(),
            "settings.json isn't valid JSON, so it was left unchanged."
        );
        assert_eq!(after.as_deref(), Some("{oops"));

        let (result, _) = raise_in(Some("{}"), 0);
        assert!(result.unwrap_err().to_string().contains("from 1 to 36500"));
    }

    #[test]
    fn raising_needs_an_existing_folder() {
        let temp = tempfile::tempdir().unwrap();
        let gone = temp.path().join(".claude");
        let error = raise_cleanup_period(&gone, 3650).unwrap_err();
        assert!(error.to_string().contains("folder isn't valid"), "{error}");
        assert!(!gone.exists());
        assert!(raise_cleanup_period(Path::new(""), 3650).is_err());
        assert!(raise_cleanup_period(Path::new("claude"), 3650).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn raising_writes_through_a_link_and_keeps_it() {
        let temp = tempfile::tempdir().unwrap();
        let claude = temp.path().join("claude");
        let dotfiles = temp.path().join("dotfiles");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::create_dir_all(&dotfiles).unwrap();
        let real = dotfiles.join(SETTINGS_FILE);
        std::fs::write(&real, r#"{"a":1}"#).unwrap();
        let link = claude.join(SETTINGS_FILE);
        std::os::unix::fs::symlink(&real, &link).unwrap();

        assert_eq!(
            raise_cleanup_period(&claude, 3650).unwrap().days,
            Some(3650)
        );
        assert!(
            std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(
            std::fs::read_to_string(&real).unwrap(),
            r#"{"a":1,"cleanupPeriodDays":3650}"#
        );

        std::fs::remove_file(&real).unwrap();
        let error = raise_cleanup_period(&claude, 3650).unwrap_err();
        assert!(error.to_string().contains("links to a file"), "{error}");
        assert!(!real.exists());
    }

    #[test]
    fn a_directory_named_settings_json_is_invalid() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join(SETTINGS_FILE)).unwrap();
        assert_eq!(read_cleanup_period(temp.path()).state, State::FileInvalid);
    }
}
