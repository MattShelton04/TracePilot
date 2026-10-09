//! Plans, file history and Explorer roots served by
//! `ClaudeCodeProvider::artifacts`.

use std::path::Path;

use serde_json::{Value, json};
use tracepilot_test_support::claude::{
    OPUS, SESSION_ID, SessionFiles, Transcript, Usage, text, tool_use, write_session,
};

use super::super::ClaudeCodeProvider;
use crate::ids::SessionId;
use crate::provider::{
    FileCheckpoint, FileHistory, PlanArtifact, SessionArtifacts, SessionLocator, SessionProvider,
};

fn usage() -> Usage {
    Usage::new(2, 100, 10, 20)
}

fn provider_and_locator(files: &SessionFiles) -> (ClaudeCodeProvider, SessionLocator) {
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .expect("fixture session resolves");
    (provider, locator)
}

fn artifacts(files: &SessionFiles) -> SessionArtifacts {
    let (provider, locator) = provider_and_locator(files);
    provider.artifacts(&locator).unwrap()
}

fn exit_plan(t: &mut Transcript, id: &str, input: Value, result: Value) {
    t.call(
        &format!("msg_{id}"),
        OPUS,
        vec![tool_use(id, "ExitPlanMode", input)],
        usage(),
        "tool_use",
    );
    t.tool_result(id, json!("User approved the plan."), result, false);
}

fn write_config_file(files: &SessionFiles, relative: &str, content: &str) {
    let path = files.root.path().join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

/// The approved text in `toolUseResult.plan` wins over the proposal in
/// `input.plan`, and a later plan wins over an earlier one.
#[test]
fn the_latest_exit_plan_mode_text_is_the_plan() {
    let mut t = Transcript::main();
    t.prompt("Plan the retry work.");
    exit_plan(
        &mut t,
        "toolu_plan1",
        json!({"plan": "# First proposal"}),
        json!({"plan": "# First, as approved", "isAgent": false, "filePath": "x"}),
    );
    t.prompt("Now plan the follow-up.");
    // A newer client: the plan is only in the result.
    exit_plan(
        &mut t,
        "toolu_plan2",
        json!({}),
        json!({"plan": "# Follow-up plan", "isAgent": false}),
    );
    let files = write_session(&t, &[]);
    assert_eq!(
        artifacts(&files).plan,
        Some(PlanArtifact::Inline("# Follow-up plan".into()))
    );
}

/// A rejected plan keeps its proposal: the result is an error string.
#[test]
fn a_rejected_plan_keeps_its_proposal() {
    let mut t = Transcript::main();
    t.prompt("Plan it.");
    t.call(
        "msg_p",
        OPUS,
        vec![tool_use(
            "toolu_p",
            "ExitPlanMode",
            json!({"plan": "# Proposal"}),
        )],
        usage(),
        "tool_use",
    );
    t.tool_result(
        "toolu_p",
        json!("Keep planning."),
        json!("Error: rejected"),
        true,
    );
    let files = write_session(&t, &[]);
    assert_eq!(
        artifacts(&files).plan,
        Some(PlanArtifact::Inline("# Proposal".into()))
    );
}

/// Plan mode without recorded text falls back to `plans/<slug>.md`; the
/// record's `filePath` is never followed, and a session that never used
/// plan mode has no plan even when a file with its slug exists.
#[test]
fn plan_files_are_a_fallback_named_by_the_slug() {
    let session = |plan_mode: bool, slug: &str| {
        let mut t = Transcript::main();
        t.user(json!({"slug": slug, "message": {"role": "user", "content": "Plan."}}));
        if plan_mode {
            t.call(
                "msg_enter",
                OPUS,
                vec![tool_use("toolu_enter", "EnterPlanMode", json!({}))],
                usage(),
                "tool_use",
            );
        }
        t.call(
            "msg_done",
            OPUS,
            vec![text("Thinking.")],
            usage(),
            "end_turn",
        );
        let files = write_session(&t, &[]);
        write_config_file(
            &files,
            "plans/quiet-blue-otter.md",
            "# From the plan file\n",
        );
        write_config_file(&files, "elsewhere.md", "# Not a plan\n");
        files
    };

    let files = session(true, "quiet-blue-otter");
    let expected = files
        .root
        .path()
        .join("plans/quiet-blue-otter.md")
        .canonicalize()
        .unwrap();
    let plan = artifacts(&files).plan.unwrap();
    assert_eq!(plan, PlanArtifact::File(expected));
    assert_eq!(
        plan.read().unwrap().as_deref(),
        Some("# From the plan file\n")
    );

    assert_eq!(artifacts(&session(false, "quiet-blue-otter")).plan, None);
    assert_eq!(artifacts(&session(true, "../elsewhere")).plan, None);
}

fn snapshot(message_id: &str, update: bool, backups: Value) -> Value {
    json!({"type": "file-history-snapshot", "messageId": message_id,
        "isSnapshotUpdate": update,
        "snapshot": {"messageId": message_id, "trackedFileBackups": backups,
            "timestamp": "2026-09-20T10:00:00.000Z"}})
}

fn backup(name: Option<&str>, version: u64) -> Value {
    json!({"backupFileName": name, "version": version,
        "backupTime": "2026-09-20T10:00:00.000Z"})
}

/// Two prompts: the first edits `a.rs` (backed up) and creates `new.rs`
/// (no backup: it did not exist); the second edits `a.rs` again.
fn file_history_session() -> SessionFiles {
    let mut t = Transcript::main();
    let first = t.prompt("Add retries to a.rs\nand a new module.");
    t.bookkeeping(snapshot(&first, false, json!({})));
    t.bookkeeping(snapshot(
        &first,
        true,
        json!({"src/a.rs": backup(Some("aaaa000000000001@v1"), 1)}),
    ));
    t.bookkeeping(json!({"type": "file-history-delta", "messageId": first,
    "snapshot": {"messageId": first, "trackedFileBackups": {
        "src/new.rs": backup(None, 1),
        "../escape": backup(Some("../../secret"), 1),
    }}}));
    t.call("msg_1", OPUS, vec![text("Done.")], usage(), "end_turn");
    let second = t.prompt("Tidy a.rs.");
    t.bookkeeping(snapshot(
        &second,
        false,
        json!({"src/a.rs": backup(Some("aaaa000000000001@v2"), 2)}),
    ));
    t.call("msg_2", OPUS, vec![text("Tidied.")], usage(), "end_turn");
    let files = write_session(&t, &[]);
    let dir = format!("file-history/{SESSION_ID}");
    write_config_file(&files, &format!("{dir}/aaaa000000000001@v1"), "fn a() {}\n");
    write_config_file(
        &files,
        &format!("{dir}/aaaa000000000001@v2"),
        "BACKUP-ONLY-MARKER\n",
    );
    write_config_file(&files, "secret", "outside the backups\n");
    files
}

type FileSummary<'a> = Vec<(&'a str, Option<&'a str>, Option<u32>, bool)>;

fn summary(checkpoint: &FileCheckpoint) -> FileSummary<'_> {
    checkpoint
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.backup.as_deref(), f.version, f.changed))
        .collect()
}

