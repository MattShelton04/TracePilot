//! Reusable input validation for Tauri command parameters.
//!
//! Centralises boundary checks that were previously scattered (or missing)
//! across individual command handlers.  Every public helper returns
//! [`CmdResult`](crate::error::CmdResult) so callers can propagate with `?`.
//!
//! Split by input shape:
//! * [`id`] — UUID-format identifiers (session / task / job)
//! * [`path`] — path-safe filesystem names (template / preset / skill / asset)
//! * [`rules`] — generic rules (pagination, date/timestamp ranges, display helpers)

mod id;
mod path;
mod rules;

#[cfg(test)]
mod tests;

pub(crate) use id::{
    validate_job_id, validate_optional_session_id, validate_session_id, validate_session_id_list,
    validate_task_id,
};
pub(crate) use path::{
    validate_asset_name, validate_path_segment, validate_preset_id, validate_skill_name,
    validate_template_id,
};
pub(crate) use rules::{
    MAX_EVENTS_PAGE_LIMIT, clamp_limit, validate_iso_date_range, validate_unix_date_range,
};
