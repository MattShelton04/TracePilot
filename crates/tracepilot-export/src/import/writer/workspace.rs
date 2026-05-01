use std::fs;
use std::path::Path;

use crate::document::{PortableSession, SessionArchive};
use crate::error::{ExportError, Result};

pub(super) fn write_workspace_yaml(
    session: &PortableSession,
    archive: &SessionArchive,
    dir: &Path,
    target_session_id: &str,
) -> Result<()> {
    let meta = &session.metadata;
    let path = dir.join("workspace.yaml");

    // Build YAML manually to match the exact format the parser expects.
    // We use serde_yml for robustness rather than hand-formatting.
    let mut map = serde_yml::Mapping::new();

    map.insert(
        serde_yml::Value::String("id".to_string()),
        serde_yml::Value::String(target_session_id.to_string()),
    );

    if let Some(cwd) = &meta.cwd {
        map.insert(
            serde_yml::Value::String("cwd".to_string()),
            serde_yml::Value::String(cwd.clone()),
        );
    }
    if let Some(git_root) = &meta.git_root {
        map.insert(
            serde_yml::Value::String("git_root".to_string()),
            serde_yml::Value::String(git_root.clone()),
        );
    }
    if let Some(repo) = &meta.repository {
        map.insert(
            serde_yml::Value::String("repository".to_string()),
            serde_yml::Value::String(repo.clone()),
        );
    }
    if let Some(branch) = &meta.branch {
        map.insert(
            serde_yml::Value::String("branch".to_string()),
            serde_yml::Value::String(branch.clone()),
        );
    }
    if let Some(host_type) = &meta.host_type {
        map.insert(
            serde_yml::Value::String("host_type".to_string()),
            serde_yml::Value::String(host_type.clone()),
        );
    }
    if let Some(summary) = &meta.summary {
        map.insert(
            serde_yml::Value::String("summary".to_string()),
            serde_yml::Value::String(summary.clone()),
        );
    }
    if let Some(count) = meta.summary_count {
        map.insert(
            serde_yml::Value::String("summary_count".to_string()),
            serde_yml::Value::Number(serde_yml::Number::from(count as u64)),
        );
    }
    if let Some(created) = &meta.created_at {
        map.insert(
            serde_yml::Value::String("created_at".to_string()),
            serde_yml::Value::String(created.to_rfc3339()),
        );
    }
    if let Some(updated) = &meta.updated_at {
        map.insert(
            serde_yml::Value::String("updated_at".to_string()),
            serde_yml::Value::String(updated.to_rfc3339()),
        );
    }

    // Add import provenance
    let mut imported_from = serde_yml::Mapping::new();
    imported_from.insert(
        serde_yml::Value::String("source_system".to_string()),
        serde_yml::Value::String(archive.header.exported_by.clone()),
    );
    imported_from.insert(
        serde_yml::Value::String("imported_at".to_string()),
        serde_yml::Value::String(chrono::Utc::now().to_rfc3339()),
    );
    imported_from.insert(
        serde_yml::Value::String("original_schema_version".to_string()),
        serde_yml::Value::String(archive.header.schema_version.to_string()),
    );
    map.insert(
        serde_yml::Value::String("imported_from".to_string()),
        serde_yml::Value::Mapping(imported_from),
    );

    let yaml_str =
        serde_yml::to_string(&serde_yml::Value::Mapping(map)).map_err(|e| ExportError::Render {
            format: "YAML".to_string(),
            message: e.to_string(),
        })?;

    fs::write(&path, yaml_str).map_err(|e| ExportError::io(&path, e))
}
