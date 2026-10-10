//! The session providers the app reads from, built from config.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use tracepilot_core::provider::claude_code::{ClaudeCodeProvider, StalePidFiles};
use tracepilot_core::provider::{CopilotProvider, ProviderRegistry, SessionSource};

use crate::config::TracePilotConfig;

/// The enabled providers for `config`: Copilot always, Claude Code while its
/// experimental flag is on.
pub(crate) fn registry_for(config: &TracePilotConfig) -> ProviderRegistry {
    let mut registry = ProviderRegistry::new();
    registry.register(Arc::new(CopilotProvider::new(config.session_state_dir())));
    if let Some(root) = claude_code_root(config) {
        registry.register(Arc::new(
            ClaudeCodeProvider::new(root)
                .with_process_start(Arc::new(process_start))
                .with_stale_pid_files(Arc::clone(&STALE_PID_FILES)),
        ));
    }
    registry
}

/// How long a process start time is reused on macOS, where a lookup spawns
/// `ps`; this dedupes the session list's and a running session's detail
/// view's polls there. A Claude Code process removes its pid file on exit, so
/// reuse only delays noticing a crash.
const PROCESS_START_TTL: Duration = Duration::from_secs(5);

type ProcessStarts = Mutex<HashMap<u32, (Instant, Option<String>)>>;

static PROCESS_STARTS: LazyLock<ProcessStarts> = LazyLock::new(Default::default);

/// Pid files proven stale, for the life of the app.
static STALE_PID_FILES: LazyLock<Arc<StalePidFiles>> = LazyLock::new(Default::default);

/// A process's start time. Elsewhere than macOS a lookup is a few Win32
/// calls or a `/proc` read (about 1.5 µs a pid on Windows), so each pass
/// looks again and a crashed session shows at once.
fn process_start(pid: u32) -> Option<String> {
    let lookup = tracepilot_orchestrator::process::process_start_time;
    if cfg!(target_os = "macos") {
        reuse_process_start(&PROCESS_STARTS, pid, Instant::now(), lookup)
    } else {
        lookup(pid)
    }
}

/// `lookup(pid)`, reusing an answer younger than [`PROCESS_START_TTL`].
fn reuse_process_start(
    cache: &ProcessStarts,
    pid: u32,
    now: Instant,
    lookup: impl FnOnce(u32) -> Option<String>,
) -> Option<String> {
    let fresh = |at: &Instant| now.saturating_duration_since(*at) < PROCESS_START_TTL;
    let cached = cache.lock().ok().and_then(|cache| {
        cache
            .get(&pid)
            .filter(|(at, _)| fresh(at))
            .map(|(_, start)| start.clone())
    });
    if let Some(start) = cached {
        return start;
    }
    // Look up without the lock, so one slow lookup never blocks others.
    let start = lookup(pid);
    if let Ok(mut cache) = cache.lock() {
        cache.retain(|_, (at, _)| fresh(at));
        cache.insert(pid, (now, start.clone()));
    }
    start
}

/// `registry_for`, limited to `source`.
pub(crate) fn registry_for_source(
    config: &TracePilotConfig,
    source: SessionSource,
) -> ProviderRegistry {
    let mut registry = ProviderRegistry::new();
    if let Some(provider) = registry_for(config).get(source) {
        registry.register(Arc::clone(provider));
    }
    registry
}

/// Claude Code's root while its source is enabled.
pub(crate) fn claude_code_root(config: &TracePilotConfig) -> Option<PathBuf> {
    config
        .features
        .claude_code_sessions
        .then(|| config.claude_config_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(config: &TracePilotConfig) -> Vec<SessionSource> {
        registry_for(config)
            .providers()
            .iter()
            .map(|provider| provider.source())
            .collect()
    }

    #[test]
    fn process_starts_are_reused_briefly() {
        let cache = ProcessStarts::default();
        let start = Instant::now();
        let calls = std::cell::Cell::new(0);
        let lookup = |pid: u32| {
            calls.set(calls.get() + 1);
            Some(format!("{pid}-{}", calls.get()))
        };
        let first = reuse_process_start(&cache, 7, start, lookup);
        assert_eq!(first.as_deref(), Some("7-1"));
        let soon = start + PROCESS_START_TTL / 2;
        assert_eq!(reuse_process_start(&cache, 7, soon, lookup), first);
        assert_eq!(calls.get(), 1);
        let later = start + PROCESS_START_TTL;
        assert_eq!(
            reuse_process_start(&cache, 7, later, lookup).as_deref(),
            Some("7-2")
        );
        assert_eq!(reuse_process_start(&cache, 8, later, |_| None), None);
        assert_eq!(cache.lock().unwrap().len(), 2);
    }

    #[test]
    fn claude_code_is_registered_only_while_its_flag_is_on() {
        let mut config = TracePilotConfig::default();
        assert_eq!(sources(&config), [SessionSource::Copilot]);

        config.features.claude_code_sessions = true;
        assert_eq!(
            sources(&config),
            [SessionSource::Copilot, SessionSource::ClaudeCode]
        );
        let only = registry_for_source(&config, SessionSource::ClaudeCode);
        assert_eq!(only.providers().len(), 1);
        assert_eq!(only.providers()[0].source(), SessionSource::ClaudeCode);
    }
}
