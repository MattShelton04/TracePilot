//! Construction of the official `github_copilot_sdk::Client` (ADR-0015).
//!
//! TracePilot never uses the SDK's bundled CLI. Every client is built with an
//! explicit [`CliProgram::Path`] pointing at the user's installed `copilot`:
//!
//! - **Stdio** (no CLI URL): the SDK spawns `copilot --server --stdio` as a
//!   private, TracePilot-owned process.
//! - **External** (CLI URL set): the SDK attaches to an already-running
//!   `copilot --ui-server` / `--server` over TCP. The program path is never
//!   spawned in this mode, but SDK 1.0.14 still resolves one, so a best-effort
//!   path is always supplied.

use crate::bridge::{BridgeConnectConfig, BridgeError, ConnectionMode};
use github_copilot_sdk::{CliProgram, Client, ClientOptions, LogLevel, Transport};
use std::path::{Path, PathBuf};

/// Official SDK session handle, as tracked by the bridge.
pub(crate) type SdkSession = github_copilot_sdk::session::Session;

/// Environment variable that overrides CLI discovery, matching the SDK's own
/// override name so power users configure both the same way.
const CLI_PATH_ENV: &str = "COPILOT_CLI_PATH";

/// Split a user-supplied CLI URL into `(host, port)`.
///
/// Accepts `host:port`, `[v6]:port`, and any `scheme://host:port[/path]`
/// form (`http://`, `tcp://`, `ws://`). The scheme is ignored because every
/// Copilot CLI server speaks Content-Length framed JSON-RPC over plain TCP.
pub(crate) fn parse_cli_url(url: &str) -> Result<(String, u16), BridgeError> {
    let trimmed = url.trim();
    let without_scheme = trimmed.split_once("://").map_or(trimmed, |(_, rest)| rest);
    let authority = without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();

    let invalid =
        |why: &str| BridgeError::ConnectionFailed(format!("Invalid CLI URL '{url}': {why}"));

    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (host, after) = rest
            .split_once(']')
            .ok_or_else(|| invalid("unterminated IPv6 address"))?;
        let port = after
            .strip_prefix(':')
            .ok_or_else(|| invalid("missing port"))?;
        (host, port)
    } else {
        authority
            .rsplit_once(':')
            .ok_or_else(|| invalid("missing port"))?
    };

    if host.is_empty() {
        return Err(invalid("missing host"));
    }
    let port: u16 = port.parse().map_err(|_| invalid("port must be 1-65535"))?;
    if port == 0 {
        return Err(invalid("port must be 1-65535"));
    }
    Ok((host.to_string(), port))
}

/// Pick the candidate the SDK can spawn directly.
///
/// On Windows, `where copilot` for an npm install lists an extensionless shell
/// shim before `copilot.cmd`; only native executables and batch files are
/// spawnable, so prefer `.exe`, then `.cmd` / `.bat`.
pub(crate) fn pick_spawnable_cli(candidates: &[PathBuf]) -> Option<PathBuf> {
    if !cfg!(windows) {
        return candidates.first().cloned();
    }
    let has_ext = |p: &Path, exts: &[&str]| {
        p.extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| exts.iter().any(|x| e.eq_ignore_ascii_case(x)))
    };
    candidates
        .iter()
        .find(|p| has_ext(p, &["exe"]))
        .or_else(|| candidates.iter().find(|p| has_ext(p, &["cmd", "bat"])))
        .cloned()
}

/// Locate the user's installed Copilot CLI.
fn resolve_cli_program() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(CLI_PATH_ENV).filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(path));
    }
    let candidates =
        crate::process::find_executables(tracepilot_core::constants::DEFAULT_CLI_COMMAND);
    pick_spawnable_cli(&candidates)
}

