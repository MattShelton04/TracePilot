use std::path::Path;
use std::time::Instant;

fn main() {
    let sessions_dir = Path::new(r"C:\Users\mattt\.copilot\session-state");
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("bench_real.db");

    println!("Sessions dir: {}", sessions_dir.display());
    println!();

    // Phase 1 first (required for Phase 2)
    println!("=== Phase 1: reindex_all ===");
    let start = Instant::now();
    let result = tracepilot_indexer::reindex_all(sessions_dir, &db_path);
    let elapsed = start.elapsed();
    match result {
        Ok(count) => println!(
            "Indexed {} sessions in {:.2}s ({:.1} sessions/sec)",
            count,
            elapsed.as_secs_f64(),
            count as f64 / elapsed.as_secs_f64()
        ),
        Err(e) => println!("Error: {e}"),
    }

    // Phase 2 profiled breakdown
    println!("\n=== Phase 2: PROFILED reindex_search_content ===");
    profile_search_indexing(sessions_dir);
}

fn profile_search_indexing(sessions_dir: &Path) {
    // Step 1: Discovery
    let t0 = Instant::now();
    let sessions =
        tracepilot_core::session::discovery::discover_sessions(sessions_dir).unwrap();
    let discovery_time = t0.elapsed();
    println!(
        "  Discovery: {:.2}s ({} sessions)",
        discovery_time.as_secs_f64(),
        sessions.len()
    );

    // Fresh DB so all sessions need indexing
    let temp_dir2 = tempfile::tempdir().unwrap();
    let fresh_db_path = temp_dir2.path().join("phase2_profile.db");

    // Phase 1 on fresh DB first (required for FK constraints)
    tracepilot_indexer::reindex_all(sessions_dir, &fresh_db_path).unwrap();
    let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&fresh_db_path).unwrap();

    // Step 2: Staleness check
    let t1 = Instant::now();
    let mut to_index = Vec::new();
    for session in &sessions {
        if db.needs_search_reindex(&session.id, &session.path) {
            to_index.push(session);
        }
    }
    let staleness_time = t1.elapsed();
    println!(
        "  Staleness check: {:.2}s ({} need indexing)",
        staleness_time.as_secs_f64(),
        to_index.len()
    );

    // Step 3: Per-session parse + extract (sequential for profiling accuracy)
    println!("  Profiling per-session parse+extract...");
    let t2 = Instant::now();

    struct SessionTiming {
        id: String,
        parse_ms: u64,
        extract_ms: u64,
        rows: usize,
        file_size: u64,
    }

    let mut timings: Vec<SessionTiming> = Vec::new();
    let mut prepared_rows: Vec<(
        String,
        Vec<tracepilot_indexer::index_db::search_writer::SearchContentRow>,
    )> = Vec::new();

    for session in &to_index {
        let events_path = session.path.join("events.jsonl");
        if !events_path.exists() {
            continue;
        }

        let file_size = std::fs::metadata(&events_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let parse_start = Instant::now();
        let parsed = match tracepilot_core::parsing::events::parse_typed_events(&events_path) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let parse_ms = parse_start.elapsed().as_millis() as u64;

        let extract_start = Instant::now();
        let rows = tracepilot_indexer::index_db::search_writer::extract_search_content(
            &session.id,
            &parsed.events,
        );
        let extract_ms = extract_start.elapsed().as_millis() as u64;

        timings.push(SessionTiming {
            id: session.id.clone(),
            parse_ms,
            extract_ms,
            rows: rows.len(),
            file_size,
        });
        prepared_rows.push((session.id.clone(), rows));
    }
    let parse_extract_time = t2.elapsed();

    let total_parse_ms: u64 = timings.iter().map(|t| t.parse_ms).sum();
    let total_extract_ms: u64 = timings.iter().map(|t| t.extract_ms).sum();
    let total_rows: usize = timings.iter().map(|t| t.rows).sum();
    let total_file_bytes: u64 = timings.iter().map(|t| t.file_size).sum();
    let combined = (total_parse_ms + total_extract_ms).max(1);

    println!(
        "  Parse+Extract: {:.2}s",
        parse_extract_time.as_secs_f64()
    );
    println!(
        "    Parse total: {:.2}s ({:.1}%)",
        total_parse_ms as f64 / 1000.0,
        total_parse_ms as f64 / combined as f64 * 100.0
    );
    println!(
        "    Extract total: {:.2}s ({:.1}%)",
        total_extract_ms as f64 / 1000.0,
        total_extract_ms as f64 / combined as f64 * 100.0
    );
    println!(
        "    Data read: {:.1} MB across {} sessions",
        total_file_bytes as f64 / 1024.0 / 1024.0,
        timings.len()
    );
    println!("    FTS rows extracted: {}", total_rows);

    timings.sort_by(|a, b| b.parse_ms.cmp(&a.parse_ms));
    println!("    Top 10 slowest to parse:");
    for t in timings.iter().take(10) {
        let label_len = 8.min(t.id.len());
        println!(
            "      {}ms parse + {}ms extract — {} ({:.1} MB, {} rows)",
            t.parse_ms,
            t.extract_ms,
            &t.id[..label_len],
            t.file_size as f64 / 1024.0 / 1024.0,
            t.rows
        );
    }

    // Step 4a: Sequential FTS5 writes (UNBATCHED — baseline)
    println!("\n  Profiling FTS5 writes (unbatched)...");
    let t3 = Instant::now();

    struct WriteTiming {
        id: String,
        write_ms: u64,
        rows: usize,
    }
    let mut write_timings: Vec<WriteTiming> = Vec::new();

    for (session_id, rows) in &prepared_rows {
        let write_start = Instant::now();
        let _ = db.upsert_search_content(session_id, rows);
        let write_ms = write_start.elapsed().as_millis() as u64;
        write_timings.push(WriteTiming {
            id: session_id.clone(),
            write_ms,
            rows: rows.len(),
        });
    }
    let unbatched_time = t3.elapsed();

    let total_write_ms: u64 = write_timings.iter().map(|t| t.write_ms).sum();
    write_timings.sort_by(|a, b| b.write_ms.cmp(&a.write_ms));

    println!("  FTS5 Writes (unbatched): {:.2}s", unbatched_time.as_secs_f64());
    println!(
        "    Cumulative: {:.2}s",
        total_write_ms as f64 / 1000.0
    );
    println!("    Top 5 slowest writes:");
    for t in write_timings.iter().take(5) {
        let label_len = 8.min(t.id.len());
        println!(
            "      {}ms — {} ({} rows)",
            t.write_ms,
            &t.id[..label_len],
            t.rows
        );
    }

    // Step 4b: BULK write with FTS rebuild (optimized path)
    // Use a fresh DB so writes go through FTS triggers again
    let temp_dir3 = tempfile::tempdir().unwrap();
    let bulk_db_path = temp_dir3.path().join("bulk_profile.db");
    tracepilot_indexer::reindex_all(sessions_dir, &bulk_db_path).unwrap();
    let db2 = tracepilot_indexer::index_db::IndexDb::open_or_create(&bulk_db_path).unwrap();

    println!("\n  Profiling FTS5 writes (BULK: triggers off + rebuild)...");
    let t4 = Instant::now();
    let _ = db2.bulk_write_search_content(&prepared_rows);
    let bulk_time = t4.elapsed();

    let speedup = unbatched_time.as_secs_f64() / bulk_time.as_secs_f64();
    println!("  FTS5 Writes (bulk):      {:.2}s", bulk_time.as_secs_f64());
    println!(
        "  ⚡ Speedup: {:.1}x ({:.2}s → {:.2}s)",
        speedup,
        unbatched_time.as_secs_f64(),
        bulk_time.as_secs_f64()
    );

    // Summary
    let grand_total = (total_parse_ms + total_extract_ms + total_write_ms).max(1);
    println!("\n=== PHASE 2 CPU TIME BREAKDOWN ===");
    println!(
        "  JSON Parsing:      {:.2}s ({:.1}%)",
        total_parse_ms as f64 / 1000.0,
        total_parse_ms as f64 / grand_total as f64 * 100.0
    );
    println!(
        "  Content Extract:   {:.2}s ({:.1}%)",
        total_extract_ms as f64 / 1000.0,
        total_extract_ms as f64 / grand_total as f64 * 100.0
    );
    println!(
        "  FTS5 DB Writes:    {:.2}s ({:.1}%)",
        total_write_ms as f64 / 1000.0,
        total_write_ms as f64 / grand_total as f64 * 100.0
    );
    println!(
        "  Data processed:    {:.1} MB → {} FTS rows from {} sessions",
        total_file_bytes as f64 / 1024.0 / 1024.0,
        total_rows,
        timings.len()
    );
}
