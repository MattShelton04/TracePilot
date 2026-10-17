// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Session logs with a cut-off line. A CLI killed while appending leaves half
//! a JSON line; after `--resume` more lines follow, so the cut line stays in
//! the middle of the file. The index keeps every record that parses, stores
//! the fingerprint of the bytes it read, and parses the file again only when
//! it changes.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{ProviderRegistry, SessionProvider};
use tracepilot_indexer::index_db::IndexDb;
use tracepilot_indexer::{
    IndexScope, SearchFilters, SourceGenerations, reindex_all, reindex_all_scoped,
    reindex_incremental, reindex_incremental_scoped, reindex_search_content,
    reindex_search_content_scoped,
};
use tracepilot_test_support::claude::{OPUS, Subagent, Transcript, Usage, text, write_session};

const ID: &str = "5c0a7e11-0000-4000-8000-000000000001";

fn session(root: &Path) -> PathBuf {
    let dir = root.join("session-state").join(ID);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {ID}\nsummary: \"Crash tail\"\nrepository: \"org/repo\"\nbranch: \"main\"\ncwd: 'C:\\test'\nhost_type: cli\ncreated_at: \"2026-03-10T07:14:50Z\"\nupdated_at: \"2026-03-10T07:15:00Z\"\n"
        ),
    )
    .unwrap();
    dir
}

/// One user prompt and its answer, as two complete lines.
fn turn(n: u32, minute: u32) -> String {
    format!(
        "{{\"type\":\"user.message\",\"data\":{{\"content\":\"prompt{n} ✅\",\"interactionId\":\"int-{n}\"}},\"id\":\"u-{n}\",\"timestamp\":\"2026-03-10T07:{minute:02}:01.000Z\",\"parentId\":null}}\n\
         {{\"type\":\"assistant.message\",\"data\":{{\"messageId\":\"m-{n}\",\"content\":\"answer{n} ✅ done\",\"interactionId\":\"int-{n}\"}},\"id\":\"a-{n}\",\"timestamp\":\"2026-03-10T07:{minute:02}:02.000Z\",\"parentId\":\"u-{n}\"}}\n"
    )
}

/// The first half of a turn's first line, as a killed process leaves it.
fn cut_line(n: u32) -> Vec<u8> {
    let full = turn(n, 30);
    let first = full.lines().next().unwrap().as_bytes();
    first[..first.len() / 2].to_vec()
}

fn append(path: &Path, bytes: &[u8]) {
    let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
    file.write_all(bytes).unwrap();
}

fn state(root: &Path) -> PathBuf {
    root.join("session-state")
}

/// (turn_count, event_count) as the session list shows them.
fn listed(db: &IndexDb) -> Vec<(Option<i64>, Option<i64>)> {
    db.list_sessions_filtered(None, None, None, false)
        .unwrap()
        .into_iter()
        .map(|row| (row.turn_count, row.event_count))
        .collect()
}

/// (turn_count, event_count) as the session detail view shows them.
fn detail(dir: &Path) -> (Option<i64>, Option<i64>) {
    let loaded = tracepilot_core::summary::load_session_summary_with_events(dir).unwrap();
    (
        loaded.summary.turn_count.map(|c| c as i64),
        loaded.summary.event_count.map(|c| c as i64),
    )
}

fn search_hits(db: &IndexDb, query: &str) -> usize {
    db.query_content(Some(query), &SearchFilters::default())
        .unwrap()
        .len()
}

/// A new session with a cut line followed by resumed turns is listed with
/// what the detail view shows, is searchable, and is not parsed again.
#[test]
fn new_copilot_session_with_a_cut_line_is_indexed_once() {
    let temp = tempfile::tempdir().unwrap();
    let dir = session(temp.path());
    let events = dir.join("events.jsonl");
    fs::write(&events, turn(1, 15)).unwrap();
    append(&events, &cut_line(2));
    // The resumed CLI appends right after the cut, so its first record
    // shares the cut's line; it is recovered from there.
    append(&events, turn(3, 40).as_bytes());
    append(&events, turn(4, 45).as_bytes());

    let db_path = temp.path().join("index.db");
    let indexed = reindex_all(&state(temp.path()), &db_path).unwrap();
    let db = IndexDb::open_or_create(&db_path).unwrap();
    assert_eq!(indexed, 1, "the session must be indexed");
    assert_eq!(listed(&db), vec![detail(&dir)]);
    assert_eq!(detail(&dir), (Some(3), Some(6)), "prompt3 is recovered");
    assert!(!db.needs_reindex(&SessionId::from_validated(ID), &dir));
    assert_eq!(
        reindex_incremental(&state(temp.path()), &db_path).unwrap(),
        (0, 1),
        "an unchanged file is not parsed again"
    );

    let search = |db_path: &Path| {
        reindex_search_content(&state(temp.path()), db_path, |_| {}, || false).unwrap()
    };
    assert_eq!(search(&db_path), (1, 0));
    assert_eq!(search_hits(&db, "answer4"), 1);
    assert_eq!(
        search_hits(&db, "prompt3"),
        1,
        "the glued record is searchable"
    );
    assert_eq!(search(&db_path), (0, 1), "search is not rebuilt either");
}