fn map_log_level(level: &str) -> LogLevel {
    match level.to_ascii_lowercase().as_str() {
        "none" | "off" => LogLevel::None,
        "error" => LogLevel::Error,
        "warn" | "warning" => LogLevel::Warning,
        "debug" => LogLevel::Debug,
        "all" | "trace" => LogLevel::All,
        _ => LogLevel::Info,
    }
}

/// The connection mode a config selects: a CLI URL means attach over TCP.
pub(crate) fn requested_connection_mode(config: &BridgeConnectConfig) -> ConnectionMode {
    if config.cli_url.is_some() {
        ConnectionMode::Tcp
    } else {
        ConnectionMode::Stdio
    }
}

/// Build SDK client options for a bridge connect request.
///
/// `cli_program` is injected so tests can build options without probing PATH.
pub(crate) fn client_options(
    config: &BridgeConnectConfig,
    cli_program: Option<PathBuf>,
) -> Result<ClientOptions, BridgeError> {
    let mut options = ClientOptions::new();

    match &config.cli_url {
        Some(url) => {
            let (host, port) = parse_cli_url(url)?;
            options.transport = Transport::External {
                host,
                port,
                connection_token: None,
            };
            // Never spawned for external transports; see module docs.
            options.program =
                CliProgram::Path(cli_program.unwrap_or_else(|| {
                    PathBuf::from(tracepilot_core::constants::DEFAULT_CLI_COMMAND)
                }));
            // Auth and logging belong to the external server; the SDK rejects
            // auth options for external transports.
        }
        None => {
            let program = cli_program.ok_or_else(|| {
                BridgeError::ConnectionFailed(
                    "Copilot CLI (`copilot`) was not found on PATH. Install it or set COPILOT_CLI_PATH."
                        .into(),
                )
            })?;
            options.transport = Transport::Stdio;
            options.program = CliProgram::Path(program);
            if let Some(cwd) = &config.cwd {
                options.working_directory = PathBuf::from(cwd);
            }
            match &config.github_token {
                Some(token) => options.github_token = Some(token.clone()),
                None => options.use_logged_in_user = Some(true),
            }
            if let Some(level) = &config.log_level {
                options.log_level = Some(map_log_level(level));
            }
        }
    }
    Ok(options)
}

/// Point a spawned (stdio) CLI at `copilot_home`, the directory TracePilot
/// reads sessions from; otherwise it would use its own default and fail to
/// find them. External servers already run with their own home.
pub(crate) fn use_copilot_home(options: &mut ClientOptions, copilot_home: Option<&Path>) {
    if let (Transport::Stdio, Some(home)) = (&options.transport, copilot_home) {
        options.env.push((
            tracepilot_core::paths::COPILOT_HOME_ENV.into(),
            home.as_os_str().to_owned(),
        ));
    }
}

