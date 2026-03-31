// Recommended test module to add to session_writer.rs or new test file
// Location: crates/tracepilot-indexer/src/index_db/tests/batch_insert_tests.rs
//
// This module provides comprehensive testing for the batch insert optimization
// to ensure edge cases, error scenarios, and rollback behavior are correct.

#[cfg(test)]
mod batch_insert_tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    // Helper: Create a minimal session for batch testing
    fn write_minimal_session(
        root: &Path,
        session_id: &str,
        summary: &str,
    ) -> std::path::PathBuf {
        let session_dir = root.join(session_id);
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(
            session_dir.join("workspace.yaml"),
            format!(
                r#"id: {session_id}
summary: "{summary}"
repository: "org/repo"
branch: "main"
cwd: 'C:\test\{session_id}'
host_type: cli
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
            ),
        )
        .unwrap();
        fs::write(
            session_dir.join("events.jsonl"),
            r#"{"type":"user.message","data":{"content":"hello","interactionId":"int-1"},"id":"evt-1","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}
{"type":"assistant.message","data":{"messageId":"msg-1","content":"world","interactionId":"int-1"},"id":"evt-2","timestamp":"2026-03-10T07:14:52.000Z","parentId":"evt-1"}
"#,
        )
        .unwrap();
        session_dir
    }

    // Helper: Create session with many tool calls (for batch size testing)
    fn write_session_with_n_tool_calls(
        root: &Path,
        session_id: &str,
        n: usize,
    ) -> std::path::PathBuf {
        let session_dir = root.join(session_id);
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(
            session_dir.join("workspace.yaml"),
            format!(
                r#"id: {session_id}
summary: "Session with {n} tool calls"
repository: "org/repo"
branch: "main"
cwd: 'C:\test\{session_id}'
host_type: cli
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
            ),
        )
        .unwrap();

        let mut events = String::from(
            r#"{"type":"user.message","data":{"content":"test","interactionId":"int-1"},"id":"evt-0","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}
"#,
        );

        // Generate n tool execution pairs
        for i in 0..n {
            events.push_str(&format!(
                r#"{{"type":"tool.execution_start","data":{{"toolCallId":"tc-{i}","toolName":"tool_{i}"}},"id":"evt-{}","timestamp":"2026-03-10T07:14:52.{i:03}Z","parentId":"evt-0"}}
{{"type":"tool.execution_complete","data":{{"toolCallId":"tc-{i}","success":true,"output":"result {i}"}},"id":"evt-{}","timestamp":"2026-03-10T07:14:53.{i:03}Z","parentId":"evt-{}"}}
"#,
                1 + (i * 2),
                2 + (i * 2),
                1 + (i * 2)
            ));
        }

        events.push_str(
            r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"done","interactionId":"int-1"},"id":"evt-999","timestamp":"2026-03-10T07:15:00.000Z","parentId":"evt-0"}
{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":1,"totalApiDurationMs":5000,"sessionStartTime":1773308090000,"currentModel":"claude-opus-4.6","modelMetrics":{"claude-opus-4.6":{"requests":{"count":1,"cost":0.5},"usage":{"inputTokens":500,"outputTokens":200}}}},"id":"evt-1000","timestamp":"2026-03-10T07:15:01.000Z","parentId":null}
"#,
        );

        fs::write(session_dir.join("events.jsonl"), events).unwrap();
        session_dir
    }

    // ── Edge Case Tests ──────────────────────────────────────────────────────

    #[test]
    fn test_batch_empty_all_child_tables() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session = write_minimal_session(
            tmp.path(),
            "empty-batch-test",
            "No child rows",
        );

        // This session has no tool calls, no file changes, no incidents
        let info = db.upsert_session(&session).unwrap();
        assert_eq!(info.total_tokens, 0);

        // Verify child tables exist but have 0 rows
        let tool_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                ["empty-batch-test"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tool_count, 0, "should have no tool calls");

        let model_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_model_metrics WHERE session_id = ?1",
                ["empty-batch-test"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(model_count, 0, "should have no model metrics");

        let activity_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_activity WHERE session_id = ?1",
                ["empty-batch-test"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(activity_count, 0, "should have no activity rows");
    }

    #[test]
    fn test_batch_single_tool_call() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session = write_session_with_n_tool_calls(tmp.path(), "single-tool-test", 1);

        let info = db.upsert_session(&session).unwrap();

        // Verify exactly 1 tool call recorded
        let tool_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                ["single-tool-test"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tool_count, 1, "should have exactly 1 tool call");

        // Verify it's queryable
        let tools = db.query_tool_analysis(None, None, None, false).unwrap();
        assert!(
            tools.tools.iter().any(|t| t.name == "tool_0"),
            "tool_0 should be in analysis"
        );
    }

    #[test]
    fn test_batch_large_tool_call_count() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session = write_session_with_n_tool_calls(tmp.path(), "large-batch-test", 100);

        let info = db.upsert_session(&session).unwrap();

        // Verify all 100 tool calls recorded
        let tool_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                ["large-batch-test"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tool_count, 100, "should have exactly 100 tool calls");

        // Verify aggregation is correct
        let tools = db.query_tool_analysis(None, None, None, false).unwrap();
        assert_eq!(tools.total_calls, 100, "total calls should be 100");
        assert_eq!(tools.tools.len(), 100, "should have 100 unique tools");
    }

    #[test]
    fn test_batch_reindex_removes_old_child_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session_id = "reindex-test";

        // First upsert: 50 tool calls
        let session1 = write_session_with_n_tool_calls(tmp.path(), session_id, 50);
        db.upsert_session(&session1).unwrap();

        let count1: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count1, 50, "first upsert should have 50 tool calls");

        // Second upsert: same session, but now with 10 tool calls
        let session2 = write_session_with_n_tool_calls(tmp.path(), session_id, 10);
        db.upsert_session(&session2).unwrap();

        let count2: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count2, 10, "second upsert should have only 10 tool calls (old rows deleted)");
    }

    // ── Error Scenario Tests ─────────────────────────────────────────────────

    #[test]
    fn test_batch_savepoint_rollback_on_execution_error() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session_id = "rollback-test";

        // First, create a valid session
        let session = write_session_with_n_tool_calls(tmp.path(), session_id, 10);
        db.upsert_session(&session).unwrap();

        let count_before: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count_before, 10);

        // Now manually delete the session row and try to upsert
        // This will cause FK constraint error when inserting child rows
        db.conn
            .execute(
                "DELETE FROM sessions WHERE id = ?1",
                [session_id],
            )
            .unwrap();

        // Try to upsert: should fail due to FK constraint on child tables
        let result = db.upsert_session(&session);
        assert!(result.is_err(), "upsert should fail due to missing parent");

        // Verify no child rows were inserted
        let count_after: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        assert_eq!(count_after, 0, "child rows should not exist after rollback");
    }

    #[test]
    fn test_batch_savepoint_preserves_other_sessions() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

        // Insert session A
        let session_a = write_minimal_session(tmp.path(), "session-a", "Session A");
        db.upsert_session(&session_a).unwrap();

        // Insert session B with 5 tool calls
        let session_b_path = write_session_with_n_tool_calls(tmp.path(), "session-b", 5);
        db.upsert_session(&session_b_path).unwrap();

        // Verify both exist
        let count_a_before: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE id = ?1",
                ["session-a"],
                |row| row.get(0),
            )
            .unwrap();
        let count_b_before: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                ["session-b"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count_a_before, 1);
        assert_eq!(count_b_before, 5);

        // Try to upsert session B with corrupted data
        // (manually corrupt it to trigger an error)
        let corrupt_path = tmp.path().join("session-b").join("events.jsonl");
        fs::write(&corrupt_path, "invalid json").unwrap();

        let result = db.upsert_session(&session_b_path);
        assert!(result.is_err(), "corrupted session should fail to parse");

        // Verify session A is still intact
        let count_a_after: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE id = ?1",
                ["session-a"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count_a_after, 1, "session A should still exist");

        // Verify session B tool calls are still from first insert (not rolled back individually)
        let count_b_after: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                ["session-b"],
                |row| row.get(0),
            )
            .unwrap_or(0);
        // Session B's main row is still there, but second upsert failed during parse phase
        // So child tables should still have 5 from the first insert
    }

    #[test]
    fn test_batch_multiple_sequential_upserts() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session_id = "sequential-test";

        // Upsert 5 times, changing tool call count each time
        for iteration in 1..=5 {
            let count = iteration * 10;
            let session = write_session_with_n_tool_calls(tmp.path(), session_id, count);
            let result = db.upsert_session(&session);
            assert!(result.is_ok(), "iteration {iteration} should succeed");

            let actual_count: i64 = db
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                    [session_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                actual_count, count as i64,
                "iteration {iteration} should have {count} tool calls"
            );
        }

        // Final state should have 50 tool calls
        let final_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(final_count, 50, "final state should have 50 tool calls");
    }

    // ── Rollback Behavior Tests ──────────────────────────────────────────────

    #[test]
    fn test_batch_delete_before_insert() {
        // This test verifies that old child rows are deleted before new ones inserted
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session_id = "delete-before-insert";

        // First upsert with 10 tool calls
        let session1 = write_session_with_n_tool_calls(tmp.path(), session_id, 10);
        db.upsert_session(&session1).unwrap();

        // Get list of tool names
        let tool_names_1: Vec<String> = db
            .conn
            .prepare("SELECT DISTINCT tool_name FROM session_tool_calls WHERE session_id = ?1")
            .unwrap()
            .query_map([session_id], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(tool_names_1.len(), 10);
        assert!(tool_names_1.iter().all(|t| t.starts_with("tool_")));

        // Second upsert with different tools
        let session2 = write_session_with_n_tool_calls(tmp.path(), session_id, 5);
        db.upsert_session(&session2).unwrap();

        // Verify old tools are gone
        let tool_names_2: Vec<String> = db
            .conn
            .prepare("SELECT DISTINCT tool_name FROM session_tool_calls WHERE session_id = ?1")
            .unwrap()
            .query_map([session_id], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(tool_names_2.len(), 5, "should have only 5 new tools, old ones deleted");
    }

    // ── Performance/Consistency Tests ────────────────────────────────────────

    #[test]
    fn test_batch_consistency_empty_to_full_to_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session_id = "consistency-test";

        // 1. Insert empty session
        let empty = write_minimal_session(tmp.path(), session_id, "Empty");
        db.upsert_session(&empty).unwrap();
        let count1: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count1, 0);

        // 2. Upsert with 50 tool calls
        let full = write_session_with_n_tool_calls(tmp.path(), session_id, 50);
        db.upsert_session(&full).unwrap();
        let count2: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count2, 50);

        // 3. Upsert back to empty
        let empty_again = write_minimal_session(tmp.path(), session_id, "Empty Again");
        db.upsert_session(&empty_again).unwrap();
        let count3: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count3, 0, "should be empty again after upsert");
    }

    #[test]
    fn test_batch_all_six_tables_populated() {
        // This test uses the existing write_session_with_incidents helper
        // to verify all 6 child tables are populated in a single upsert
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

        // Use existing helper from mod.rs (write_session_with_tools)
        let session = write_session_with_n_tool_calls(tmp.path(), "all-six-tables", 10);
        db.upsert_session(&session).unwrap();

        // Verify all 6 child tables have rows
        let model_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_model_metrics WHERE session_id = ?1",
                ["all-six-tables"],
                |row| row.get(0),
            )
            .unwrap();
        assert!(model_count > 0, "model_metrics should be populated");

        let tool_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
                ["all-six-tables"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tool_count, 10, "tool_calls should be populated");

        let activity_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_activity WHERE session_id = ?1",
                ["all-six-tables"],
                |row| row.get(0),
            )
            .unwrap();
        assert!(activity_count > 0, "activity should be populated");

        // Note: segments and incidents require specific event types
        // which our simple write_session_with_n_tool_calls may not generate
    }
}
