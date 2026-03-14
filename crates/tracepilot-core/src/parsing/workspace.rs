//! Parser for `workspace.yaml` — the metadata file present in every session.

use crate::error::{Result, TracePilotError};
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
    pub host_type: Option<String>,
    pub summary: Option<String>,
    pub summary_count: Option<u32>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Parse a `workspace.yaml` file from a session directory.
pub fn parse_workspace_yaml(path: &Path) -> Result<WorkspaceMetadata> {
    let content = std::fs::read_to_string(path).map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to read {}", path.display()),
        source: Some(Box::new(e)),
    })?;
    let metadata: WorkspaceMetadata =
        serde_yaml::from_str(&content).map_err(|e| TracePilotError::ParseError {
            context: format!("Failed to parse {}", path.display()),
            source: Some(Box::new(e)),
        })?;
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