/// An indexed session that gets a cut line and two resumed turns catches up
/// with the detail view instead of freezing at its pre-crash rows.
#[test]
fn indexed_copilot_session_catches_up_after_a_cut_line_and_resume() {
    let temp = tempfile::tempdir().unwrap();
    let dir = session(temp.path());
    let events = dir.join("events.jsonl");
    fs::write(&events, turn(1, 15)).unwrap();
    let db_path = temp.path().join("index.db");
    reindex_all(&state(temp.path()), &db_path).unwrap();
    append(&events, &cut_line(2));
    append(&events, turn(3, 40).as_bytes());
    append(&events, turn(4, 45).as_bytes());

    let (indexed, _) = reindex_incremental(&state(temp.path()), &db_path).unwrap();
    let db = IndexDb::open_or_create(&db_path).unwrap();
    assert_eq!(indexed, 1);
    assert_eq!(listed(&db), vec![detail(&dir)]);
    assert_eq!(detail(&dir), (Some(3), Some(6)));
    assert!(!db.needs_reindex(&SessionId::from_validated(ID), &dir));
}

/// A file read while a line is still being written is indexed without that
/// line, and indexed again as soon as the line is finished: the stored
/// fingerprint covers the partial bytes, so finishing them changes it.
#[test]
fn a_partial_last_line_is_picked_up_when_the_write_finishes() {
    let temp = tempfile::tempdir().unwrap();
    let dir = session(temp.path());
    let events = dir.join("events.jsonl");
    let next = turn(2, 20);
    let split = next.len() / 3;
    fs::write(&events, turn(1, 15)).unwrap();
    append(&events, &next.as_bytes()[..split]);

    let db_path = temp.path().join("index.db");
    assert_eq!(reindex_all(&state(temp.path()), &db_path).unwrap(), 1);
    let db = IndexDb::open_or_create(&db_path).unwrap();
    assert_eq!(listed(&db), vec![(Some(1), Some(2))]);
    let id = SessionId::from_validated(ID);
    assert!(!db.needs_reindex(&id, &dir));

    append(&events, &next.as_bytes()[split..]);
    assert!(
        db.needs_reindex(&id, &dir),
        "the finished line must be read"
    );
    assert_eq!(
        reindex_incremental(&state(temp.path()), &db_path).unwrap(),
        (1, 0)
    );
    assert_eq!(listed(&db), vec![(Some(2), Some(4))]);
}

/// A last line cut inside a multi-byte character loses only that line, in
/// the detail view and in the index.
#[test]
fn a_tail_cut_inside_a_utf8_character_keeps_the_earlier_events() {
    let temp = tempfile::tempdir().unwrap();
    let dir = session(temp.path());
    let events = dir.join("events.jsonl");
    fs::write(&events, turn(1, 15)).unwrap();
    let next = turn(2, 20);
    let check = next.bytes().position(|b| b == 0xE2).unwrap(); // first byte of ✅
    append(&events, &next.as_bytes()[..=check]);

    let parsed = tracepilot_core::parsing::events::parse_typed_events(&events).unwrap();
    assert_eq!(parsed.events.len(), 2);
    assert_eq!(parsed.diagnostics.malformed_lines, 1);
    assert_eq!(detail(&dir), (Some(1), Some(2)));

    let db_path = temp.path().join("index.db");
    assert_eq!(reindex_all(&state(temp.path()), &db_path).unwrap(), 1);
    let db = IndexDb::open_or_create(&db_path).unwrap();
    assert_eq!(listed(&db), vec![(Some(1), Some(2))]);
}

