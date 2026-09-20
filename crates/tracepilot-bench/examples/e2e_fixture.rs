//! Native E2E corpus. Reuses benchmark events, but never prebuilds the app index/config.
use std::{error::Error, fs, path::Path};

use serde_json::json;
use tracepilot_bench::SessionFixtureBuilder;

const SESSION_COUNT: usize = 128;

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
    for index in 0..SESSION_COUNT {
        let (title, turns) = match index {
            0 => ("E2E orchard refactor".to_string(), 4),
            1 => ("E2E river tests".to_string(), 2),
            2 => ("E2E empty session".to_string(), 0),
            _ => (
                format!("Synthetic bulk session {index:03}"),
                if index % 16 == 0 { 120 } else { 1 + index % 32 },
            ),
        };
        let repository = if index < 3 {
            "github.com/example/orchard".to_string()
        } else {
            format!("github.com/example/bulk-{}", index % 4)
        };
        let model = [
            "claude-sonnet-4-20250514",
            "gpt-4.1",
            "claude-haiku-4-20250514",
        ][index % 3];
        let start = "2025-01-01T08:00:00Z".parse::<chrono::DateTime<chrono::Utc>>()?
            + chrono::Duration::days(index as i64 * 3);
        let completed = turns > 0 && (index < 3 || index % 7 != 0);
        let tool_calls = turns * (if index < 3 { 2 } else { 1 + index % 3 });
        let failed_tools = usize::from(index > 2 && index % 11 == 0);
        let id = uuid::Uuid::from_u128(0xe2e00000_0000_4000_8000_000000000000 + index as u128)
            .to_string();
        let dir = root.join("copilot/session-state").join(&id);
        fs::create_dir(&dir)?;
        let mut events = SessionFixtureBuilder::new()
            .turn_count(turns)
            .tool_call_count(tool_calls)
            .build_events_for(&id);
        // Model an auto-created session before its first event is written.
        // The benchmark builder always supplies start/shutdown metadata.
        if turns == 0 {
            events.clear();
        }
        if turns > 0 && !completed {
            events.pop(); // No shutdown telemetry for an interrupted session.
            events.pop(); // Last assistant turn remains unfinished.
        }
        let interval = 1 + index as i64 % 17;
        for (offset, event) in events.iter_mut().enumerate() {
            event["timestamp"] = json!(
                (start + chrono::Duration::seconds((offset as i64 + 1) * interval)).to_rfc3339()
            );
        }
        if let Some(first) = events.first_mut() {
            first["data"]["context"]["repository"] = json!(repository);
        }
        if failed_tools > 0 {
            let tool = events
                .iter_mut()
                .find(|e| e["type"] == "tool.execution_complete")
                .unwrap();
            tool["data"]["success"] = json!(false);
            tool["data"]["result"] = json!("Synthetic tool failure: requested file does not exist");
        }
        let duration = events.len() as i64 * interval;
        if let Some(shutdown) = events.iter_mut().find(|e| e["type"] == "session.shutdown") {
            let metrics = shutdown["data"]["modelMetrics"].as_object_mut().unwrap();
            let usage = metrics.remove("claude-sonnet-4-20250514").unwrap();
            metrics.insert(model.to_string(), usage);
            shutdown["data"]["currentModel"] = json!(model);
            shutdown["data"]["sessionStartTime"] = json!(start.timestamp_millis());
            shutdown["data"]["totalApiDurationMs"] = json!(duration * 1000);
        }
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
                "id: {id}\nname: {title}\nuser_named: true\ncwd: C:/synthetic/orchard\nrepository: {repository}\nbranch: e2e\nhost_type: cli\ncreated_at: {:?}\nupdated_at: {:?}\n",
                start.to_rfc3339(),
                (start + chrono::Duration::seconds(duration)).to_rfc3339()
            ),
        )?;
        if index < 2 {
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
        sessions.push(json!({ "id": id, "title": title, "turns": turns, "events": events.len(), "searchTerm": search_term,
            "repository": repository, "model": model, "date": start.format("%Y-%m-%d").to_string(),
            "completed": completed, "toolCalls": tool_calls, "failedTools": failed_tools,
            "tokens": if completed { turns * 1000 } else { 0 } }));
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
            SESSION_COUNT
        );
        assert_eq!(
            tracepilot_indexer::reindex_search_content(&sessions, &db_path, |_| {}, || false)
                .unwrap(),
            (SESSION_COUNT, 0)
        );
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&db_path).unwrap();
        let results = db
            .query_content(Some("orchardneedle0"), &Default::default())
            .unwrap();
        assert_eq!(results.len(), 1);
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("fixture.json")).unwrap()).unwrap();
        let entries = manifest["sessions"].as_array().unwrap();
        let months: std::collections::BTreeSet<_> = entries
            .iter()
            .map(|entry| &entry["date"].as_str().unwrap()[..7])
            .collect();
        assert!(months.len() >= 12, "corpus spans at least a year");
        for index in [0, 2, 7, 11, 16] {
            let entry = &entries[index];
            let summary = tracepilot_core::summary::load_session_summary(
                &sessions.join(entry["id"].as_str().unwrap()),
            )
            .unwrap();
            assert_eq!(
                summary.turn_count.unwrap_or(0),
                entry["turns"].as_u64().unwrap() as usize
            );
            assert_eq!(
                summary.shutdown_metrics.is_some(),
                entry["completed"].as_bool().unwrap()
            );
        }
        let session = sessions.join(manifest["sessions"][0]["id"].as_str().unwrap());
        let empty = sessions.join(manifest["sessions"][2]["id"].as_str().unwrap());
        assert_eq!(
            tracepilot_core::summary::load_session_summary(&empty)
                .unwrap()
                .turn_count
                .unwrap_or(0),
            0
        );
        assert_eq!(
            tracepilot_core::parsing::session_db::read_todos(&session.join("session.db"))
                .unwrap()
                .len(),
            2
        );
    }
}
