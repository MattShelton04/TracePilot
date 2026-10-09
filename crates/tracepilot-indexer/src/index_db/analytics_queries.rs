//! Aggregate analytics query facade preserving `IndexDb` public methods.

use crate::Result;
use tracepilot_core::analytics::types::*;
use tracepilot_core::analytics::{
    AgentUsageDetail, AgentUsageSummary, SkillUsageDetail, SkillUsageSummary,
};
use tracepilot_core::provider::SessionSource;

use super::IndexDb;

mod agents;
mod code_impact;
mod dashboard;
mod day_bucket;
mod model_usage_by_day;
mod prompt_cache;
mod skills;
mod source_cost;
mod tool_analysis;

impl IndexDb {
    /// Query aggregate analytics from pre-computed per-session data.
    ///
    /// Every query here takes a `source`; `None` covers all sources.
    pub fn query_analytics(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
        source: Option<SessionSource>,
    ) -> Result<AnalyticsData> {
        dashboard::query_analytics(&self.conn, from_date, to_date, repo, hide_empty, source)
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
        source: Option<SessionSource>,
    ) -> Result<AgentUsageSummary> {
        agents::query_agent_usage_summary(
            &self.conn,
            agents::AgentRunFilter {
                from_date,
                to_date,
                repo,
                source,
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
        source: Option<SessionSource>,
    ) -> Result<AgentUsageDetail> {
        agents::query_agent_usage_detail(
            &self.conn,
            agents::AgentRunFilter {
                from_date,
                to_date,
                repo,
                source,
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
        source: Option<SessionSource>,
    ) -> Result<SkillUsageSummary> {
        skills::query_skill_usage_summary(
            &self.conn,
            skills::SkillUsageFilter {
                from_date,
                to_date,
                repo,
                source,
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
        source: Option<SessionSource>,
    ) -> Result<SkillUsageDetail> {
        skills::query_skill_usage_detail(
            &self.conn,
            skills::SkillUsageFilter {
                from_date,
                to_date,
                repo,
                source,
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
        source: Option<SessionSource>,
    ) -> Result<ToolAnalysisData> {
        tool_analysis::query_tool_analysis(&self.conn, from_date, to_date, repo, hide_empty, source)
    }

    /// Query code impact from per-session columns.
    pub fn query_code_impact(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
        source: Option<SessionSource>,
    ) -> Result<CodeImpactData> {
        code_impact::query_code_impact(&self.conn, from_date, to_date, repo, hide_empty, source)
    }
}