/// Start an SDK client for `config` against the user's installed CLI.
pub(crate) async fn start_client(
    config: &BridgeConnectConfig,
    copilot_home: Option<&Path>,
) -> Result<Client, BridgeError> {
    let mut options = client_options(config, resolve_cli_program())?;
    use_copilot_home(&mut options, copilot_home);
    Client::start(options)
        .await
        .map_err(|e| BridgeError::ConnectionFailed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(cli_url: Option<&str>) -> BridgeConnectConfig {
        BridgeConnectConfig {
            cli_url: cli_url.map(String::from),
            cwd: Some("C:\\work".into()),
            log_level: Some("debug".into()),
            github_token: None,
        }
    }

    #[test]
    fn parse_cli_url_accepts_common_forms() {
        for (input, host, port) in [
            ("127.0.0.1:60496", "127.0.0.1", 60496),
            ("  localhost:3333 ", "localhost", 3333),
            ("http://127.0.0.1:19836", "127.0.0.1", 19836),
            ("ws://localhost:19836/", "localhost", 19836),
            ("tcp://127.0.0.1:1/ignored?x=1", "127.0.0.1", 1),
            ("[::1]:4321", "::1", 4321),
        ] {
            assert_eq!(
                parse_cli_url(input).unwrap(),
                (host.to_string(), port),
                "{input}"
            );
        }
    }

    #[test]
    fn parse_cli_url_rejects_malformed_input() {
        for input in [
            "",
            "127.0.0.1",
            ":80",
            "host:0",
            "host:70000",
            "[::1]",
            "http://host",
        ] {
            assert!(
                matches!(parse_cli_url(input), Err(BridgeError::ConnectionFailed(_))),
                "{input:?} should be rejected"
            );
        }
    }

    #[test]
    fn pick_spawnable_cli_prefers_native_executables() {
        let npm = vec![
            PathBuf::from(r"C:\npm\copilot"),
            PathBuf::from(r"C:\npm\copilot.cmd"),
            PathBuf::from(r"C:\winget\copilot.exe"),
        ];
        let picked = pick_spawnable_cli(&npm).unwrap();
        if cfg!(windows) {
            assert_eq!(picked, PathBuf::from(r"C:\winget\copilot.exe"));
            assert_eq!(
                pick_spawnable_cli(&npm[..2]).unwrap(),
                PathBuf::from(r"C:\npm\copilot.cmd")
            );
            assert_eq!(pick_spawnable_cli(&npm[..1]), None);
        } else {
            assert_eq!(picked, npm[0]);
        }
        assert_eq!(pick_spawnable_cli(&[]), None);
    }

    #[test]
    fn stdio_options_spawn_the_resolved_cli_with_logged_in_user() {
        let options = client_options(&cfg(None), Some(PathBuf::from("copilot.exe"))).unwrap();
        assert!(matches!(options.transport, Transport::Stdio));
        assert!(matches!(&options.program, CliProgram::Path(p) if p == Path::new("copilot.exe")));
        assert_eq!(options.working_directory, PathBuf::from("C:\\work"));
        assert_eq!(options.use_logged_in_user, Some(true));
        assert!(options.github_token.is_none());
        assert!(matches!(options.log_level, Some(LogLevel::Debug)));
    }

    #[test]
    fn only_a_spawned_cli_is_pointed_at_the_configured_copilot_home() {
        let home = Path::new("D:\\copilot-home");
        let mut stdio = client_options(&cfg(None), Some(PathBuf::from("copilot"))).unwrap();
        use_copilot_home(&mut stdio, Some(home));
        assert_eq!(
            stdio.env,
            vec![("COPILOT_HOME".into(), home.as_os_str().to_owned())]
        );

        let mut external = client_options(&cfg(Some("127.0.0.1:60496")), None).unwrap();
        use_copilot_home(&mut external, Some(home));
        assert!(external.env.is_empty());
    }

    #[test]
    fn stdio_options_require_an_installed_cli() {
        let err = client_options(&cfg(None), None).unwrap_err();
        assert!(matches!(err, BridgeError::ConnectionFailed(ref m) if m.contains("not found")));
    }

    #[test]
    fn stdio_options_prefer_an_explicit_token_over_logged_in_user() {
        let mut config = cfg(None);
        config.github_token = Some("gho_test".into());
        let options = client_options(&config, Some(PathBuf::from("copilot"))).unwrap();
        assert_eq!(options.github_token.as_deref(), Some("gho_test"));
        assert!(options.use_logged_in_user.is_none());
    }

    #[test]
    fn external_options_attach_without_auth_and_tolerate_missing_cli() {
        let options = client_options(&cfg(Some("127.0.0.1:60496")), None).unwrap();
        match &options.transport {
            Transport::External {
                host,
                port,
                connection_token,
            } => {
                assert_eq!(host, "127.0.0.1");
                assert_eq!(*port, 60496);
                assert!(connection_token.is_none());
            }
            other => panic!("expected external transport, got {other:?}"),
        }
        assert!(matches!(&options.program, CliProgram::Path(_)));
        assert!(options.use_logged_in_user.is_none());
        assert!(options.github_token.is_none());
        assert!(options.log_level.is_none());
    }
}
