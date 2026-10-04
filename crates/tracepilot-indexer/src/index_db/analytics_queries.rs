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
mod effort_usage;
mod model_usage_by_day;
mod prompt_cache;
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
        let mut data =
            dashboard::query_analytics(&self.conn, from_date, to_date, repo, hide_empty)?;
        let (where_clause, bind_values) =
            super::helpers::build_date_repo_filter(from_date, to_date, repo, hide_empty);
        data.reasoning_effort =
            effort_usage::query_effort_usage(&self.conn, &where_clause, &bind_values)?;
        Ok(data)
    }

    /// The most common prompt-cache TTL observed per model across all indexed
    /// sessions. Used to estimate cache windows for older sessions.
    pub fn query_observed_cache_ttls(&self) -> Result<Vec<ModelCacheTtl>> {
        prompt_cache::query_observed_ttls(&self.conn, None)
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
