use std::path::{Path, PathBuf};

use tracepilot_core::provider::{ResumeLaunch, SessionSource};

use super::{effective_cwd, powershell_script, ps_quote, resume_argv, resume_cli};
use crate::config::TracePilotConfig;

const ID: &str = "c86fe369-c858-4d91-81da-203c5e276e33";

fn launch(args: &[&str], label: &'static str) -> ResumeLaunch {
    ResumeLaunch {
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        cwd: None,
        label,
    }
}

#[test]
fn copilot_script_is_unchanged() {
    // The exact script the Copilot-only command built before sources had
    // their own resume launch.
    let argv = resume_argv(
        "copilot",
        &launch(&["--resume", ID, "--ui-server"], "Copilot"),
    );
    assert_eq!(argv, ["copilot", "--resume", ID, "--ui-server"]);
    assert_eq!(
        powershell_script("Copilot", Path::new(r"C:\work\O'Brien"), ID, &argv),
        format!(
            "$host.UI.RawUI.WindowTitle = 'Copilot Session (Resume)'; Set-Location -LiteralPath 'C:\\work\\O''Brien'; Write-Host 'Resuming Copilot session...' -ForegroundColor Cyan; Write-Host '  Session: {ID}' -ForegroundColor White; Write-Host ''; copilot --resume {ID} --ui-server"
        )
    );
}

#[test]
fn claude_script_names_its_source() {
    let argv = resume_argv("claude", &launch(&["--resume", ID], "Claude Code"));
    assert_eq!(argv, ["claude", "--resume", ID]);
    let script = powershell_script("Claude Code", Path::new(r"C:\work\app"), ID, &argv);
    assert!(script.starts_with(
        "$host.UI.RawUI.WindowTitle = 'Claude Code Session (Resume)'; Set-Location -LiteralPath 'C:\\work\\app'; Write-Host 'Resuming Claude Code session...'"
    ));
    assert!(script.ends_with(&format!("; claude --resume {ID}")));
}

#[test]
fn argv_keeps_program_and_arguments_separate() {
    assert_eq!(
        resume_argv("gh  copilot", &launch(&["--resume", "abc"], "Copilot")),
        ["gh", "copilot", "--resume", "abc"]
    );
}

#[test]
fn each_source_resumes_through_its_own_cli() {
    let mut config = TracePilotConfig::default();
    assert_eq!(
        resume_cli(SessionSource::Copilot, Some("gh copilot".into()), &config),
        "gh copilot"
    );
    assert_eq!(resume_cli(SessionSource::Copilot, None, &config), "copilot");
    // The Copilot preference never reaches a Claude Code session.
    assert_eq!(
        resume_cli(
            SessionSource::ClaudeCode,
            Some("gh copilot".into()),
            &config
        ),
        "claude"
    );
    config.sources.claude_code.cli_command = r"C:\Tools\claude.exe".into();
    assert_eq!(
        resume_cli(SessionSource::ClaudeCode, None, &config),
        r"C:\Tools\claude.exe"
    );
    config.sources.claude_code.cli_command = " ".into();
    assert_eq!(
        resume_cli(SessionSource::ClaudeCode, None, &config),
        "claude"
    );
}

#[test]
fn the_claude_cli_setting_passes_the_cli_validator() {
    use crate::validators::validate_cli_command;
    for good in [
        "claude",
        "npx claude",
        r"C:\Tools\claude.exe",
        "/usr/local/bin/claude",
    ] {
        assert!(validate_cli_command(good).is_ok(), "{good}");
    }
    for bad in [
        "claude; calc",
        "claude & calc",
        "claude 'x'",
        "claude $(x)",
        "claude\nx",
    ] {
        assert!(validate_cli_command(bad).is_err(), "{bad}");
    }
}

