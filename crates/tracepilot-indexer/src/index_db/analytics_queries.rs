//! Aggregate analytics query facade preserving `IndexDb` public methods.

use crate::Result;
use tracepilot_core::analytics::types::*;

use super::IndexDb;

mod code_impact;
mod dashboard;
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
