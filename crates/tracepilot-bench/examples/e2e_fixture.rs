//! Small native E2E corpus. Reuses benchmark events, but never prebuilds the app index/config.
use std::{error::Error, fs, path::Path};

use serde_json::json;
use tracepilot_bench::SessionFixtureBuilder;

fn main() -> Result<(), Box<dyn Error>> {
    let root = std::env::args_os()
        .nth(1)
        .ok_or("expected an absolute new data root")?;
    generate(Path::new(&root))
}

fn generate(root: &Path) -> Result<(), Box<dyn Error>> {
    if !root.is_absolute() || root.exists() {
        return Err("fixture root must be absolute and must not already exist".into());
    }
    fs::create_dir_all(root.join("copilot/session-state"))?;
    let mut sessions = Vec::new();
    for (index, (title, turns)) in [
        ("E2E orchard refactor", 4),
        ("E2E river tests", 2),
        ("E2E empty session", 0),
    ]
    .into_iter()
    .enumerate()
    {
        let id = uuid::Uuid::from_u128(0xe2e00000_0000_4000_8000_000000000000 + index as u128)
            .to_string();
        let dir = root.join("copilot/session-state").join(&id);
        fs::create_dir(&dir)?;
        let mut events = SessionFixtureBuilder::new()
            .turn_count(turns)
            .tool_call_count(turns * 2)
            .build_events_for(&id);
        let search_term = format!("orchardneedle{index}");
        if let Some(event) = events.iter_mut().find(|e| e["type"] == "user.message") {
            event["data"]["content"] = json!(format!(
                "Please investigate {search_term} and add regression tests."
            ));
        }
        let jsonl = events
            .iter()
            .map(serde_json::to_string)
            .collect::<Result<Vec<_>, _>>()?
            .join("\n")
            + "\n";
        fs::write(dir.join("events.jsonl"), jsonl)?;
        fs::write(
            dir.join("workspace.yaml"),
            format!(
                "id: {id}\nname: {title}\nuser_named: true\ncwd: C:/synthetic/orchard\nrepository: github.com/example/orchard\nbranch: e2e\nhost_type: cli\ncreated_at: \"2025-01-01T00:00:00Z\"\nupdated_at: \"2025-01-01T01:00:00Z\"\n"
            ),
        )?;
        if turns > 0 {
            fs::write(
                dir.join("plan.md"),
                "# Orchard implementation plan\n\nVerify the parser, index, and desktop together.\n",
            )?;
            let db = rusqlite::Connection::open(dir.join("session.db"))?;
            db.execute_batch("CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL, created_at TEXT, updated_at TEXT);
                INSERT INTO todos VALUES ('parse', 'Verify orchard parser', 'Read synthetic events', 'done', NULL, NULL);
                INSERT INTO todos VALUES ('test', 'Add orchard regression coverage', NULL, 'pending', NULL, NULL);
                CREATE TABLE todo_deps (todo_id TEXT, depends_on TEXT, PRIMARY KEY (todo_id, depends_on));
                INSERT INTO todo_deps VALUES ('test', 'parse');")?;
        }
        sessions.push(json!({ "id": id, "title": title, "turns": turns, "events": events.len(), "searchTerm": search_term }));
    }
    fs::write(
        root.join("fixture.json"),
        serde_json::to_vec_pretty(&json!({ "version": 1, "sessions": sessions }))?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_corpus_is_discoverable_and_real_index_can_search_it() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("new data root");
        generate(&root).unwrap();
        assert!(
            !root.join("tracepilot").exists(),
            "app owns first-run config and index"
        );
        assert!(generate(&root).is_err(), "never overwrite an existing root");
        let sessions = root.join("copilot/session-state");
        let db_path = temp.path().join("verify.db");
        assert_eq!(
            tracepilot_indexer::reindex_all(&sessions, &db_path).unwrap(),
            3
        );
        assert_eq!(
            tracepilot_indexer::reindex_search_content(&sessions, &db_path, |_| {}, || false)
                .unwrap(),
            (3, 0)
        );
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&db_path).unwrap();
        let results = db
            .query_content(Some("orchardneedle0"), &Default::default())
            .unwrap();
        assert_eq!(results.len(), 1);
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("fixture.json")).unwrap()).unwrap();
        let session = sessions.join(manifest["sessions"][0]["id"].as_str().unwrap());
        assert_eq!(
            tracepilot_core::parsing::session_db::read_todos(&session.join("session.db"))
                .unwrap()
                .len(),
            2
        );
    }
}
