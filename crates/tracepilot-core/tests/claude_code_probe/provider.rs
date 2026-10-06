//! `ClaudeCodeProvider` over the real config dir (C1). Prints counts only.

use std::collections::BTreeMap;
use std::path::Path;

use tracepilot_core::provider::SessionProvider;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;

pub fn report(config_dir: &Path, probe_sessions: usize) {
    let provider = ClaudeCodeProvider::new(config_dir);
    let sessions = provider.discover(&|| false).expect("discover");
    let mut loads: BTreeMap<&str, usize> = BTreeMap::new();
    let mut liveness: BTreeMap<String, usize> = BTreeMap::new();
    let mut unstable_fingerprints = 0;
    for session in &sessions {
        let strict = match provider.load_snapshot(session, true, &|| false) {
            Ok(snapshot) => {
                if snapshot.summary.turn_count.is_none() || snapshot.events.is_none() {
                    "strict ok, but no turns"
                } else {
                    "strict ok"
                }
            }
            Err(_) if provider.load_snapshot(session, false, &|| false).is_ok() => {
                "strict refused, best effort ok"
            }
            Err(_) => "both failed",
        };
        *loads.entry(strict).or_default() += 1;
        let before = provider.fingerprint(session).expect("fingerprint");
        if provider.fingerprint(session).expect("fingerprint") != before {
            unstable_fingerprints += 1;
        }
        let state = format!("{:?}", provider.liveness(session));
        let state = state.split([' ', '{']).next().unwrap_or("").to_string();
        *liveness.entry(state).or_default() += 1;
    }
    // A live transcript grows between calls, so compare paths, not byte hints.
    let resolved = sessions
        .iter()
        .filter(|s| {
            provider
                .resolve(&s.id)
                .ok()
                .flatten()
                .is_some_and(|found| found.primary_path == s.primary_path)
        })
        .count();
    let mut ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
    ids.sort_unstable();
    ids.dedup();
    let duplicate_ids = sessions.len() - ids.len();
    println!("\n### Provider (`ClaudeCodeProvider`)\n");
    println!(
        "- Discovered {} (probe found {probe_sessions}); resolved by id to the same file {resolved}; \
         ids in more than one project {duplicate_ids}",
        sessions.len()
    );
    println!("- Loads: {loads:?}");
    println!("- Fingerprints that changed between two immediate reads: {unstable_fingerprints}");
    println!("- Liveness without a process check: {liveness:?}");
}
