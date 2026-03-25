//! Aggregate analytics queries: dashboard stats, tool analysis, code impact.

use crate::Result;
use rusqlite::params_from_iter;
use std::collections::HashMap;

use tracepilot_core::analytics::types::*;

use super::helpers::*;
use super::IndexDb;

impl IndexDb {
    /// Query aggregate analytics from pre-computed per-session data.
    pub fn query_analytics(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
    ) -> Result<AnalyticsData> {
        let (where_clause, bind_values) =
            build_date_repo_filter(from_date, to_date, repo, hide_empty);

        // Aggregate session-level stats
        let agg_sql = format!(
            "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(total_cost), 0.0),
                    COALESCE(AVG(health_score), 0.0),
                    COALESCE(SUM(turn_count), 0), COALESCE(SUM(tool_call_count), 0),
                    COUNT(CASE WHEN turn_count > 0 THEN 1 END),
                    COALESCE(SUM(total_premium_requests), 0.0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN total_api_duration_ms END), 0),
                    COUNT(CASE WHEN health_score >= 0.8 THEN 1 END),
                    COUNT(CASE WHEN health_score >= 0.5 AND health_score < 0.8 THEN 1 END),
                    COUNT(CASE WHEN health_score < 0.5 THEN 1 END),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN total_tokens END), 0),
                    COUNT(CASE WHEN error_count > 0 THEN 1 END),
                    COALESCE(SUM(rate_limit_count), 0),
                    COALESCE(SUM(compaction_count), 0),
                    COALESCE(SUM(truncation_count), 0)
             FROM sessions s{}",
            where_clause
        );
        let refs = to_refs(&bind_values);
        #[allow(clippy::type_complexity)]
        let (
            total_sessions,
            total_tokens,
            total_cost,
            avg_health,
            total_turns,
            total_tool_calls,
            sessions_with_turns,
            total_premium_requests,
            total_api_duration_ms_sum,
            healthy_count,
            attention_count,
            critical_count,
            total_tokens_with_duration,
            sessions_with_errors,
            total_rate_limits,
            total_compactions,
            total_truncations,
        ): (
            u32, i64, f64, f64, i64, i64, u32, f64, i64, u32, u32, u32, i64, u32, i64, i64, i64,
        ) = self.conn.query_row(
            &agg_sql,
            params_from_iter(refs.iter().copied()),
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                    row.get(13)?,
                    row.get(14)?,
                    row.get(15)?,
                    row.get(16)?,
                ))
            },
        )?;

        // Tokens by day
        let day_sql = format!(
            "SELECT date(COALESCE(s.updated_at, s.created_at)) as d, COALESCE(SUM(s.total_tokens), 0)
             FROM sessions s{} AND d IS NOT NULL GROUP BY d ORDER BY d",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let token_usage_by_day = query_day_tokens(&self.conn, &day_sql, &refs)?;

        // Sessions by day
        let sbd_sql = format!(
            "SELECT date(COALESCE(s.updated_at, s.created_at)) as d, COUNT(*)
             FROM sessions s{} AND d IS NOT NULL GROUP BY d ORDER BY d",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let sessions_per_day = query_day_sessions(&self.conn, &sbd_sql, &refs)?;

        // Cost by day
        let cbd_sql = format!(
            "SELECT date(COALESCE(s.updated_at, s.created_at)) as d, COALESCE(SUM(s.total_cost), 0.0)
             FROM sessions s{} AND d IS NOT NULL GROUP BY d ORDER BY d",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let cost_by_day = query_day_cost(&self.conn, &cbd_sql, &refs)?;

        // Model distribution from session_model_metrics
        let mdist_sql = format!(
            "SELECT m.model_name,
                    SUM(m.input_tokens + m.output_tokens),
                    SUM(m.input_tokens),
                    SUM(m.output_tokens),
                    SUM(m.cache_read_tokens),
                    SUM(m.cost),
                    SUM(m.request_count)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}
             GROUP BY m.model_name ORDER BY 2 DESC",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let model_distribution = query_model_distribution(&self.conn, &mdist_sql, &refs)?;

        // Cache stats from session_model_metrics
        let cache_sql = format!(
            "SELECT COALESCE(SUM(m.cache_read_tokens), 0), COALESCE(SUM(m.input_tokens), 0)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let (total_cache_read_tokens, total_input_tokens): (i64, i64) = self
            .conn
            .query_row(
                &cache_sql,
                params_from_iter(refs.iter().copied()),
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
        let total_cache_read_tokens = total_cache_read_tokens.max(0) as u64;
        let total_input_tokens = total_input_tokens.max(0) as u64;
        let cache_hit_rate = if total_input_tokens > 0 {
            (total_cache_read_tokens as f64 / total_input_tokens as f64) * 100.0
        } else {
            0.0
        };
        let cache_stats = CacheStats {
            total_cache_read_tokens,
            total_input_tokens,
            cache_hit_rate,
            non_cached_input_tokens: total_input_tokens.saturating_sub(total_cache_read_tokens),
        };

        // Duration statistics
        let dur_sql = format!(
            "SELECT s.total_api_duration_ms FROM sessions s{} AND s.total_api_duration_ms IS NOT NULL AND s.total_api_duration_ms > 0",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let durations = query_durations(&self.conn, &dur_sql, &refs)?;
        let api_duration_stats = compute_duration_stats(&durations);

        // Productivity metrics
        let avg_turns_per_session = if sessions_with_turns > 0 {
            total_turns as f64 / sessions_with_turns as f64
        } else {
            0.0
        };
        let avg_tool_calls_per_turn = if total_turns > 0 {
            total_tool_calls as f64 / total_turns as f64
        } else {
            0.0
        };
        let avg_tokens_per_turn = if total_turns > 0 {
            total_tokens as f64 / total_turns as f64
        } else {
            0.0
        };
        let avg_tokens_per_api_second = if total_api_duration_ms_sum > 0 {
            total_tokens_with_duration as f64 / (total_api_duration_ms_sum as f64 / 1000.0)
        } else {
            0.0
        };

        // Incidents by day
        let ibd_sql = format!(
            "SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.error_count), 0),
                    COALESCE(SUM(s.rate_limit_count), 0),
                    COALESCE(SUM(s.compaction_count), 0),
                    COALESCE(SUM(s.truncation_count), 0)
             FROM sessions s{} AND d IS NOT NULL GROUP BY d ORDER BY d",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let mut ibd_stmt = self.conn.prepare(&ibd_sql)?;
        let incidents_by_day: Vec<DayIncidents> = ibd_stmt
            .query_map(params_from_iter(refs.iter().copied()), |row| {
                Ok(DayIncidents {
                    date: row.get(0)?,
                    errors: row.get::<_, i64>(1)?.max(0) as u64,
                    rate_limits: row.get::<_, i64>(2)?.max(0) as u64,
                    compactions: row.get::<_, i64>(3)?.max(0) as u64,
                    truncations: row.get::<_, i64>(4)?.max(0) as u64,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;

        Ok(AnalyticsData {
            total_sessions,
            total_tokens: total_tokens.max(0) as u64,
            total_cost,
            total_premium_requests,
            average_health_score: avg_health,
            token_usage_by_day,
            sessions_per_day,
            model_distribution,
            cost_by_day,
            api_duration_stats,
            productivity_metrics: ProductivityMetrics {
                avg_turns_per_session,
                avg_tool_calls_per_turn,
                avg_tokens_per_turn,
                avg_tokens_per_api_second,
            },
            cache_stats,
            health_distribution: HealthDistribution {
                healthy_count,
                attention_count,
                critical_count,
            },
            sessions_with_errors,
            total_rate_limits: total_rate_limits.max(0) as u64,
            total_compactions: total_compactions.max(0) as u64,
            total_truncations: total_truncations.max(0) as u64,
            incidents_by_day,
        })
    }

    /// Query tool analysis from session_tool_calls table.
    pub fn query_tool_analysis(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
    ) -> Result<ToolAnalysisData> {
        let (where_clause, bind_values) =
            build_date_repo_filter(from_date, to_date, repo, hide_empty);

        // Per-tool aggregation
        let sql = format!(
            "SELECT t.tool_name,
                    SUM(t.call_count), SUM(t.success_count), SUM(t.failure_count),
                    SUM(t.total_duration_ms), SUM(t.calls_with_duration)
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id{}
             GROUP BY t.tool_name ORDER BY SUM(t.call_count) DESC",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;

        let mut tools: Vec<ToolUsageEntry> = Vec::new();
        let mut total_calls: u32 = 0;
        let mut total_success: u32 = 0;
        let mut total_failure: u32 = 0;
        let mut total_duration: f64 = 0.0;
        let mut total_with_duration: u32 = 0;

        for row in rows {
            let (name, calls, success, failure, dur, dur_count) = row?;
            let calls_u32 = u32::try_from(calls.max(0)).unwrap_or(u32::MAX);
            let success_u32 = u32::try_from(success.max(0)).unwrap_or(u32::MAX);
            let failure_u32 = u32::try_from(failure.max(0)).unwrap_or(u32::MAX);
            let dur_count_u32 = u32::try_from(dur_count.max(0)).unwrap_or(u32::MAX);
            total_calls = total_calls.saturating_add(calls_u32);
            total_success = total_success.saturating_add(success_u32);
            total_failure = total_failure.saturating_add(failure_u32);
            total_duration += dur.max(0) as f64;
            total_with_duration = total_with_duration.saturating_add(dur_count_u32);

            let determined = success_u32 + failure_u32;
            let success_rate = if determined > 0 {
                success_u32 as f64 / determined as f64
            } else {
                0.0
            };
            let avg_dur = if dur_count_u32 > 0 {
                dur.max(0) as f64 / dur_count_u32 as f64
            } else {
                0.0
            };

            tools.push(ToolUsageEntry {
                name,
                call_count: calls_u32,
                success_rate,
                avg_duration_ms: avg_dur,
                total_duration_ms: dur.max(0) as f64,
            });
        }

        let most_used_tool = tools
            .first()
            .map(|t| t.name.clone())
            .unwrap_or_else(|| "N/A".to_string());

        let overall_determined = total_success + total_failure;
        let success_rate = if overall_determined > 0 {
            total_success as f64 / overall_determined as f64
        } else {
            0.0
        };
        let avg_duration_ms = if total_with_duration > 0 {
            total_duration / total_with_duration as f64
        } else {
            0.0
        };

        // Activity heatmap — full 7×24 grid
        let hm_sql = format!(
            "SELECT a.day_of_week, a.hour, SUM(a.tool_call_count)
             FROM session_activity a
             JOIN sessions s ON s.id = a.session_id{}
             GROUP BY a.day_of_week, a.hour",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let mut hm_stmt = self.conn.prepare(&hm_sql)?;
        let hm_rows = hm_stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, u32>(1)?,
                row.get::<_, u32>(2)?,
            ))
        })?;
        let mut heatmap_data: HashMap<(u32, u32), u32> = HashMap::new();
        for row in hm_rows {
            let (day, hour, count) = row?;
            heatmap_data.insert((day, hour), count);
        }

        let mut activity_heatmap: Vec<HeatmapEntry> = Vec::with_capacity(168);
        for day in 0..7u32 {
            for hour in 0..24u32 {
                let count = heatmap_data.get(&(day, hour)).copied().unwrap_or(0);
                activity_heatmap.push(HeatmapEntry { day, hour, count });
            }
        }

        Ok(ToolAnalysisData {
            total_calls,
            success_rate,
            avg_duration_ms,
            most_used_tool,
            tools,
            activity_heatmap,
        })
    }

    /// Query code impact from per-session columns.
    pub fn query_code_impact(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
    ) -> Result<CodeImpactData> {
        let (where_clause, bind_values) =
            build_date_repo_filter(from_date, to_date, repo, hide_empty);

        // Aggregate lines
        let agg_sql = format!(
            "SELECT COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s{}",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let (total_added, total_removed): (i64, i64) = self.conn.query_row(
            &agg_sql,
            params_from_iter(refs.iter().copied()),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        // File type breakdown from session_modified_files
        let ext_sql = format!(
            "SELECT COALESCE(f.extension, '(no ext)'), COUNT(*)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{}
             GROUP BY f.extension ORDER BY COUNT(*) DESC",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let mut ext_stmt = self.conn.prepare(&ext_sql)?;
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
        let mut mf_stmt = self.conn.prepare(&mf_sql)?;
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
        let files_modified: u32 = self.conn.query_row(
            &fc_sql,
            params_from_iter(refs.iter().copied()),
            |row| row.get(0),
        )?;

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
        let mut cbd_stmt = self.conn.prepare(&cbd_sql)?;
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
}
