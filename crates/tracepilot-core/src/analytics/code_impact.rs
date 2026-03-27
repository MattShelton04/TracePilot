//! Code impact analysis computation.
//!
//! Contains [`compute_code_impact`] which produces file change aggregation,
//! file type breakdown, and daily change trends.

use std::collections::{BTreeMap, HashMap};

use super::types::*;

/// Compute code impact analysis across all sessions.
///
/// PERF: CPU-bound — iterates all sessions once. O(n) where n = session count.
/// Lighter than compute_tool_analysis since it only needs summary data.
///
/// Only requires `SessionSummary` data (no turns needed).
#[tracing::instrument(skip_all, fields(session_count = sessions.len()))]
pub fn compute_code_impact(sessions: &[SessionAnalyticsInput]) -> CodeImpactData {
    let mut total_lines_added: u64 = 0;
    let mut total_lines_removed: u64 = 0;
    let mut file_counts: HashMap<String, u32> = HashMap::new(); // path → modification count
    let mut ext_counts: HashMap<String, u32> = HashMap::new();
    let mut changes_by_day: BTreeMap<String, (u64, u64)> = BTreeMap::new(); // date → (add, del)

    for input in sessions {
        let summary = &input.summary;
        let metrics = match &summary.shutdown_metrics {
            Some(m) => m,
            None => continue,
        };
        let code_changes = match &metrics.code_changes {
            Some(cc) => cc,
            None => continue,
        };

        let added = code_changes.lines_added.unwrap_or(0);
        let removed = code_changes.lines_removed.unwrap_or(0);
        total_lines_added += added;
        total_lines_removed += removed;

        // Date key (UTC)
        let date_key = summary.date_key();

        if let Some(ref date) = date_key {
            let entry = changes_by_day.entry(date.clone()).or_insert((0, 0));
            entry.0 += added;
            entry.1 += removed;
        }

        // File tracking
        if let Some(ref files) = code_changes.files_modified {
            for file in files {
                *file_counts.entry(file.clone()).or_insert(0) += 1;

                // Extension tracking
                let ext = std::path::Path::new(file)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("(no ext)")
                    .to_string();
                *ext_counts.entry(ext).or_insert(0) += 1;
            }
        }
    }

    let total_files: u32 = file_counts.len() as u32;

    // File type breakdown with percentages
    let total_ext_count: u32 = ext_counts.values().sum();
    let mut file_type_breakdown: Vec<FileTypeEntry> = ext_counts
        .into_iter()
        .map(|(extension, count)| {
            let percentage = if total_ext_count > 0 {
                (count as f64 / total_ext_count as f64) * 100.0
            } else {
                0.0
            };
            FileTypeEntry {
                extension,
                count,
                percentage,
            }
        })
        .collect();
    file_type_breakdown.sort_by(|a, b| b.count.cmp(&a.count));

    // Most modified files (by frequency, since we don't have per-file line counts)
    let mut most_modified_files: Vec<ModifiedFileEntry> = file_counts
        .into_iter()
        .map(|(path, count)| ModifiedFileEntry {
            path,
            additions: count as u64, // modification count
            deletions: 0,            // not available per-file
        })
        .collect();
    most_modified_files.sort_by(|a, b| b.additions.cmp(&a.additions));
    most_modified_files.truncate(20); // Top 20

    // Changes by day
    let changes_by_day_vec: Vec<DayChanges> = changes_by_day
        .into_iter()
        .map(|(date, (additions, deletions))| DayChanges {
            date,
            additions,
            deletions,
        })
        .collect();

    let net_change = total_lines_added as i64 - total_lines_removed as i64;

    CodeImpactData {
        files_modified: total_files,
        lines_added: total_lines_added,
        lines_removed: total_lines_removed,
        net_change,
        file_type_breakdown,
        most_modified_files,
        changes_by_day: changes_by_day_vec,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_helpers::*;

    #[test]
    fn test_code_impact_empty() {
        let result = compute_code_impact(&[]);
        assert_eq!(result.files_modified, 0);
        assert_eq!(result.lines_added, 0);
        assert_eq!(result.lines_removed, 0);
        assert_eq!(result.net_change, 0);
    }

    #[test]
    fn test_code_impact_single_session() {
        let sessions = vec![make_input_with_code(
            "s1", "2026-01-15", 100, 30,
            vec!["src/main.rs", "src/lib.rs", "README.md"],
        )];
        let result = compute_code_impact(&sessions);

        assert_eq!(result.files_modified, 3);
        assert_eq!(result.lines_added, 100);
        assert_eq!(result.lines_removed, 30);
        assert_eq!(result.net_change, 70);
    }

    #[test]
    fn test_code_impact_file_type_breakdown() {
        let sessions = vec![make_input_with_code(
            "s1", "2026-01-15", 100, 30,
            vec!["src/main.rs", "src/lib.rs", "src/app.ts", "README.md"],
        )];
        let result = compute_code_impact(&sessions);

        assert_eq!(result.file_type_breakdown.len(), 3); // rs, ts, md
        let rs = result.file_type_breakdown.iter().find(|e| e.extension == "rs").unwrap();
        assert_eq!(rs.count, 2);
    }

    #[test]
    fn test_code_impact_multiple_sessions_same_files() {
        let sessions = vec![
            make_input_with_code("s1", "2026-01-15", 50, 10, vec!["src/main.rs"]),
            make_input_with_code("s2", "2026-01-16", 80, 20, vec!["src/main.rs", "src/lib.rs"]),
        ];
        let result = compute_code_impact(&sessions);

        assert_eq!(result.files_modified, 2); // unique files
        assert_eq!(result.lines_added, 130);
        assert_eq!(result.lines_removed, 30);

        // main.rs modified in 2 sessions (most modified)
        assert_eq!(result.most_modified_files[0].path, "src/main.rs");
        assert_eq!(result.most_modified_files[0].additions, 2); // 2 modifications
    }

    #[test]
    fn test_code_impact_negative_net_change() {
        let sessions = vec![make_input_with_code(
            "s1", "2026-01-15", 10, 100,
            vec!["src/main.rs"],
        )];
        let result = compute_code_impact(&sessions);
        assert_eq!(result.net_change, -90);
    }

    #[test]
    fn test_code_impact_no_shutdown_metrics() {
        let mut input = make_input("s1", "2026-01-15", "model", 1000, 0.5, 5);
        input.summary.shutdown_metrics = None;
        let result = compute_code_impact(&[input]);

        assert_eq!(result.files_modified, 0);
        assert_eq!(result.lines_added, 0);
    }

    #[test]
    fn test_code_impact_changes_by_day() {
        let sessions = vec![
            make_input_with_code("s1", "2026-01-15", 50, 10, vec!["a.rs"]),
            make_input_with_code("s2", "2026-01-15", 30, 5, vec!["b.rs"]),
            make_input_with_code("s3", "2026-01-16", 80, 20, vec!["c.rs"]),
        ];
        let result = compute_code_impact(&sessions);

        assert_eq!(result.changes_by_day.len(), 2);
        let jan15 = result.changes_by_day.iter().find(|d| d.date == "2026-01-15").unwrap();
        assert_eq!(jan15.additions, 80);
        assert_eq!(jan15.deletions, 15);
    }

    #[test]
    fn test_code_impact_no_extension_files() {
        let sessions = vec![make_input_with_code(
            "s1", "2026-01-15", 10, 5,
            vec!["Makefile", "Dockerfile", ".gitignore"],
        )];
        let result = compute_code_impact(&sessions);

        // Files without extension should be grouped under "(no ext)"
        let no_ext = result.file_type_breakdown.iter().find(|e| e.extension == "(no ext)").unwrap();
        assert_eq!(no_ext.count, 3);
    }
}
