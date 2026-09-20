use super::model::{AnyError, Scale, UUID_BASE};
use super::validate::fail;

pub(super) const MIB: u64 = 1024 * 1024;
pub(super) const MASSIVE_MIN_SOURCE_BYTES: u64 = 5 * 512 * MIB;
pub(super) const MASSIVE_MAX_SESSION_BYTES: u64 = 150 * MIB;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SessionSpec {
    pub(super) id: String,
    pub(super) title: String,
    pub(super) profile: &'static str,
    pub(super) event_count: usize,
    pub(super) turn_count: usize,
    pub(super) tool_call_count: usize,
    pub(super) stress_output: bool,
    /// Minimum bytes distributed across tool result strings. Zero preserves
    /// the compact output used by fixture versions created before `massive`.
    pub(super) tool_output_bytes: u64,
}

pub(super) fn build_specs(scale: Scale) -> Result<Vec<SessionSpec>, AnyError> {
    if matches!(scale, Scale::Massive) {
        return Ok(build_massive_specs());
    }

    let count = scale.session_count();
    let mut specs = Vec::with_capacity(count);
    let ordinary_events = [34usize, 50, 82, 130, 258];
    for index in 0..count {
        let (profile, event_count, turn_count, stress_output) = if index + 1 == count {
            if matches!(scale, Scale::Large) {
                ("stress-20k-events", 20_000, 800, true)
            } else {
                ("stress-5k-events", 5_000, 400, true)
            }
        } else if index + 2 == count {
            if matches!(scale, Scale::Large) {
                ("stress-5k-events", 5_000, 400, false)
            } else {
                ("detailed-200-turn", 1_600, 200, false)
            }
        } else if index + 3 == count && matches!(scale, Scale::Large) {
            ("detailed-200-turn", 1_600, 200, false)
        } else {
            let events = ordinary_events[index % ordinary_events.len()];
            ("ordinary", events, ((events - 2) / 8).max(1), false)
        };
        let fixed_events = 2 + 4 * turn_count;
        if event_count < fixed_events || (event_count - fixed_events) % 2 != 0 {
            return fail(format!("invalid event/turn plan for session {index}"));
        }
        let tool_call_count = (event_count - fixed_events) / 2;
        specs.push(session_spec(
            scale,
            index,
            profile,
            turn_count,
            tool_call_count,
            stress_output,
            0,
        ));
    }
    Ok(specs)
}

fn build_massive_specs() -> Vec<SessionSpec> {
    let mut specs = Vec::with_capacity(Scale::Massive.session_count());
    for index in 0..Scale::Massive.session_count() {
        let (profile, turns, tools_per_turn, tool_output_bytes) = match index {
            0..=299 => ("massive-small", [24, 32, 40, 48][index % 4], 2, 384 * 1024),
            300..=429 => (
                "massive-medium",
                [160, 200, 240, 320][index % 4],
                2,
                3 * MIB,
            ),
            430..=479 => ("massive-large", [800, 1_000, 1_200][index % 3], 3, 22 * MIB),
            _ => (
                "massive-monster",
                [2_500, 3_000, 3_500, 4_000][index % 4],
                3,
                50 * MIB,
            ),
        };
        specs.push(session_spec(
            Scale::Massive,
            index,
            profile,
            turns,
            turns * tools_per_turn,
            index + 1 == Scale::Massive.session_count(),
            tool_output_bytes,
        ));
    }
    specs
}

fn session_spec(
    scale: Scale,
    index: usize,
    profile: &'static str,
    turn_count: usize,
    tool_call_count: usize,
    stress_output: bool,
    tool_output_bytes: u64,
) -> SessionSpec {
    let id = uuid::Uuid::from_u128(UUID_BASE + index as u128).to_string();
    SessionSpec {
        id,
        title: format!("Synthetic {} {} session {index:04}", scale.name(), profile),
        profile,
        event_count: 2 + 4 * turn_count + 2 * tool_call_count,
        turn_count,
        tool_call_count,
        stress_output,
        tool_output_bytes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn massive_plan_is_deterministic_and_has_the_requested_shape() {
        let first = build_specs(Scale::Massive).unwrap();
        let second = build_specs(Scale::Massive).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 500);

        let planned_bytes: u64 = first.iter().map(|spec| spec.tool_output_bytes).sum();
        assert!(planned_bytes >= MASSIVE_MIN_SOURCE_BYTES);
        assert_eq!(
            first
                .iter()
                .filter(|spec| spec.profile == "massive-monster")
                .count(),
            20
        );
        assert!(first.iter().any(|spec| spec.turn_count == 2_500));
        assert!(first.iter().any(|spec| spec.turn_count == 4_000));
        assert!(
            first
                .iter()
                .all(|spec| spec.tool_output_bytes < MASSIVE_MAX_SESSION_BYTES)
        );
        assert!(first.iter().all(|spec| {
            spec.event_count == 2 + 4 * spec.turn_count + 2 * spec.tool_call_count
        }));
    }
}
