//! Bound preparation by both session count and estimated source bytes. A single
//! oversized session runs alone; it is never combined with another large input.

use tracepilot_core::provider::SessionLocator;

pub(super) const MAX_SESSIONS: usize = 32;
pub(super) const MAX_SOURCE_BYTES: u64 = 16 * 1024 * 1024;

pub(super) fn take_batch<'a, 'b>(
    remaining: &mut &'a [&'b SessionLocator],
) -> &'a [&'b SessionLocator] {
    let mut bytes = 0_u64;
    let mut count = 0;
    for session in remaining.iter().take(MAX_SESSIONS) {
        let size = session.source_bytes_hint;
        if count > 0 && bytes.saturating_add(size) > MAX_SOURCE_BYTES {
            break;
        }
        bytes = bytes.saturating_add(size);
        count += 1;
    }
    let (batch, rest) = remaining.split_at(count);
    *remaining = rest;
    batch
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracepilot_core::ids::SessionId;
    use tracepilot_core::provider::{SessionRole, SessionSource};

    #[test]
    fn bounds_count_and_isolates_oversized_files() {
        let sessions: Vec<_> = (0..70)
            .map(|index| SessionLocator {
                source: SessionSource::Copilot,
                id: SessionId::from_validated(index.to_string()),
                primary_path: index.to_string().into(),
                parent_id: None,
                role: SessionRole::Primary,
                source_bytes_hint: if index == 32 { MAX_SOURCE_BYTES + 1 } else { 1 },
            })
            .collect();
        let refs: Vec<_> = sessions.iter().collect();
        let mut remaining = refs.as_slice();
        assert_eq!(take_batch(&mut remaining).len(), 32);
        assert_eq!(take_batch(&mut remaining).len(), 1);
        assert_eq!(take_batch(&mut remaining).len(), 32);
        assert_eq!(take_batch(&mut remaining).len(), 5);
        assert!(remaining.is_empty());
    }
}
