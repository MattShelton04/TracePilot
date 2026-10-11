//! Export preview cache: reuse, and a fresh render whenever an input changes.

use std::io::Write;
use std::path::Path;
use std::sync::Arc;

use serde_json::json;
use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{
    CopilotProvider, ResolvedSession, SessionLocator, SessionProvider, SessionRole,
};

use super::super::export::cached_preview;
use super::*;

const ID: &str = "11111111-1111-4111-8111-111111111111";

fn copilot_session(dir: &Path) -> ResolvedSession {
    ResolvedSession {
        provider: Arc::new(CopilotProvider::new(dir.parent().unwrap())),
        locator: SessionLocator {
            source: SessionSource::Copilot,
            id: SessionId::from_validated(ID),
            primary_path: dir.to_path_buf(),
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint: 0,
        },
    }
}

/// A Copilot session directory with one user message.
fn copilot_dir(root: &Path) -> PathBuf {
    let dir = root.join(ID);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("workspace.yaml"), format!("id: {ID}\n")).unwrap();
    std::fs::write(dir.join("events.jsonl"), "").unwrap();
    append(&dir.join("events.jsonl"), &event("first message"));
    dir
}

fn event(content: &str) -> serde_json::Value {
    json!({"type": "user.message", "data": {"content": content}, "id": content,
        "timestamp": "2026-01-01T00:00:00.000Z"})
}

fn append(path: &Path, line: &serde_json::Value) {
    let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
    writeln!(file, "{line}").unwrap();
}

fn request(format: &str, sections: &[&str]) -> PreviewKey {
    PreviewKey {
        session_id: ID.to_string(),
        primary_path: PathBuf::new(),
        format: format.to_string(),
        sections: sections.iter().map(|s| s.to_string()).collect(),
        max_bytes: None,
        detail: [None; 6],
    }
}

fn preview(cache: &PreviewCache, session: ResolvedSession, request: PreviewKey) -> String {
    cached_preview(cache, session, request).unwrap().content
}

/// Whether `request` would be served from `cache` right now.
fn is_cached(cache: &PreviewCache, session: &ResolvedSession, mut request: PreviewKey) -> bool {
    request.primary_path = session.locator.primary_path.clone();
    let version = source_version(session).unwrap();
    cache.get(&request, &version).is_some()
}

#[test]
fn a_preview_is_reused_until_a_live_session_grows() {
    let root = tempfile::tempdir().unwrap();
    let dir = copilot_dir(root.path());
    let cache = PreviewCache::new();
    let conversation = || request("json", &["conversation"]);

    let first = preview(&cache, copilot_session(&dir), conversation());
    assert!(first.contains("first message"));
    assert!(is_cached(&cache, &copilot_session(&dir), conversation()));
    // Served as rendered, bar the export time.
    let reused = preview(&cache, copilot_session(&dir), conversation());
    assert_eq!(split_exported_at(&reused).1, split_exported_at(&first).1);

    append(&dir.join("events.jsonl"), &event("second message"));
    assert!(!is_cached(&cache, &copilot_session(&dir), conversation()));
    let grown = preview(&cache, copilot_session(&dir), conversation());
    assert!(grown.contains("second message"));
}

#[test]
fn an_edited_side_file_is_rendered_afresh() {
    let root = tempfile::tempdir().unwrap();
    let dir = copilot_dir(root.path());
    let cache = PreviewCache::new();
    let plan = || request("markdown", &["plan"]);
    std::fs::write(dir.join("plan.md"), "Initial plan").unwrap();

    assert!(preview(&cache, copilot_session(&dir), plan()).contains("Initial plan"));
    assert!(is_cached(&cache, &copilot_session(&dir), plan()));

    // The plan is not in the source fingerprint; the events are unchanged.
    std::fs::write(dir.join("plan.md"), "Revised, longer plan").unwrap();
    assert!(!is_cached(&cache, &copilot_session(&dir), plan()));
    assert!(preview(&cache, copilot_session(&dir), plan()).contains("Revised, longer plan"));
}

#[test]
fn each_option_set_and_folder_has_its_own_entry() {
    let root = tempfile::tempdir().unwrap();
    let dir = copilot_dir(root.path());
    let cache = PreviewCache::new();

    let json = preview(
        &cache,
        copilot_session(&dir),
        request("json", &["conversation"]),
    );
    let markdown = preview(
        &cache,
        copilot_session(&dir),
        request("markdown", &["conversation"]),
    );
    assert_ne!(json, markdown);
    let mut redacted = request("json", &["conversation"]);
    redacted.detail[4] = Some(true);
    assert!(!is_cached(&cache, &copilot_session(&dir), redacted));

    // The same session id found under another folder is another session.
    let moved = copy_session(&dir, &root.path().join("moved"));
    assert!(!is_cached(
        &cache,
        &copilot_session(&moved),
        request("json", &["conversation"])
    ));
}

