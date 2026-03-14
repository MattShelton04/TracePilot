//! Parser for `workspace.yaml` — the metadata file present in every session.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::path::Path;

/// Parsed representation of `workspace.yaml`.
#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceMetadata {
    pub id: String,
    pub cwd: Option<String>,
    pub git_root: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub summary: Option<String>,
    pub summary_count: Option<u32>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Parse a `workspace.yaml` file from a session directory.
pub fn parse_workspace_yaml(path: &Path) -> Result<WorkspaceMetadata> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    let metadata: WorkspaceMetadata = serde_yaml::from_str(&content)
        .with_context(|| format!("Failed to parse {}", path.display()))?;
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal_workspace() {
        let yaml = r#"
id: c86fe369-c858-4d91-81da-203c5e276e33
cwd: /home/user/project
summary: "Implemented login feature"
"#;
        let meta: WorkspaceMetadata = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(meta.id, "c86fe369-c858-4d91-81da-203c5e276e33");
        assert_eq!(meta.summary.as_deref(), Some("Implemented login feature"));
    }
}
