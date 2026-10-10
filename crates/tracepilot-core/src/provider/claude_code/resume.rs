//! How a Claude Code session resumes: `claude --resume <id>`, run from the
//! directory the session belongs to.
//!
//! Claude Code files a transcript under `projects/<slug>/`, where the slug is
//! the directory it was started in with every character other than an ASCII
//! letter or digit replaced by `-`, and `--resume` looks for the id under the
//! slug of the directory it runs in. A session's records carry a `cwd` that
//! can move during the session, so the first recorded `cwd` whose slug names
//! the transcript's folder wins; otherwise the last one, which is the
//! summary's.

use std::path::{Path, PathBuf};

use super::reader::Line;
use crate::provider::{ResumeLaunch, SessionLocator};

/// Claude Code shortens a longer slug and appends a hash.
const MAX_SLUG_CHARS: usize = 200;

pub(super) fn resume_launch(session: &SessionLocator, lines: &[Line]) -> ResumeLaunch {
    let folder = session
        .primary_path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str());
    ResumeLaunch {
        args: vec!["--resume".to_owned(), session.id.to_string()],
        cwd: session_cwd(lines, folder).map(PathBuf::from),
        label: "Claude Code",
    }
}

fn session_cwd<'a>(lines: &'a [Line], folder: Option<&str>) -> Option<&'a str> {
    let cwds = lines
        .iter()
        .filter_map(|line| line.value["cwd"].as_str())
        .filter(|cwd| !cwd.trim().is_empty());
    let mut last = None;
    for cwd in cwds {
        if folder.is_some_and(|folder| slug_matches(cwd, folder)) {
            return Some(cwd);
        }
        last = Some(cwd);
    }
    last
}

fn slug_matches(cwd: &str, folder: &str) -> bool {
    let slug: String = cwd
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    if slug.len() > MAX_SLUG_CHARS {
        folder.starts_with(&slug[..MAX_SLUG_CHARS])
    } else {
        slug == folder
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;

    use super::*;
    use crate::ids::SessionId;
    use crate::provider::{SessionRole, SessionSource};

    const ID: &str = "11111111-2222-4333-8444-555555555555";

    fn session(folder: &str) -> SessionLocator {
        SessionLocator {
            source: SessionSource::ClaudeCode,
            id: SessionId::from_validated(ID),
            primary_path: PathBuf::from("projects")
                .join(folder)
                .join(format!("{ID}.jsonl")),
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint: 0,
        }
    }

    fn lines(cwds: &[Option<&str>]) -> Vec<Line> {
        cwds.iter()
            .enumerate()
            .map(|(index, cwd)| Line {
                line: index + 1,
                value: Arc::new(match cwd {
                    Some(cwd) => json!({ "type": "user", "cwd": cwd }),
                    None => json!({ "type": "summary" }),
                }),
            })
            .collect()
    }

    #[test]
    fn resumes_by_id_with_the_source_label() {
        let launch = resume_launch(&session("C--work-app"), &lines(&[Some(r"C:\work\app")]));
        assert_eq!(launch.args, ["--resume", ID]);
        assert_eq!(launch.cwd, Some(PathBuf::from(r"C:\work\app")));
        assert_eq!(launch.label, "Claude Code");
    }

    #[test]
    fn prefers_the_directory_the_transcript_is_filed_under() {
        let cwds = [
            None,
            Some(r"C:\work\app"),
            Some(r"C:\work\app\sub dir"),
            Some(""),
        ];
        let launch = resume_launch(&session("C--work-app"), &lines(&cwds));
        assert_eq!(launch.cwd, Some(PathBuf::from(r"C:\work\app")));

        // A later directory that matches still wins over an earlier one that doesn't.
        let cwds = [Some("/tmp/elsewhere"), Some("/home/me/app")];
        let launch = resume_launch(&session("-home-me-app"), &lines(&cwds));
        assert_eq!(launch.cwd, Some(PathBuf::from("/home/me/app")));
    }

    #[test]
    fn falls_back_to_the_last_recorded_directory() {
        let cwds = [Some("/a"), Some("/b"), Some("  ")];
        let launch = resume_launch(&session("unrelated"), &lines(&cwds));
        assert_eq!(launch.cwd, Some(PathBuf::from("/b")));
        assert_eq!(resume_launch(&session("x"), &lines(&[None])).cwd, None);
    }

    #[test]
    fn matches_a_shortened_slug_by_its_prefix() {
        let cwd = format!("/{}", "a".repeat(250));
        let folder = format!("-{}-1a2b3c", "a".repeat(MAX_SLUG_CHARS - 1));
        assert!(slug_matches(&cwd, &folder));
        assert!(!slug_matches("/b", "-a"));
    }
}