#[test]
fn the_terminal_starts_in_the_recorded_directory_or_its_nearest_ancestor() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    let repo = temp.path().join("repo");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&repo).unwrap();
    let home = Some(home);

    assert_eq!(effective_cwd(Some(&repo), home.clone()), repo);
    let gone = repo.join("deleted").join("deeper");
    assert_eq!(effective_cwd(Some(&gone), home.clone()), repo);
    assert_eq!(effective_cwd(None, home.clone()), home.clone().unwrap());

    // With no usable home either, the app's own directory.
    let missing_home = Some(temp.path().join("no-home"));
    assert_eq!(effective_cwd(None, missing_home), PathBuf::from("."));
}

#[test]
fn an_untrusted_recorded_directory_falls_back_to_home() {
    let temp = tempfile::tempdir().unwrap();
    let home = Some(temp.path().to_path_buf());
    let with_newline = temp.path().join("a\nb");
    let mut rejected = vec![
        PathBuf::from("relative/dir"),
        PathBuf::from("."),
        with_newline,
    ];
    if cfg!(windows) {
        rejected.extend([
            PathBuf::from(r"\\attacker\share\repo"),
            PathBuf::from("//attacker/share/repo"),
            PathBuf::from(r"\\?\UNC\attacker\share"),
            PathBuf::from(r"\\.\pipe\x"),
            PathBuf::from(r"\/attacker/share/repo"),
            PathBuf::from(r"/\attacker\share\repo"),
            PathBuf::from(r"\repo"),
        ]);
    }
    for path in rejected {
        assert_eq!(
            effective_cwd(Some(&path), home.clone()),
            temp.path(),
            "{}",
            path.display()
        );
    }
}

#[test]
fn quotes_are_doubled_including_typographic_ones() {
    assert_eq!(ps_quote("plain"), "plain");
    assert_eq!(ps_quote("O'Brien"), "O''Brien");
    assert_eq!(
        ps_quote("a\u{2018}b\u{2019}c\u{201A}d\u{201B}e"),
        "a\u{2018}\u{2018}b\u{2019}\u{2019}c\u{201A}\u{201A}d\u{201B}\u{201B}e"
    );
}

/// Classified from the parsed prefix, never by probing: a refused path must
/// not reach `is_dir`, which would open an SMB connection.
#[cfg(windows)]
#[test]
fn only_drive_and_wsl_roots_count_as_local() {
    use super::is_plain_local_absolute;
    for local in [
        r"C:\work\app",
        r"c:/work/app",
        r"\\?\C:\work\app",
        r"\\wsl.localhost\Ubuntu\home\me\app",
        r"\\WSL$\Ubuntu\home\me\app",
        "//wsl.localhost/Ubuntu/home/me/app",
    ] {
        assert!(is_plain_local_absolute(Path::new(local)), "{local}");
    }
    for remote in [
        r"\\192.0.2.1\share\repo",
        "//192.0.2.1/share/repo",
        r"\/192.0.2.1/share/repo",
        r"/\192.0.2.1\share\repo",
        r"\\?\UNC\192.0.2.1\share\repo",
        r"\\?\UNC\wsl.localhost\Ubuntu",
        r"\\.\pipe\x",
        r"\\?\Volume{00000000-0000-0000-0000-000000000000}\x",
        r"\\wsl.localhost.attacker\share\repo",
        r"\repo",
        r"C:repo",
    ] {
        assert!(!is_plain_local_absolute(Path::new(remote)), "{remote}");
    }
}

#[cfg(windows)]
#[test]
fn a_verbatim_drive_path_is_used_as_recorded() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let verbatim = PathBuf::from(format!(r"\\?\{}", repo.display()));
    let home = Some(temp.path().to_path_buf());
    assert_eq!(effective_cwd(Some(&verbatim), home.clone()), verbatim);
    // Mixed-separator UNC falls back to home without being probed.
    let mixed = PathBuf::from(r"\/192.0.2.1/share/repo");
    assert_eq!(effective_cwd(Some(&mixed), home), temp.path());
}
