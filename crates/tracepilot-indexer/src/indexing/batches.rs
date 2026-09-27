//! Bound preparation by both session count and estimated source bytes. A single
//! oversized session runs alone; it is never combined with another large input.

use tracepilot_core::session::discovery::DiscoveredSession;

pub(super) const MAX_SESSIONS: usize = 32;
pub(super) const MAX_SOURCE_BYTES: u64 = 16 * 1024 * 1024;

pub(super) fn take_batch<'a, 'b>(
    remaining: &mut &'a [&'b DiscoveredSession],
) -> &'a [&'b DiscoveredSession] {
    let mut bytes = 0_u64;
    let mut count = 0;
    for session in remaining.iter().take(MAX_SESSIONS) {
        let size = std::fs::metadata(session.path.join("events.jsonl"))
            .map_or(MAX_SOURCE_BYTES, |metadata| metadata.len());
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

    #[test]
    fn bounds_count_and_isolates_oversized_files() {
        let temp = tempfile::tempdir().unwrap();
        let sessions: Vec<_> = (0..70)
            .map(|index| {
                let path = temp.path().join(index.to_string());
                std::fs::create_dir(&path).unwrap();
                let file = std::fs::File::create(path.join("events.jsonl")).unwrap();
                file.set_len(if index == 32 { MAX_SOURCE_BYTES + 1 } else { 1 })
                    .unwrap();
                DiscoveredSession {
                    id: SessionId::from_validated(index.to_string()),
                    path,
                    has_events_jsonl: true,
                    has_workspace_yaml: false,
                    has_session_db: false,
                }
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