fn copy_session(dir: &Path, root: &Path) -> PathBuf {
    let target = root.join(ID);
    std::fs::create_dir_all(&target).unwrap();
    for name in ["workspace.yaml", "events.jsonl"] {
        std::fs::copy(dir.join(name), target.join(name)).unwrap();
    }
    target
}

#[test]
fn oversized_previews_are_not_kept() {
    let root = tempfile::tempdir().unwrap();
    let dir = copilot_dir(root.path());
    append(
        &dir.join("events.jsonl"),
        &event(&"x".repeat(MAX_CACHED_BYTES)),
    );
    let cache = PreviewCache::new();
    let mut large = request("json", &["conversation"]);
    large.max_bytes = Some(4 * MAX_CACHED_BYTES);

    let content = preview(&cache, copilot_session(&dir), large.clone());
    assert!(content.len() > MAX_CACHED_BYTES);
    assert!(!is_cached(&cache, &copilot_session(&dir), large));
}

#[test]
fn a_claude_preview_follows_its_transcript() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("projects").join("demo");
    std::fs::create_dir_all(&project).unwrap();
    let transcript = project.join(format!("{ID}.jsonl"));
    let user = |uuid: &str, text: &str| {
        json!({"type": "user", "uuid": uuid, "sessionId": ID,
            "timestamp": "2026-09-20T10:00:01Z", "message": {"role": "user", "content": text}})
    };
    std::fs::write(&transcript, "").unwrap();
    append(&transcript, &user("u1", "Hello there."));
    let provider = Arc::new(ClaudeCodeProvider::new(root.path()));
    let session = || {
        let locator = provider.discover(&|| false).unwrap().remove(0);
        ResolvedSession {
            provider: provider.clone(),
            locator,
        }
    };
    let cache = PreviewCache::new();
    let conversation = || request("markdown", &["conversation"]);

    assert!(preview(&cache, session(), conversation()).contains("Hello there."));
    assert!(is_cached(&cache, &session(), conversation()));

    append(&transcript, &user("u2", "Another question."));
    assert!(!is_cached(&cache, &session(), conversation()));
    assert!(preview(&cache, session(), conversation()).contains("Another question."));
}

/// `content`'s archive header export time, and the content without it.
fn split_exported_at(content: &str) -> (DateTime<Utc>, serde_json::Value) {
    let mut archive: serde_json::Value = serde_json::from_str(content).unwrap();
    let stamp = archive["header"]
        .as_object_mut()
        .unwrap()
        .remove("exportedAt")
        .unwrap();
    (serde_json::from_value(stamp).unwrap(), archive)
}

#[test]
fn a_reused_preview_shows_when_it_was_served() {
    let root = tempfile::tempdir().unwrap();
    let dir = copilot_dir(root.path());
    let cache = PreviewCache::new();
    let conversation = || request("json", &["conversation"]);

    let first = cached_preview(&cache, copilot_session(&dir), conversation()).unwrap();
    assert!(is_cached(&cache, &copilot_session(&dir), conversation()));
    std::thread::sleep(std::time::Duration::from_millis(20));
    let reused = cached_preview(&cache, copilot_session(&dir), conversation()).unwrap();

    let (rendered_at, rendered) = split_exported_at(&first.content);
    let (served_at, served) = split_exported_at(&reused.content);
    assert!(
        served_at > rendered_at,
        "a reused preview must not show its render time ({rendered_at})"
    );
    // Only the timestamp moved: sessions and content hash are as rendered.
    assert_eq!(served, rendered);
    assert_eq!(reused.estimated_size_bytes, reused.content.len());
}

#[test]
fn a_markdown_preview_gets_the_new_export_time_and_a_truncated_one_is_left_alone() {
    let root = tempfile::tempdir().unwrap();
    let dir = copilot_dir(root.path());
    let cache = PreviewCache::new();
    let rendered = cached_preview(
        &cache,
        copilot_session(&dir),
        request("markdown", &["conversation"]),
    )
    .unwrap();
    let now = DateTime::parse_from_rfc3339("2031-02-03T04:05:06.789Z")
        .unwrap()
        .with_timezone(&Utc);

    let served = with_exported_at(rendered.clone(), now);
    let line = |content: &str| {
        let line = content
            .lines()
            .find(|l| l.starts_with("> Exported by ["))
            .unwrap();
        line.to_string()
    };
    assert!(line(&served.content).contains(") on 2031-02-03T04:05:06Z · Schema v"));
    assert_eq!(
        served.content.replace(&line(&served.content), ""),
        rendered.content.replace(&line(&rendered.content), "")
    );

    let mut truncated = rendered.clone();
    let cut = truncated.content.find(") on ").unwrap() + ") on 20".len();
    truncated.content.truncate(cut);
    assert_eq!(
        with_exported_at(truncated.clone(), now).content,
        truncated.content
    );
}
