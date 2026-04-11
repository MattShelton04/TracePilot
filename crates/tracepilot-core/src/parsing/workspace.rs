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
        serde_yml::from_str(&content).map_err(|e| TracePilotError::ParseError {
            context: format!("Failed to parse {}", path.display()),
            source: Some(Box::new(e)),
        })?;
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    #[test]
    fn test_parse_minimal_workspace() {
        let yaml = r#"
id: c86fe369-c858-4d91-81da-203c5e276e33
cwd: /home/user/project
summary: "Implemented login feature"
"#;
        let meta: WorkspaceMetadata = serde_yml::from_str(yaml).unwrap();
        assert_eq!(meta.id, "c86fe369-c858-4d91-81da-203c5e276e33");
        assert_eq!(meta.summary.as_deref(), Some("Implemented login feature"));
    }

    #[test]
    fn test_parse_workspace_with_host_type() {
        let yaml = r#"
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
cwd: /home/user/project
git_root: /home/user/project
repository: github.com/user/project
branch: feature-branch
host_type: cli
summary: "Full workspace"
summary_count: 5
created_at: "2026-03-10T07:14:50.780Z"
updated_at: "2026-03-10T07:15:00.000Z"
"#;
        let meta: WorkspaceMetadata = serde_yml::from_str(yaml).unwrap();
        assert_eq!(meta.id, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
        assert_eq!(meta.cwd.as_deref(), Some("/home/user/project"));
        assert_eq!(meta.git_root.as_deref(), Some("/home/user/project"));
        assert_eq!(meta.repository.as_deref(), Some("github.com/user/project"));
        assert_eq!(meta.branch.as_deref(), Some("feature-branch"));
        assert_eq!(meta.host_type.as_deref(), Some("cli"));
        assert_eq!(meta.summary.as_deref(), Some("Full workspace"));
        assert_eq!(meta.summary_count, Some(5));
        assert!(meta.created_at.is_some());
        assert!(meta.updated_at.is_some());
    }

    #[test]
    fn test_parse_workspace_missing_optional_fields() {
        let yaml = "id: minimal-id-only\n";
        let meta: WorkspaceMetadata = serde_yml::from_str(yaml).unwrap();
        assert_eq!(meta.id, "minimal-id-only");
        assert!(meta.cwd.is_none());
        assert!(meta.git_root.is_none());
        assert!(meta.repository.is_none());
        assert!(meta.branch.is_none());
        assert!(meta.host_type.is_none());
        assert!(meta.summary.is_none());
        assert!(meta.summary_count.is_none());
        assert!(meta.created_at.is_none());
        assert!(meta.updated_at.is_none());
    }

    #[test]
    fn test_parse_workspace_with_dates() {
        let yaml = r#"
id: date-test
created_at: "2026-01-15T12:00:00Z"
updated_at: "2026-06-20T18:30:45.123Z"
"#;
        let meta: WorkspaceMetadata = serde_yml::from_str(yaml).unwrap();
        assert_eq!(meta.id, "date-test");
        let created = meta.created_at.unwrap();
        assert_eq!(created.year(), 2026);
        assert_eq!(created.month(), 1);
        assert_eq!(created.day(), 15);
        let updated = meta.updated_at.unwrap();
        assert_eq!(updated.year(), 2026);
        assert_eq!(updated.month(), 6);
    }

    #[test]
    fn test_parse_workspace_yaml_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.yaml");
        let err = parse_workspace_yaml(&path).unwrap_err();
        match &err {
            TracePilotError::ParseError { context, source } => {
                assert!(
                    context.starts_with("Failed to read"),
                    "expected 'Failed to read' prefix, got: {context}"
                );
                assert!(
                    context.contains("does-not-exist.yaml"),
                    "error context should include the filename, got: {context}"
                );
                let source = source.as_ref().expect("should have a source error");
                assert!(
                    source.to_string().contains("No such file")
                        || source.to_string().contains("cannot find"),
                    "source error should be IO not-found, got: {source}"
                );
            }
            _ => panic!("Expected ParseError, got {:?}", err),
        }
    }

    #[test]
    fn test_parse_workspace_yaml_bad_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad-content.yaml");
        std::fs::write(&path, "id: [invalid yaml").unwrap();
        let err = parse_workspace_yaml(&path).unwrap_err();
        match &err {
            TracePilotError::ParseError { context, source } => {
                assert!(
                    context.starts_with("Failed to parse"),
                    "expected 'Failed to parse' prefix, got: {context}"
                );
                assert!(
                    context.contains("bad-content.yaml"),
                    "error context should include the filename, got: {context}"
                );
                assert!(
                    source.is_some(),
                    "should have a YAML parse source error"
                );
            }
            _ => panic!("Expected ParseError, got {:?}", err),
        }
    }
}
