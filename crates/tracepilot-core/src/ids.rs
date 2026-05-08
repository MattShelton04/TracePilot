//! Validated identifier newtypes.
//!
//! These thin wrappers exist to lift *validated* session / skill
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

#[cfg(feature = "specta")]
use specta::Type;

macro_rules! impl_id_newtype {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[cfg_attr(feature = "specta", derive(Type))]
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
impl_id_newtype!(SkillName, "Validated skill name (filesystem-safe).");
impl_id_newtype!(TurnId, "Opaque turn identifier.");
impl_id_newtype!(EventId, "Opaque event identifier.");

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
    fn skill_round_trip() {
        let sn = SkillName::from_validated("my.skill");
        assert_eq!(
            serde_json::from_str::<SkillName>(&serde_json::to_string(&sn).unwrap()).unwrap(),
            sn
        );
        // into_inner hands back an owned String unchanged.
        assert_eq!(String::from(sn.clone()), "my.skill");
    }

    #[test]
    fn turn_id_uuid_shaped() {
        let id = TurnId::from_validated("12345678-1234-1234-1234-123456789abc");
        assert_eq!(id.as_str(), "12345678-1234-1234-1234-123456789abc");
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"12345678-1234-1234-1234-123456789abc\"");
        let back: TurnId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn turn_id_synthetic() {
        let id = TurnId::from_validated("turn-1");
        assert_eq!(id.as_str(), "turn-1");
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"turn-1\"");
        let back: TurnId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn turn_id_more_synthetic_cases() {
        for synthetic_id in &["turn-42", "turn-999", "t1", "t-42-a"] {
            let id = TurnId::from_validated(*synthetic_id);
            assert_eq!(id.as_str(), *synthetic_id);
            let json = serde_json::to_string(&id).unwrap();
            let back: TurnId = serde_json::from_str(&json).unwrap();
            assert_eq!(back, id);
            assert_eq!(format!("{}", id), *synthetic_id);
        }
    }

    #[test]
    fn event_id_uuid_shaped() {
        let id = EventId::from_validated("87654321-4321-4321-4321-abcdef123456");
        assert_eq!(id.as_str(), "87654321-4321-4321-4321-abcdef123456");
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"87654321-4321-4321-4321-abcdef123456\"");
        let back: EventId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn event_id_synthetic() {
        let id = EventId::from_validated("evt-1");
        assert_eq!(id.as_str(), "evt-1");
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"evt-1\"");
        let back: EventId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn event_id_more_synthetic_cases() {
        for synthetic_id in &["evt-1", "m1", "d1", "evt-42", "event-abc-123"] {
            let id = EventId::from_validated(*synthetic_id);
            assert_eq!(id.as_str(), *synthetic_id);
            let json = serde_json::to_string(&id).unwrap();
            let back: EventId = serde_json::from_str(&json).unwrap();
            assert_eq!(back, id);
            assert_eq!(format!("{}", id), *synthetic_id);
        }
    }

    #[test]
    fn turn_id_as_ref() {
        let id = TurnId::from_validated("turn-123");
        assert_eq!(id.as_ref() as &str, "turn-123");
        let _: &str = id.as_ref();
    }

    #[test]
    fn event_id_as_ref() {
        let id = EventId::from_validated("evt-456");
        assert_eq!(id.as_ref() as &str, "evt-456");
        let _: &str = id.as_ref();
    }

    #[test]
    fn turn_id_into_inner() {
        let id = TurnId::from_validated("turn-789");
        let s: String = id.into_inner();
        assert_eq!(s, "turn-789");
    }

    #[test]
    fn event_id_into_inner() {
        let id = EventId::from_validated("evt-999");
        let s: String = id.into_inner();
        assert_eq!(s, "evt-999");
    }

    #[test]
    fn turn_id_from_string() {
        let id = TurnId::from_validated("turn-abc");
        let s: String = id.into();
        assert_eq!(s, "turn-abc");
    }

    #[test]
    fn event_id_from_string() {
        let id = EventId::from_validated("evt-def");
        let s: String = id.into();
        assert_eq!(s, "evt-def");
    }
}
