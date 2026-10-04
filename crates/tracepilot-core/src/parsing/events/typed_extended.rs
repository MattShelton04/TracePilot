//! Typed dispatch for event types added in Copilot CLI 1.0.86–1.0.91.
//!
//! Kept beside [`super::typed`] so the main dispatch table stays within its
//! size budget; behaviour matches its `try_deser!` arms.

use super::types::TypedEventData;
use crate::models::event_types::SessionEventType;
use crate::parsing::diagnostics::EventParseWarning;
use serde::Deserialize;
use serde_json::Value;

type Typed = (TypedEventData, Option<EventParseWarning>);

fn deser<'a, T: Deserialize<'a>>(
    data: &'a Value,
    event_type: &SessionEventType,
    wrap: fn(T) -> TypedEventData,
) -> Typed {
    match T::deserialize(data) {
        Ok(typed) => (wrap(typed), None),
        Err(e) => (
            TypedEventData::Other(data.clone()),
            Some(EventParseWarning::DeserializationFailed {
                event_type: event_type.to_string(),
                error: e.to_string(),
            }),
        ),
    }
}

/// Returns `None` for event types handled by the main dispatch table.
pub(super) fn typed_extended(event_type: &SessionEventType, data: &Value) -> Option<Typed> {
    Some(match event_type {
        SessionEventType::SessionModelDeselected => {
            deser(data, event_type, TypedEventData::SessionModelDeselected)
        }
        SessionEventType::SessionFusionChangeCheckpoint => deser(
            data,
            event_type,
            TypedEventData::SessionFusionChangeCheckpoint,
        ),
        SessionEventType::SessionPermissionRecovery => {
            deser(data, event_type, TypedEventData::SessionPermissionRecovery)
        }
        SessionEventType::SkillInvokedRef => {
            deser(data, event_type, TypedEventData::SkillInvokedRef)
        }
        SessionEventType::SkillContextDelivered => {
            deser(data, event_type, TypedEventData::SkillContextDelivered)
        }
        SessionEventType::SkillContextDeliveredRef => {
            deser(data, event_type, TypedEventData::SkillContextDeliveredRef)
        }
        SessionEventType::PermissionCarriedForward => {
            deser(data, event_type, TypedEventData::PermissionCarriedForward)
        }
        SessionEventType::PermissionMessageAuthorization => deser(
            data,
            event_type,
            TypedEventData::PermissionMessageAuthorization,
        ),
        SessionEventType::PermissionMessageAuthorizationRead => deser(
            data,
            event_type,
            TypedEventData::PermissionMessageAuthorizationRead,
        ),
        SessionEventType::PermissionMessageAuthorizationDegraded => deser(
            data,
            event_type,
            TypedEventData::PermissionMessageAuthorizationDegraded,
        ),
        SessionEventType::PermissionAssentDetected => {
            deser(data, event_type, TypedEventData::PermissionAssentDetected)
        }
        SessionEventType::PermissionContextualAuthorization => deser(
            data,
            event_type,
            TypedEventData::PermissionContextualAuthorization,
        ),
        _ => return None,
    })
}
