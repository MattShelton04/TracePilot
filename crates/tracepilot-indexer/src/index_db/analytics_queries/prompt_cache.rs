//! Cross-session prompt-cache figures from `session_cache_windows` and
//! `session_cache_ttls`.

use std::collections::{BTreeMap, HashMap};

use crate::Result;
use rusqlite::{Connection, params_from_iter};

use tracepilot_core::analytics::types::{
    ModelCacheTtl, ModelTokens, PrefixChangeCount, PromptCacheAnalytics,
};
use tracepilot_core::prompt_cache::AGENT_RESUME_SOURCE;

use super::super::helpers::to_refs;

/// Aggregate the predicted windows of sessions matching `where_clause`
/// (a `build_date_repo_filter` clause over the `sessions s` alias).
pub(super) fn query_prompt_cache(
    conn: &Connection,
    where_clause: &str,
    bind_values: &[String],
) -> Result<PromptCacheAnalytics> {
    let sql = format!(
        "SELECT w.session_id, w.outcome, w.idle_seconds, w.prefix_tokens, w.change_kinds,
                w.resume_source, w.model
         FROM session_cache_windows w
         JOIN sessions s ON s.id = w.session_id{where_clause}
           AND w.resume_at IS NOT NULL"
    );
    let refs = to_refs(bind_values);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, Option<i64>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    })?;

    let mut analytics = PromptCacheAnalytics::default();
    let mut sessions = std::collections::HashSet::new();
    let mut idle = Vec::new();
    let mut kinds: BTreeMap<String, u64> = BTreeMap::new();
    let mut resent_by_model: BTreeMap<String, u64> = BTreeMap::new();
    for row in rows {
        let (session_id, outcome, idle_seconds, prefix_tokens, change_kinds, source, model) = row?;
        let cold = matches!(outcome.as_str(), "expired" | "modelChanged");
        if cold {
            let tokens = prefix_tokens.unwrap_or(0).max(0) as u64;
            analytics.resent_prefix_tokens += tokens;
            if let Some(model) = model.filter(|_| tokens > 0) {
                *resent_by_model.entry(model).or_default() += tokens;
            }
        }
        // Agent wakes are not replies; they only add to the re-sent tokens.
        if source.as_deref() == Some(AGENT_RESUME_SOURCE) {
            continue;
        }
        sessions.insert(session_id);
        analytics.resumed_windows += 1;
        if outcome == "warm" {
            analytics.warm_resumes += 1;
        } else if cold {
            analytics.resumes_after_expiry += 1;
        }
        idle.extend(idle_seconds.map(|s| s.max(0) as u64));
        for kind in change_kinds.iter().flat_map(|k| k.split(',')) {
            if !kind.is_empty() {
                *kinds.entry(kind.to_string()).or_default() += 1;
            }
        }
    }
    analytics.sessions_with_predicted = sessions.len() as u32;
    idle.sort_unstable();
    analytics.median_idle_seconds = idle.get(idle.len() / 2).copied();
    let mut top: Vec<PrefixChangeCount> = kinds
        .into_iter()
        .map(|(kind, count)| PrefixChangeCount { kind, count })
        .collect();
    // Stable sort keeps the alphabetical order for ties.
    top.sort_by(|a, b| b.count.cmp(&a.count));
    analytics.top_change_kinds = top;
    let mut by_model: Vec<ModelTokens> = resent_by_model
        .into_iter()
        .map(|(model, tokens)| ModelTokens { model, tokens })
        .collect();
    by_model.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    analytics.resent_prefix_tokens_by_model = by_model;

    analytics.observed_ttls = query_observed_ttls(conn, Some((where_clause, bind_values)))?;
    Ok(analytics)
}

/// The most common TTL per model. Ties pick the shorter TTL so an estimate
/// never claims a warmer cache than the evidence supports.
pub(super) fn query_observed_ttls(
    conn: &Connection,
    filter: Option<(&str, &[String])>,
) -> Result<Vec<ModelCacheTtl>> {
    let (join, where_clause, values): (&str, &str, &[String]) = match filter {
        Some((clause, values)) => (" JOIN sessions s ON s.id = t.session_id", clause, values),
        None => ("", "", &[]),
    };
    let sql = format!(
        "SELECT t.model, t.ttl_seconds, SUM(t.observation_count)
         FROM session_cache_ttls t{join}{where_clause}
         GROUP BY t.model, t.ttl_seconds"
    );
    let refs = to_refs(values);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;

    let mut best: HashMap<String, (u64, u64)> = HashMap::new();
    for row in rows {
        let (model, ttl, count) = row?;
        let candidate = (ttl.max(0) as u64, count.max(0) as u64);
        best.entry(model)
            .and_modify(|current| {
                let (ttl, count) = candidate;
                if count > current.1 || (count == current.1 && ttl < current.0) {
                    *current = candidate;
                }
            })
            .or_insert(candidate);
    }
    let mut ttls: Vec<ModelCacheTtl> = best
        .into_iter()
        .map(|(model, (ttl_seconds, observations))| ModelCacheTtl {
            model,
            ttl_seconds,
            observations,
        })
        .collect();
    ttls.sort_by(|a, b| a.model.cmp(&b.model));
    Ok(ttls)
}
