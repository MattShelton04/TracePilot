//! U3: the analytics source filter. Filtering a mixed index by a source must
//! give exactly what an index of that source alone gives unfiltered, so
//! Copilot numbers are unchanged by Claude Code sessions sitting next to them.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

use serde_json::{Value, json};
use tracepilot_core::provider::{
    CopilotProvider, ProviderRegistry, SessionSource, claude_code::ClaudeCodeProvider,
};
use tracepilot_test_support::claude::SessionFiles;
use tracepilot_test_support::claude_scenarios as fixtures;
use tracepilot_test_support::copilot_corpus::write_copilot_corpus;

use super::claude_analytics::release_session;
use crate::IndexScope;
use crate::index_db::IndexDb;
use crate::indexing::reindex_all_scoped;

/// Every analytics DTO the filter reaches, as JSON for whole-value comparison.
fn dtos(db: &IndexDb, source: Option<SessionSource>) -> Value {
    json!({
        "analytics": db.query_analytics(None, None, None, false, source).unwrap(),
        "toolAnalysis": db.query_tool_analysis(None, None, None, false, source).unwrap(),
        "codeImpact": db.query_code_impact(None, None, None, false, source).unwrap(),
        "agentUsage": db.query_agent_usage_summary(None, None, None, source).unwrap(),
        "skillUsage": db.query_skill_usage_summary(None, None, None, source).unwrap(),
    })
}

/// Index the given sources into a fresh database under `dir`.
fn index(dir: &Path, name: &str, copilot: Option<&Path>, claude: Option<&Path>) -> IndexDb {
    let mut registry = ProviderRegistry::new();
    if let Some(root) = copilot {
        registry.register(Arc::new(CopilotProvider::new(root)));
    }
    if let Some(root) = claude {
        registry.register(Arc::new(ClaudeCodeProvider::new(root)));
    }
    let path = dir.join(format!("{name}.db"));
    reindex_all_scoped(&IndexScope::standalone(registry), &path, |_| {}).unwrap();
    IndexDb::open_or_create(&path).unwrap()
}

/// The filtered mixed index next to each single-source index.
struct Indexes {
    mixed: IndexDb,
    copilot_only: IndexDb,
    claude_only: IndexDb,
}

fn indexes(claude: &SessionFiles) -> (tempfile::TempDir, Indexes) {
    let temp = tempfile::tempdir().unwrap();
    let copilot_root = temp.path().join("session-state");
    write_copilot_corpus(&copilot_root);
    let claude_root = claude.root.path();
    let dbs = Indexes {
        mixed: index(temp.path(), "mixed", Some(&copilot_root), Some(claude_root)),
        copilot_only: index(temp.path(), "copilot", Some(&copilot_root), None),
        claude_only: index(temp.path(), "claude", None, Some(claude_root)),
    };
    (temp, dbs)
}

#[test]
fn each_source_filter_matches_an_index_of_that_source_alone() {
    let scenarios = [
        ("release", release_session()),
        ("subagents", fixtures::subagents()),
        ("skills", fixtures::meta_records(false)),
    ];
    // Proves each analytics area actually had Claude rows to filter.
    let mut claude_seen = BTreeSet::new();
    for (name, claude) in &scenarios {
        let (_temp, dbs) = indexes(claude);
        let copilot = dtos(&dbs.copilot_only, None);
        assert_eq!(
            dtos(&dbs.copilot_only, Some(SessionSource::Copilot)),
            copilot,
            "{name}: the Copilot filter changed a Copilot-only index"
        );
        assert_eq!(
            dtos(&dbs.mixed, Some(SessionSource::Copilot)),
            copilot,
            "{name}: Claude Code rows leaked into the Copilot filter"
        );
        let claude_dtos = dtos(&dbs.claude_only, None);
        assert_eq!(
            dtos(&dbs.mixed, Some(SessionSource::ClaudeCode)),
            claude_dtos,
            "{name}: Copilot rows leaked into the Claude Code filter"
        );

        let sessions = |v: &Value| v["analytics"]["totalSessions"].as_u64().unwrap();
        assert_eq!(
            sessions(&dtos(&dbs.mixed, None)),
            sessions(&copilot) + sessions(&claude_dtos),
            "{name}: All should cover both sources"
        );

        let a = &claude_dtos["analytics"];
        let areas = [
            ("modelMetrics", &a["modelDistribution"]),
            ("tools", &claude_dtos["toolAnalysis"]["tools"]),
            ("incidents", &a["totalRateLimits"]),
            ("cacheTiming", &a["promptCache"]["resumedWindows"]),
            ("agentRuns", &claude_dtos["agentUsage"]["totalRuns"]),
            ("skills", &claude_dtos["skillUsage"]["skills"]),
        ];
        for (area, value) in areas {
            let present = value.as_array().is_some_and(|rows| !rows.is_empty())
                || value.as_u64().is_some_and(|count| count > 0);
            if present {
                claude_seen.insert(area);
            }
        }
    }
    assert_eq!(claude_seen.len(), 6, "areas exercised: {claude_seen:?}");
}