fn file_history(files: &SessionFiles) -> FileHistory {
    artifacts(files)
        .file_history
        .expect("the session has file history")
}

#[test]
fn file_history_becomes_rewind_points_per_prompt() {
    let files = file_history_session();
    let history = file_history(&files);
    assert_eq!(
        history.dir,
        files.root.path().join("file-history").join(SESSION_ID)
    );
    let [first, second] = history.checkpoints.as_slice() else {
        panic!("two checkpoints: {:?}", history.checkpoints);
    };

    assert_eq!(first.number, 1);
    assert_eq!(first.prompt.as_deref(), Some("Add retries to a.rs"));
    assert_eq!(first.timestamp.as_deref(), Some("2026-09-20T10:00:00.000Z"));
    // Updates and deltas for the same prompt merge; the unsafe name is dropped.
    assert_eq!(
        summary(first),
        [
            ("src/a.rs", Some("aaaa000000000001@v1"), Some(1), true),
            ("src/new.rs", None, Some(1), true),
        ]
    );
    // The second prompt carries `new.rs` over unchanged.
    assert_eq!(second.prompt.as_deref(), Some("Tidy a.rs."));
    assert_eq!(
        summary(second),
        [
            ("src/a.rs", Some("aaaa000000000001@v2"), Some(2), true),
            ("src/new.rs", None, Some(1), false),
        ]
    );
}

#[test]
fn file_versions_are_read_only_on_request_and_only_when_named() {
    let files = file_history_session();
    let (provider, locator) = provider_and_locator(&files);
    let history = provider.file_history(&locator).unwrap().unwrap();
    let read = history
        .read_version("aaaa000000000001@v1", 1024)
        .unwrap()
        .unwrap();
    assert_eq!(read.content, "fn a() {}\n");
    assert_eq!(history.read_version("../../secret", 1024).unwrap(), None);
    assert_eq!(history.read_version("unlisted@v1", 1024).unwrap(), None);

    // Parsing never opens a backup: its content reaches no event.
    let snapshot = provider.load_snapshot(&locator, true, &|| false).unwrap();
    let events = serde_json::to_string(
        &snapshot
            .events
            .unwrap()
            .iter()
            .map(|e| &e.raw)
            .collect::<Vec<_>>(),
    )
    .unwrap();
    assert!(!events.contains("BACKUP-ONLY-MARKER"));
    assert!(
        snapshot
            .fingerprint
            .files
            .iter()
            .all(|(path, _)| !path.starts_with(files.root.path().join("file-history")))
    );
}

#[test]
fn a_session_without_backups_or_plans_has_neither() {
    let mut t = Transcript::main();
    t.prompt("Hello.");
    t.call("msg_1", OPUS, vec![text("Hi.")], usage(), "end_turn");
    let files = write_session(&t, &[]);
    let found = artifacts(&files);
    assert_eq!(found.plan, None);
    assert!(found.file_history.is_none());
    assert!(found.checkpoints.is_none() && found.todos.is_none());
}

/// The Explorer browses `subagents/` and `tool-results/` beside the
/// transcript, whether or not they exist yet; nothing is read to list them.
#[test]
fn explorer_roots_are_the_session_folders() {
    let mut t = Transcript::main();
    t.prompt("Hello.");
    let files = write_session(&t, &[]);
    let (provider, locator) = provider_and_locator(&files);
    let dir = files.main.with_extension("");
    let expected = vec![dir.join("subagents"), dir.join("tool-results")];
    assert_eq!(provider.file_roots(&locator).unwrap(), expected);
    assert_eq!(artifacts(&files).file_roots, expected);
    let root = provider.root().unwrap();
    assert!(expected.iter().all(|path| path.starts_with(root)));
    assert!(!Path::new(&expected[1]).exists());
}
