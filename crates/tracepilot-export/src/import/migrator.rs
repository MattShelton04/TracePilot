//! Schema version migration for imported archives.
//!
//! When we receive an archive with an older schema version, the migrator
//! transforms it forward to the current version via a chain of per-version
//! migration functions.
//!
//! Currently at v1.0, so no migrations are needed yet. This module provides
//! the infrastructure for future migrations when the schema evolves.

use serde_json::Value;

use crate::error::{ExportError, Result};
use crate::schema::{SchemaVersion, CURRENT_VERSION};

/// Migrate an archive JSON value from `from_version` to the current version.
///
/// Each migration step transforms the raw JSON from version N to N+1.
/// This approach works on `serde_json::Value` rather than typed structs
/// so that old schemas (which may not match current types) can still be processed.
///
/// Returns the migrated JSON that can then be deserialized into `SessionArchive`.
pub fn migrate_to_current(mut doc: Value, from_version: &SchemaVersion) -> Result<Value> {
    let mut version = from_version.clone();

    // Same-major migrations (minor version forward)
    while version.major == CURRENT_VERSION.major && version.minor < CURRENT_VERSION.minor {
        doc = migrate_minor(&doc, &version)?;
        version.minor += 1;
    }

    // Cross-major migrations (major version forward)
    while version.major < CURRENT_VERSION.major {
        doc = migrate_major(&doc, &version)?;
        version = SchemaVersion {
            major: version.major + 1,
            minor: 0,
        };
    }

    // Update the version in the document
    if let Some(header) = doc.get_mut("header") {
        if let Some(sv) = header.get_mut("schemaVersion") {
            *sv = serde_json::to_value(&CURRENT_VERSION)
                .map_err(|e| ExportError::Validation {
                    message: format!("failed to update schema version: {}", e),
                })?;
        }
    }

    Ok(doc)
}

/// Check whether migration is needed and possible.
pub fn needs_migration(version: &SchemaVersion) -> MigrationStatus {
    if version == &CURRENT_VERSION {
        MigrationStatus::NotNeeded
    } else if CURRENT_VERSION.can_read(version) {
        MigrationStatus::Available {
            from: version.clone(),
            to: CURRENT_VERSION,
        }
    } else {
        MigrationStatus::Unsupported {
            version: version.clone(),
            current: CURRENT_VERSION,
        }
    }
}

/// Result of checking migration feasibility.
#[derive(Debug, Clone, PartialEq)]
pub enum MigrationStatus {
    /// Already at current version.
    NotNeeded,
    /// Migration is available from→to.
    Available {
        from: SchemaVersion,
        to: SchemaVersion,
    },
    /// Version is too new or incompatible.
    Unsupported {
        version: SchemaVersion,
        current: SchemaVersion,
    },
}

// ── Migration steps ────────────────────────────────────────────────────────
// Each function transforms the document from version N to N+1.
// Add new migration functions here as the schema evolves.

fn migrate_minor(doc: &Value, version: &SchemaVersion) -> Result<Value> {
    match (version.major, version.minor) {
        // Future: (1, 0) => migrate_v1_0_to_v1_1(doc),
        // Future: (1, 1) => migrate_v1_1_to_v1_2(doc),
        _ => {
            // No known migration for this minor version — pass through.
            // This handles the case where from_version.minor < current.minor
            // but no structural changes were needed (purely additive).
            Ok(doc.clone())
        }
    }
}

fn migrate_major(_doc: &Value, version: &SchemaVersion) -> Result<Value> {
    match version.major {
        // Future: 1 => migrate_v1_to_v2(doc),
        _ => Err(ExportError::UnsupportedVersion {
            major: version.major,
            minor: version.minor,
            min_major: CURRENT_VERSION.major,
            min_minor: CURRENT_VERSION.minor,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{minimal_session, test_archive};

    fn archive_as_value() -> Value {
        let archive = test_archive(minimal_session());
        serde_json::to_value(&archive).unwrap()
    }

    #[test]
    fn current_version_needs_no_migration() {
        assert_eq!(
            needs_migration(&CURRENT_VERSION),
            MigrationStatus::NotNeeded
        );
    }

    #[test]
    fn older_minor_is_available() {
        let old = SchemaVersion { major: 1, minor: 0 };
        // Only triggers if CURRENT_VERSION.minor > 0
        // Since CURRENT_VERSION is 1.0, this should be NotNeeded
        let status = needs_migration(&old);
        assert_eq!(status, MigrationStatus::NotNeeded);
    }

    #[test]
    fn future_major_is_unsupported() {
        let future = SchemaVersion {
            major: 99,
            minor: 0,
        };
        match needs_migration(&future) {
            MigrationStatus::Unsupported { version, .. } => {
                assert_eq!(version.major, 99);
            }
            _ => panic!("expected Unsupported"),
        }
    }

    #[test]
    fn migrate_current_version_is_noop() {
        let doc = archive_as_value();
        let migrated = migrate_to_current(doc.clone(), &CURRENT_VERSION).unwrap();
        // Structure should be equivalent
        assert_eq!(doc["sessions"], migrated["sessions"]);
    }

    #[test]
    fn migrate_updates_version_in_header() {
        let doc = archive_as_value();
        let migrated = migrate_to_current(doc, &CURRENT_VERSION).unwrap();
        let sv = &migrated["header"]["schemaVersion"];
        assert_eq!(sv["major"], CURRENT_VERSION.major);
        assert_eq!(sv["minor"], CURRENT_VERSION.minor);
    }
}
