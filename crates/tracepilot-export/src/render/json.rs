//! JSON renderer for the TracePilot Interchange Format (`.tpx.json`).
//!
//! This is the **lossless** format — the full [`SessionArchive`] is serialized
//! as pretty-printed JSON with a SHA-256 content hash for integrity verification.
//! Files produced here can be imported back with no data loss.

use sha2::{Digest, Sha256};

use crate::document::SessionArchive;
use crate::error::{ExportError, Result};
use crate::options::ExportFormat;
use crate::render::{ExportFile, ExportRenderer};

/// Renderer that produces `.tpx.json` files.
pub struct JsonRenderer;

impl JsonRenderer {
    /// Generate a filename for a session archive.
    fn make_filename(archive: &SessionArchive) -> String {
        if archive.sessions.len() == 1 {
            let id = &archive.sessions[0].metadata.id;
            // Use first 8 chars of the session ID for brevity
            let short_id = &id[..id.floor_char_boundary(8.min(id.len()))];
            format!("session-{}.tpx.json", short_id)
        } else {
            let ts = archive.header.exported_at.format("%Y%m%d-%H%M%S");
            format!("sessions-{}-{}.tpx.json", archive.sessions.len(), ts)
        }
    }

    /// Compute SHA-256 hash of the sessions portion for integrity checking.
    fn compute_content_hash(sessions_json: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(sessions_json);
        format!("{:x}", hasher.finalize())
    }
}

impl ExportRenderer for JsonRenderer {
    fn format(&self) -> ExportFormat {
        ExportFormat::Json
    }

    fn render(&self, archive: &SessionArchive) -> Result<Vec<ExportFile>> {
        // 1. Serialize sessions to compute content hash
        let sessions_json = serde_json::to_vec_pretty(&archive.sessions).map_err(|e| {
            ExportError::Render {
                format: "JSON".to_string(),
                message: format!("failed to serialize sessions: {e}"),
            }
        })?;

        // 2. Clone archive and set the content hash
        let mut output = archive.clone();
        output.header.content_hash = Some(Self::compute_content_hash(&sessions_json));

        // 3. Serialize the complete archive
        let content = serde_json::to_vec_pretty(&output).map_err(|e| ExportError::Render {
            format: "JSON".to_string(),
            message: format!("failed to serialize archive: {e}"),
        })?;

        let filename = Self::make_filename(archive);

        Ok(vec![ExportFile {
            filename,
            content,
            mime_type: self.mime_type().to_string(),
        }])
    }

    fn display_name(&self) -> &'static str {
        "TracePilot JSON (.tpx.json)"
    }

    fn extension(&self) -> &'static str {
        "tpx.json"
    }

    fn mime_type(&self) -> &'static str {
        "application/json"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::*;
    use crate::schema;
    use chrono::Utc;

    fn minimal_archive() -> SessionArchive {
        SessionArchive {
            header: ArchiveHeader {
                schema_version: schema::CURRENT_VERSION,
                exported_at: Utc::now(),
                exported_by: "TracePilot test".to_string(),
                source_system: None,
                content_hash: None,
                minimum_reader_version: Some(schema::MINIMUM_READER_VERSION),
            },
            sessions: vec![PortableSession {
                metadata: PortableSessionMetadata {
                    id: "abc12345-6789-0000-0000-000000000000".to_string(),
                    summary: Some("Test session".to_string()),
                    repository: None,
                    branch: None,
                    cwd: None,
                    git_root: None,
                    host_type: None,
                    created_at: None,
                    updated_at: None,
                    event_count: Some(10),
                    turn_count: Some(3),
                    summary_count: None,
                    lineage: None,
                },
                available_sections: vec![],
                conversation: None,
                events: None,
                todos: None,
                plan: None,
                checkpoints: None,
                rewind_snapshots: None,
                shutdown_metrics: None,
                incidents: None,
                health: None,
                custom_tables: None,
                parse_diagnostics: None,
                extensions: None,
            }],
            export_options: ArchiveOptionsRecord {
                format: "json".to_string(),
                included_sections: vec![],
                redaction_applied: false,
            },
        }
    }

    #[test]
    fn renders_valid_json() {
        let archive = minimal_archive();
        let renderer = JsonRenderer;
        let files = renderer.render(&archive).unwrap();

        assert_eq!(files.len(), 1);
        assert!(files[0].filename.ends_with(".tpx.json"));
        assert_eq!(files[0].mime_type, "application/json");

        // Should be valid JSON
        let parsed: serde_json::Value =
            serde_json::from_slice(&files[0].content).expect("valid JSON");
        assert!(parsed.is_object());
    }

    #[test]
    fn includes_content_hash() {
        let archive = minimal_archive();
        let renderer = JsonRenderer;
        let files = renderer.render(&archive).unwrap();

        let parsed: serde_json::Value = serde_json::from_slice(&files[0].content).unwrap();
        let hash = parsed["header"]["contentHash"].as_str();
        assert!(hash.is_some(), "content hash should be present");
        assert_eq!(hash.unwrap().len(), 64, "SHA-256 hash should be 64 hex chars");
    }

    #[test]
    fn round_trip_serialization() {
        let archive = minimal_archive();
        let renderer = JsonRenderer;
        let files = renderer.render(&archive).unwrap();

        let deserialized: SessionArchive =
            serde_json::from_slice(&files[0].content).expect("should deserialize");

        assert_eq!(deserialized.sessions.len(), 1);
        assert_eq!(deserialized.sessions[0].metadata.id, archive.sessions[0].metadata.id);
        assert_eq!(
            deserialized.header.schema_version,
            archive.header.schema_version
        );
    }

    #[test]
    fn filename_uses_short_session_id() {
        let archive = minimal_archive();
        let filename = JsonRenderer::make_filename(&archive);
        assert_eq!(filename, "session-abc12345.tpx.json");
    }

    #[test]
    fn batch_filename_includes_count() {
        let mut archive = minimal_archive();
        // Add a second session
        archive.sessions.push(archive.sessions[0].clone());
        archive.sessions[1].metadata.id = "def99999-0000-0000-0000-000000000000".to_string();

        let filename = JsonRenderer::make_filename(&archive);
        assert!(filename.starts_with("sessions-2-"));
        assert!(filename.ends_with(".tpx.json"));
    }

    #[test]
    fn content_hash_is_deterministic() {
        let archive = minimal_archive();
        let sessions_json = serde_json::to_vec_pretty(&archive.sessions).unwrap();
        let hash1 = JsonRenderer::compute_content_hash(&sessions_json);
        let hash2 = JsonRenderer::compute_content_hash(&sessions_json);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn schema_version_in_output() {
        let archive = minimal_archive();
        let renderer = JsonRenderer;
        let files = renderer.render(&archive).unwrap();

        let parsed: serde_json::Value = serde_json::from_slice(&files[0].content).unwrap();
        let version = &parsed["header"]["schemaVersion"];
        assert_eq!(version["major"], 1);
        assert_eq!(version["minor"], 0);
    }
}