fn claude_scope(config_dir: &Path) -> IndexScope {
    let mut registry = ProviderRegistry::new();
    registry.register(Arc::new(ClaudeCodeProvider::new(config_dir)));
    IndexScope::new(registry, Arc::new(SourceGenerations::new()))
}

/// What a best-effort load (the detail view) counts for the only session.
fn claude_detail(config_dir: &Path) -> (Option<i64>, Option<i64>) {
    let provider = ClaudeCodeProvider::new(config_dir);
    let session = provider.discover(&|| false).unwrap().remove(0);
    let summary = provider
        .load_snapshot(&session, false, &|| false)
        .unwrap()
        .summary;
    (
        summary.turn_count.map(|c| c as i64),
        summary.event_count.map(|c| c as i64),
    )
}

/// Index the only Claude session twice: the first pass must write it and the
/// second must skip it, in both the session and the search phase.
fn index_claude_once(config_dir: &Path, db_path: &Path) -> IndexDb {
    let scope = claude_scope(config_dir);
    assert_eq!(reindex_all_scoped(&scope, db_path, |_| {}).unwrap(), 1);
    assert_eq!(
        reindex_incremental_scoped(&scope, db_path, |_| {}).unwrap(),
        (0, 1),
        "an unchanged transcript is not parsed again"
    );
    let search = || reindex_search_content_scoped(&scope, db_path, |_| {}, || false).unwrap();
    assert_eq!(search(), (1, 0));
    assert_eq!(search(), (0, 1));
    IndexDb::open_or_create(db_path).unwrap()
}

/// Claude Code: a transcript cut mid-line, then appended to by
/// `claude --resume`, is indexed with every record that parses.
#[test]
fn claude_transcript_with_a_cut_line_then_resume_is_indexed() {
    let id = "aaaaaaaa-0000-4000-8000-00000000000a";
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("claude");
    let dir = config.join("projects").join("C--work-demo");
    fs::create_dir_all(&dir).unwrap();
    let mut first = Transcript::main();
    first.prompt("first prompt");
    first.call(
        "msg_1",
        OPUS,
        vec![text("Done.")],
        Usage::new(5, 100, 0, 10),
        "end_turn",
    );
    let mut bytes = first.to_bytes();
    // Cut the last record in half (the process was killed mid-append)…
    let last_start = bytes[..bytes.len() - 1]
        .iter()
        .rposition(|b| *b == b'\n')
        .unwrap()
        + 1;
    bytes.truncate(last_start + (bytes.len() - last_start) / 2);
    // …then the resumed process appends whole records right after the cut,
    // so its prompt shares the cut's line.
    let mut resumed = Transcript::main();
    resumed.prompt("resumedsentinel prompt");
    bytes.extend_from_slice(&resumed.to_bytes());
    fs::write(dir.join(format!("{id}.jsonl")), &bytes).unwrap();

    let db = index_claude_once(&config, &temp.path().join("index.db"));
    assert_eq!(
        claude_detail(&config).0,
        Some(2),
        "the resumed prompt starts a turn"
    );
    assert_eq!(listed(&db), vec![claude_detail(&config)]);
    assert_eq!(search_hits(&db, "resumedsentinel"), 1);
}

/// Claude Code: a subagent file left with a partial last line (its process
/// was killed) no longer keeps the whole session out of the index; nothing
/// ever appends to that file again.
#[test]
fn claude_subagent_partial_tail_does_not_block_the_session() {
    let mut main = Transcript::main();
    main.prompt("mainsentinel prompt");
    main.call(
        "msg_1",
        OPUS,
        vec![text("Done.")],
        Usage::new(5, 100, 0, 10),
        "end_turn",
    );
    let mut child = Transcript::subagent("abc123", 7);
    child.prompt("subagent task");
    child.partial_tail(b"{\"type\":\"assistant\",\"message\":{\"id\":\"m");
    let files = write_session(
        &main,
        &[Subagent {
            agent_id: "abc123",
            transcript: &child,
            meta: None,
        }],
    );

    let db = index_claude_once(files.root.path(), &files.root.path().join("index.db"));
    assert_eq!(listed(&db), vec![claude_detail(files.root.path())]);
    assert_eq!(search_hits(&db, "mainsentinel"), 1);
}
