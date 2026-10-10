//! Aggregate analytics query facade preserving `IndexDb` public methods.

use std::collections::HashSet;

use crate::Result;
use tracepilot_core::analytics::types::*;
use tracepilot_core::analytics::{
    AgentUsageDetail, AgentUsageSummary, SkillUsageDetail, SkillUsageSummary,
};
use tracepilot_core::provider::{SessionLocator, SessionSource};

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
        self.query_agent_usage_summary_settled(from_date, to_date, repo, source, &HashSet::new())
    }

    /// [`Self::query_agent_usage_summary`], where an unfinished run of an
    /// `unreported` session counts as unreported rather than incomplete: the
    /// session has ended, so the run will never report.
    pub fn query_agent_usage_summary_settled(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        source: Option<SessionSource>,
        unreported: &HashSet<String>,
    ) -> Result<AgentUsageSummary> {
        agents::query_agent_usage_summary(
            &self.conn,
            agents::AgentRunFilter {
                from_date,
                to_date,
                repo,
                source,
                unreported,
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
        self.query_agent_usage_detail_settled(
            agent_name,
            from_date,
            to_date,
            repo,
            source,
            &HashSet::new(),
        )
    }

    /// [`Self::query_agent_usage_detail`] with the unfinished runs of
    /// `unreported` sessions counted as unreported.
    pub fn query_agent_usage_detail_settled(
        &self,
        agent_name: &str,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        source: Option<SessionSource>,
        unreported: &HashSet<String>,
    ) -> Result<AgentUsageDetail> {
        agents::query_agent_usage_detail(
            &self.conn,
            agents::AgentRunFilter {
                from_date,
                to_date,
                repo,
                source,
                unreported,
            },
            agent_name,
        )
    }

    /// Where each session with an unfinished agent run lives, so a caller can
    /// ask its source whether the session is still running.
    pub fn sessions_with_unfinished_agent_runs(&self) -> Result<Vec<SessionLocator>> {
        agents::sessions_with_unfinished_runs(&self.conn)
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
