//! Aggregate analytics query facade preserving `IndexDb` public methods.

use crate::Result;
use tracepilot_core::analytics::types::*;
use tracepilot_core::analytics::{
    AgentUsageDetail, AgentUsageSummary, SkillUsageDetail, SkillUsageSummary,
};

use super::IndexDb;

mod agents;
mod code_impact;
mod dashboard;
mod day_bucket;
mod prompt_cache;
pub mod request_performance;
mod skills;
mod tool_analysis;

impl IndexDb {
    /// Query aggregate analytics from pre-computed per-session data.
    pub fn query_analytics(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
    ) -> Result<AnalyticsData> {
        dashboard::query_analytics(&self.conn, from_date, to_date, repo, hide_empty)
    }

    /// The most common prompt-cache TTL observed per model across all indexed
    /// sessions. Used to estimate cache windows for older sessions.
    pub fn query_observed_cache_ttls(&self) -> Result<Vec<ModelCacheTtl>> {
        prompt_cache::query_observed_ttls(&self.conn, None)
    }

    /// Observed request performance across sessions, overall and per model.
    ///
    /// Requests are selected by their own recorded time, not by their
    /// session's creation date, so a long-running session's history is not
    /// piled onto the day it began.
    pub fn query_request_performance(
        &self,
        filter: &request_performance::RequestPerformanceFilter,
    ) -> Result<request_performance::RequestPerformanceReport> {
        if !self.has_session_store_enrichment() {
            return Ok(request_performance::RequestPerformanceReport::unavailable());
        }
        let _snapshot = self.conn.unchecked_transaction()?;
        let generation = self.request_generation()?;
        let mut report = request_performance::query_request_performance(
            &self.conn,
            generation.as_deref(),
            filter,
        )?;
        if let Some(source) = self.session_store_status()? {
            report.stale = source.availability != "ready"
                || self.conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM session_store_coverage WHERE freshness = 'stale')",
                    [],
                    |row| row.get::<_, bool>(0),
                )?;
            report.last_success_at = source.last_success_at;
        }
        Ok(report)
    }

    /// Per-agent request figures for one session, own totals only.
    pub fn query_agent_request_rollups(
        &self,
        session_id: &str,
    ) -> Result<Vec<request_performance::AgentRequestRollup>> {
        if !self.has_session_store_enrichment() {
            return Ok(Vec::new());
        }
        let generation = self.request_generation()?;
        request_performance::query_agent_request_rollups(
            &self.conn,
            generation.as_deref(),
            session_id,
        )
    }

    /// Cross-session usage for every agent seen in the index.
    pub fn query_agent_usage_summary(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
    ) -> Result<AgentUsageSummary> {
        agents::query_agent_usage_summary(
            &self.conn,
            agents::AgentRunFilter {
                from_date,
                to_date,
                repo,
            },
        )
    }

    /// Usage breakdowns for one agent name (case-insensitive).
    pub fn query_agent_usage_detail(
        &self,
        agent_name: &str,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
    ) -> Result<AgentUsageDetail> {
        agents::query_agent_usage_detail(
            &self.conn,
            agents::AgentRunFilter {
                from_date,
                to_date,
                repo,
            },
            agent_name,
        )
    }

    /// Cross-session usage for every skill seen in the index, installed or
    /// not.
    pub fn query_skill_usage_summary(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
    ) -> Result<SkillUsageSummary> {
        skills::query_skill_usage_summary(
            &self.conn,
            skills::SkillUsageFilter {
                from_date,
                to_date,
                repo,
            },
        )
    }

    /// Usage breakdowns and recent invocations for one skill name
    /// (case-insensitive).
    pub fn query_skill_usage_detail(
        &self,
        skill_name: &str,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
    ) -> Result<SkillUsageDetail> {
        skills::query_skill_usage_detail(
            &self.conn,
            skills::SkillUsageFilter {
                from_date,
                to_date,
                repo,
            },
            skill_name,
        )
    }

    /// Query tool analysis from session_tool_calls table.
    pub fn query_tool_analysis(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
    ) -> Result<ToolAnalysisData> {
        tool_analysis::query_tool_analysis(&self.conn, from_date, to_date, repo, hide_empty)
    }

    /// Query code impact from per-session columns.
    pub fn query_code_impact(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
    ) -> Result<CodeImpactData> {
        code_impact::query_code_impact(&self.conn, from_date, to_date, repo, hide_empty)
    }
}
