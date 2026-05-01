use crate::builder::SessionFixtureBuilder;
use crate::workspace::make_workspace_yaml;
use std::path::PathBuf;
use tempfile::TempDir;

/// Pre-defined session profiles that model real-world usage patterns.
#[derive(Clone, Copy)]
pub enum SessionProfile {
    /// Quick question — few turns, minimal tools (50 events)
    Quick,
    /// Standard coding session — moderate turns and tools (500 events)
    Standard,
    /// Heavy agent session — many turns, lots of tool calls (2000 events)
    AgentHeavy,
    /// Large refactor — many turns with extensive tool usage (5000 events)
    LargeRefactor,
}

impl SessionProfile {
    fn to_builder(self) -> SessionFixtureBuilder {
        match self {
            SessionProfile::Quick => SessionFixtureBuilder::new()
                .turn_count(5)
                .tool_call_count(8),
            SessionProfile::Standard => SessionFixtureBuilder::new()
                .turn_count(30)
                .tool_call_count(80),
            SessionProfile::AgentHeavy => SessionFixtureBuilder::new()
                .turn_count(50)
                .tool_call_count(250),
            SessionProfile::LargeRefactor => SessionFixtureBuilder::new()
                .turn_count(200)
                .tool_call_count(600),
        }
    }
}

/// Create a varied multi-session fixture that mixes different session profiles.
///
/// Distribution: 40% Quick, 30% Standard, 20% AgentHeavy, 10% LargeRefactor.
/// This better approximates a real user's session directory.
pub fn create_varied_session_fixture(session_count: usize) -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("failed to create temp dir");
    let sessions_dir = dir.path().to_path_buf();

    // Precompute exact quotas per profile (remainders go to Quick)
    let weights = [40usize, 30, 20, 10];
    let mut quotas: Vec<usize> = weights.iter().map(|w| w * session_count / 100).collect();
    let assigned: usize = quotas.iter().sum();
    quotas[0] += session_count - assigned; // remainder to Quick

    let profiles = [
        SessionProfile::Quick,
        SessionProfile::Standard,
        SessionProfile::AgentHeavy,
        SessionProfile::LargeRefactor,
    ];

    let mut idx = 0;
    for (pi, &quota) in quotas.iter().enumerate() {
        let profile = profiles[pi];
        for _ in 0..quota {
            let session_id = format!("session-varied-{idx:04}");
            let session_dir = sessions_dir.join(&session_id);
            std::fs::create_dir_all(&session_dir).unwrap();

            let builder = profile.to_builder();
            std::fs::write(
                session_dir.join("workspace.yaml"),
                make_workspace_yaml(&session_id, idx),
            )
            .unwrap();
            std::fs::write(
                session_dir.join("events.jsonl"),
                builder.build_jsonl_string(),
            )
            .unwrap();

            idx += 1;
        }
    }

    (dir, sessions_dir)
}
