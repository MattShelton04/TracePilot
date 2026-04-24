//! Validated identifier newtypes.
//!
//! These thin wrappers exist to lift *validated* session / preset / skill
//! identifiers out of the untyped-`String` swamp at the Tauri IPC boundary.
//! They are intentionally minimal:
//!
//! - `#[serde(transparent)]` so wire / TS bindings see a plain string.
//! - Construction is only possible via a validator in the
//!   `tracepilot-tauri-bindings::validators` module (or a test helper inside
//!   this crate), which enforces format rules before a newtype exists.
//! - `as_str`, `AsRef<str>`, and `Display` cover the common read paths;
//!   `into_inner` hands the owned `String` back when callers need it.
//!
//! Keep this module free of heavy deps — it is included on the hot path of
//! every IPC command.

use serde::{Deserialize, Serialize};

macro_rules! impl_id_newtype {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            /// Construct a newtype from a pre-validated string.
            ///
            /// Callers outside this crate should prefer the dedicated
            /// validator helpers (`validate_session_id`, etc.) in
            /// `tracepilot-tauri-bindings` so the format invariants are
            /// enforced in one place.
            pub fn from_validated(s: impl Into<String>) -> Self {
                Self(s.into())
            }

            /// Borrow the underlying identifier as a string slice.
            pub fn as_str(&self) -> &str {
                &self.0
            }

            /// Consume the newtype and return the owned identifier.
            pub fn into_inner(self) -> String {
                self.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }

        impl From<$name> for String {
            fn from(v: $name) -> String {
                v.0
            }
        }
    };
}

impl_id_newtype!(SessionId, "Validated session identifier (UUID format).");
impl_id_newtype!(
    PresetId,
    "Validated preset identifier (filesystem-safe slug)."
);
impl_id_newtype!(SkillName, "Validated skill name (filesystem-safe).");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_id_display_and_as_str_match() {
        let sid = SessionId::from_validated("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
        assert_eq!(sid.as_str(), "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
        assert_eq!(
            format!("{sid}"),
            "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_string()
        );
        assert_eq!(sid.as_ref() as &str, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    }

    #[test]
    fn session_id_serde_is_transparent_string() {
        let sid = SessionId::from_validated("abc-123");
        // Serializes as a bare JSON string, not a tagged object.
        let json = serde_json::to_string(&sid).unwrap();
        assert_eq!(json, "\"abc-123\"");
        // Round-trips back to the newtype through the transparent repr.
        let back: SessionId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, sid);
    }

    #[test]
    fn preset_and_skill_round_trip() {
        let pid = PresetId::from_validated("my-preset");
        let sn = SkillName::from_validated("my.skill");
        assert_eq!(
            serde_json::from_str::<PresetId>(&serde_json::to_string(&pid).unwrap()).unwrap(),
            pid
        );
        assert_eq!(
            serde_json::from_str::<SkillName>(&serde_json::to_string(&sn).unwrap()).unwrap(),
            sn
        );
        // into_inner hands back an owned String unchanged.
        assert_eq!(pid.clone().into_inner(), "my-preset");
        assert_eq!(String::from(sn.clone()), "my.skill");
    }
}
