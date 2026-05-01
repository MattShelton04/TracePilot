use crate::Result;
use rusqlite::{Connection, params_from_iter};

use tracepilot_core::analytics::types::*;

use super::super::helpers::*;

pub(super) fn query_code_impact(
    conn: &Connection,
    from_date: Option<&str>,
    to_date: Option<&str>,
    repo: Option<&str>,
    hide_empty: bool,
) -> Result<CodeImpactData> {
    let (where_clause, bind_values) = build_date_repo_filter(from_date, to_date, repo, hide_empty);

    // Aggregate lines
    let agg_sql = format!(
        "SELECT COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s{}",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let (total_added, total_removed): (i64, i64) =
        conn.query_row(&agg_sql, params_from_iter(refs.iter().copied()), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;

    // File type breakdown from session_modified_files
    let ext_sql = format!(
        "SELECT COALESCE(f.extension, '(no ext)'), COUNT(*)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{}
             GROUP BY f.extension ORDER BY COUNT(*) DESC",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let mut ext_stmt = conn.prepare(&ext_sql)?;
    let ext_rows = ext_stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
    })?;
    let mut file_type_entries: Vec<(String, u32)> = Vec::new();
    let mut total_ext_count: u32 = 0;
    for row in ext_rows {
        let (ext, count) = row?;
        total_ext_count += count;
        file_type_entries.push((ext, count));
    }
    let file_type_breakdown: Vec<FileTypeEntry> = file_type_entries
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

    // Most modified files (by number of sessions)
    let mf_sql = format!(
        "SELECT f.file_path, COUNT(DISTINCT f.session_id)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{}
             GROUP BY f.file_path ORDER BY COUNT(DISTINCT f.session_id) DESC LIMIT 20",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let mut mf_stmt = conn.prepare(&mf_sql)?;
    let mf_rows = mf_stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
    })?;
    let mut most_modified_files: Vec<ModifiedFileEntry> = Vec::new();
    for row in mf_rows {
        let (path, count) = row?;
        most_modified_files.push(ModifiedFileEntry {
            path,
            additions: count,
            deletions: 0,
        });
    }

    // Total distinct files
    let fc_sql = format!(
        "SELECT COUNT(DISTINCT f.file_path)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{}",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let files_modified: u32 =
        conn.query_row(&fc_sql, params_from_iter(refs.iter().copied()), |row| {
            row.get(0)
        })?;

    // Changes by day
    let cbd_sql = format!(
        "SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s
             WHERE 1=1{} AND d IS NOT NULL
             GROUP BY d ORDER BY d",
        &where_clause[" WHERE 1=1".len()..]
    );
    let refs = to_refs(&bind_values);
    let mut cbd_stmt = conn.prepare(&cbd_sql)?;
    let cbd_rows = cbd_stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, u64>(1)?,
            row.get::<_, u64>(2)?,
        ))
    })?;
    let mut changes_by_day: Vec<DayChanges> = Vec::new();
    for row in cbd_rows {
        let (date, additions, deletions) = row?;
        changes_by_day.push(DayChanges {
            date,
            additions,
            deletions,
        });
    }

    let net_change = total_added - total_removed;

    Ok(CodeImpactData {
        files_modified,
        lines_added: total_added.max(0) as u64,
        lines_removed: total_removed.max(0) as u64,
        net_change,
        file_type_breakdown,
        most_modified_files,
        changes_by_day,
    })
}
