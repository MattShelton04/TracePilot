//! Schema versioning for the TracePilot interchange format.
//!
//! Every exported file carries a [`SchemaVersion`] so importers can detect
//! compatibility and apply migrations when needed.

use serde::{Deserialize, Serialize};

/// Current schema version written by this build of TracePilot.
pub const CURRENT_VERSION: SchemaVersion = SchemaVersion { major: 1, minor: 0 };

/// Minimum reader version required to import files produced by this writer.
/// Bumped when we add features that older readers cannot safely ignore.
pub const MINIMUM_READER_VERSION: SchemaVersion = SchemaVersion { major: 1, minor: 0 };

/// Two-part version identifier for the export schema.
///
/// - **Major:** Incremented for breaking changes (field renames, type changes,
///   removed required fields). Old readers cannot import new-major files.
/// - **Minor:** Incremented for additive changes (new optional fields, new
///   section types). Old readers can import new-minor files by ignoring unknowns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaVersion {
    pub major: u32,
    pub minor: u32,
}

impl SchemaVersion {
    /// Check whether a reader at `self` version can import a file at `file_version`.
    ///
    /// Rules:
    /// - Same major: always compatible (minor differences are additive).
    /// - Different major: incompatible.
    pub fn can_read(&self, file_version: &SchemaVersion) -> bool {
        self.major == file_version.major
    }

    /// Check whether a file's `minimum_reader_version` is satisfied by `self`.
    pub fn satisfies_minimum(&self, minimum: &SchemaVersion) -> bool {
        self.major > minimum.major
            || (self.major == minimum.major && self.minor >= minimum.minor)
    }
}

impl std::fmt::Display for SchemaVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}", self.major, self.minor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_version_is_compatible() {
        let v = SchemaVersion { major: 1, minor: 0 };
        assert!(v.can_read(&v));
    }

    #[test]
    fn same_major_different_minor_is_compatible() {
        let reader = SchemaVersion { major: 1, minor: 0 };
        let file = SchemaVersion { major: 1, minor: 3 };
        assert!(reader.can_read(&file));
    }

    #[test]
    fn different_major_is_incompatible() {
        let reader = SchemaVersion { major: 1, minor: 0 };
        let file = SchemaVersion { major: 2, minor: 0 };
        assert!(!reader.can_read(&file));
    }

    #[test]
    fn satisfies_minimum_when_equal() {
        let reader = SchemaVersion { major: 1, minor: 2 };
        let min = SchemaVersion { major: 1, minor: 2 };
        assert!(reader.satisfies_minimum(&min));
    }

    #[test]
    fn satisfies_minimum_when_newer_minor() {
        let reader = SchemaVersion { major: 1, minor: 5 };
        let min = SchemaVersion { major: 1, minor: 2 };
        assert!(reader.satisfies_minimum(&min));
    }

    #[test]
    fn does_not_satisfy_minimum_when_older() {
        let reader = SchemaVersion { major: 1, minor: 0 };
        let min = SchemaVersion { major: 1, minor: 2 };
        assert!(!reader.satisfies_minimum(&min));
    }

    #[test]
    fn display_format() {
        let v = SchemaVersion { major: 1, minor: 3 };
        assert_eq!(v.to_string(), "1.3");
    }

    #[test]
    fn serde_round_trip() {
        let v = SchemaVersion { major: 2, minor: 1 };
        let json = serde_json::to_string(&v).unwrap();
        assert!(json.contains("\"major\""));
        let deserialized: SchemaVersion = serde_json::from_str(&json).unwrap();
        assert_eq!(v, deserialized);
    }
}
