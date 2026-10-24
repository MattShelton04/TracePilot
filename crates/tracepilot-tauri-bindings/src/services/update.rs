//! Update service: GitHub-release fetch + semver comparison.
//!
//! Split into a thin production fn (`check_for_updates_with_reqwest`) that
//! does the HTTP + JSON-decode work and a pure parser
//! (`update_result_from_latest_release`) that turns a `(StatusCode, Value)`
//! pair into a `CmdResult<UpdateCheckResult>`. Transport failures go through
//! [`request_error`], which swaps reqwest's opaque "error sending request for
//! url (…)" for a short sentence the Updates panel can show after "Couldn't
//! check for updates:".

use std::time::Duration;

use reqwest::StatusCode;

use crate::error::{BindingsError, CmdResult};
use crate::types::UpdateCheckResult;

const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/MattShelton04/TracePilot/releases/latest";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

/// Production entry point: fetch the latest release from GitHub and delegate
/// shape-validation to [`update_result_from_latest_release`]. Always returns
/// the running app's `CARGO_PKG_VERSION` as `current_version`.
pub(crate) async fn check_for_updates_with_reqwest() -> CmdResult<UpdateCheckResult> {
    check_for_updates_at(LATEST_RELEASE_URL, REQUEST_TIMEOUT).await
}

async fn check_for_updates_at(url: &str, timeout: Duration) -> CmdResult<UpdateCheckResult> {
    let current_str = env!("CARGO_PKG_VERSION");

    // Pin rustls: `github-copilot-sdk` enables reqwest's native-tls feature,
    // which would otherwise become the default backend (ADR-0015).
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .user_agent(format!("TracePilot/{current_str}"))
        .timeout(timeout)
        .build()?;

    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(request_error)?;

    let status = response.status();
    // For non-2xx that the parser handles itself (404), and for 2xx, we still
    // need a body. For 4xx/5xx that the parser maps to a hard error, the body
    // is irrelevant — pass an empty JSON value rather than failing on a
    // possibly non-JSON error page.
    let body = if status == StatusCode::NOT_FOUND || status.is_success() {
        response
            .json::<serde_json::Value>()
            .await
            .map_err(request_error)?
    } else {
        serde_json::Value::Null
    };

    update_result_from_latest_release(current_str, status, body)
}

/// Why a request to GitHub failed, in terms a user can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestFailure {
    /// DNS, refused or reset connection, no network.
    Unreachable,
    /// Connect or response exceeded the client timeout.
    TimedOut,
    /// TLS handshake or certificate failure (often a TLS-intercepting proxy).
    Tls,
    /// A response arrived but its body couldn't be read or decoded.
    BadResponse,
}

impl RequestFailure {
    fn of(err: &reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::TimedOut
        } else if err.is_connect() && is_tls_failure(err) {
            Self::Tls
        } else if err.is_decode() || err.is_body() {
            Self::BadResponse
        } else {
            Self::Unreachable
        }
    }

    /// Read after "Couldn't check for updates: " in Settings → Updates.
    fn message(self) -> &'static str {
        match self {
            Self::Unreachable => "GitHub can't be reached. Check your internet connection.",
            Self::TimedOut => "GitHub didn't respond in time. Try again later.",
            Self::Tls => {
                "The secure connection to GitHub failed. A proxy or firewall may be blocking it."
            }
            Self::BadResponse => "GitHub's response couldn't be read. Try again later.",
        }
    }
}

/// rustls failures reach reqwest as an `io::Error` of kind `InvalidData`
/// wrapping the rustls error; certificate problems also name themselves.
fn is_tls_failure(err: &reqwest::Error) -> bool {
    causes(err).any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == std::io::ErrorKind::InvalidData)
            || cause
                .to_string()
                .to_ascii_lowercase()
                .contains("certificate")
    })
}

/// Walk an error's causes. `io::Error::source` skips the error it wraps,
/// so descend through `get_ref` to reach the TLS error inside.
fn causes<'a>(
    err: &'a (dyn std::error::Error + 'static),
) -> impl Iterator<Item = &'a (dyn std::error::Error + 'static)> {
    std::iter::successors(err.source(), |cause| {
        match cause.downcast_ref::<std::io::Error>() {
            Some(io) => io
                .get_ref()
                .map(|inner| inner as &(dyn std::error::Error + 'static)),
            None => cause.source(),
        }
    })
}

/// Map a reqwest transport failure to a short user-facing message. The full
/// cause chain is logged, since reqwest's own `Display` omits it.
fn request_error(err: reqwest::Error) -> BindingsError {
    let failure = RequestFailure::of(&err);
    tracing::warn!(
        ?failure,
        "Update check request failed: {}",
        error_chain(&err)
    );
    BindingsError::Validation(failure.message().into())
}

fn error_chain(err: &(dyn std::error::Error + 'static)) -> String {
    let mut out = err.to_string();
    for cause in causes(err) {
        out.push_str(": ");
        out.push_str(&cause.to_string());
    }
    out
}

/// Pure parser: turn a `(status, body)` pair from the GitHub releases endpoint
/// into an `UpdateCheckResult`. No I/O, no clock, fully unit-testable.
///
/// - `404` → no release published yet → `has_update = false`, `latest_version = None`.
/// - `429` / `403` → rate-limited → `BindingsError::Validation`.
/// - `>= 500` → upstream failure → `BindingsError::Validation`.
/// - other non-2xx → propagated as `BindingsError::Validation`.
/// - 2xx → parse `tag_name`, strip a leading `v`, compare via semver. A
///   missing or unparseable tag yields `has_update = false` (matches the
///   pre-refactor behaviour).
pub(crate) fn update_result_from_latest_release(
    current: &str,
    status: StatusCode,
    body: serde_json::Value,
) -> CmdResult<UpdateCheckResult> {
    let current_version = semver::Version::parse(current)?;

    match status.as_u16() {
        404 => {
            return Ok(UpdateCheckResult {
                current_version: current.to_string(),
                latest_version: None,
                has_update: false,
                release_url: None,
                published_at: None,
                release_notes: None,
            });
        }
        429 | 403 => {
            return Err(BindingsError::Validation(
                "GitHub's rate limit was reached. Try again later.".into(),
            ));
        }
        s if s >= 500 => {
            return Err(BindingsError::Validation(format!(
                "GitHub had a problem (HTTP {s}). Try again later."
            )));
        }
        s if !(200..300).contains(&s) => {
            return Err(BindingsError::Validation(format!(
                "GitHub returned an unexpected response (HTTP {s})."
            )));
        }
        _ => {}
    }

    let latest_str = body["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');

    let has_update = semver::Version::parse(latest_str)
        .map(|latest| latest > current_version)
        .unwrap_or(false);

    Ok(UpdateCheckResult {
        current_version: current.to_string(),
        latest_version: Some(latest_str.to_string()),
        has_update,
        release_url: body["html_url"].as_str().map(String::from),
        published_at: body["published_at"].as_str().map(String::from),
        release_notes: body["body"]
            .as_str()
            .filter(|notes| !notes.trim().is_empty())
            .map(String::from),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn release(tag: &str) -> serde_json::Value {
        json!({
            "tag_name": tag,
            "html_url": "https://example.invalid/release",
            "published_at": "2030-01-01T00:00:00Z",
            "body": "## Added\n\n- A useful feature",
        })
    }

    #[test]
    fn ok_with_higher_latest_reports_update_available() {
        let result =
            update_result_from_latest_release("1.0.0", StatusCode::OK, release("v1.2.3")).unwrap();

        assert_eq!(result.current_version, "1.0.0");
        assert_eq!(result.latest_version.as_deref(), Some("1.2.3"));
        assert!(result.has_update);
        assert_eq!(
            result.release_url.as_deref(),
            Some("https://example.invalid/release")
        );
        assert_eq!(result.published_at.as_deref(), Some("2030-01-01T00:00:00Z"));
        assert_eq!(
            result.release_notes.as_deref(),
            Some("## Added\n\n- A useful feature")
        );
    }

    #[test]
    fn ok_with_same_version_reports_no_update() {
        let result =
            update_result_from_latest_release("1.2.3", StatusCode::OK, release("v1.2.3")).unwrap();
        assert!(!result.has_update);
        assert_eq!(result.latest_version.as_deref(), Some("1.2.3"));
    }

    #[test]
    fn ok_with_lower_latest_reports_no_update() {
        let result =
            update_result_from_latest_release("2.0.0", StatusCode::OK, release("v1.2.3")).unwrap();
        assert!(!result.has_update);
        assert_eq!(result.latest_version.as_deref(), Some("1.2.3"));
    }

    #[test]
    fn not_found_yields_empty_latest_no_update() {
        let result = update_result_from_latest_release(
            "1.0.0",
            StatusCode::NOT_FOUND,
            serde_json::Value::Null,
        )
        .unwrap();
        assert!(!result.has_update);
        assert_eq!(result.latest_version, None);
        assert_eq!(result.release_url, None);
        assert_eq!(result.published_at, None);
    }

    #[test]
    fn rate_limited_returns_validation_error() {
        let err = update_result_from_latest_release(
            "1.0.0",
            StatusCode::TOO_MANY_REQUESTS,
            serde_json::Value::Null,
        )
        .unwrap_err();
        assert!(matches!(err, BindingsError::Validation(_)));
    }

    #[test]
    fn server_error_returns_validation_error() {
        let err = update_result_from_latest_release(
            "1.0.0",
            StatusCode::BAD_GATEWAY,
            serde_json::Value::Null,
        )
        .unwrap_err();
        assert!(matches!(err, BindingsError::Validation(_)));
    }

    #[test]
    fn malformed_json_yields_no_update_with_empty_latest() {
        // Body that is not the expected object shape is treated the same as a
        // missing `tag_name`: parser succeeds, has_update is false, latest is "".
        let result =
            update_result_from_latest_release("1.0.0", StatusCode::OK, json!("garbage")).unwrap();
        assert!(!result.has_update);
        assert_eq!(result.latest_version.as_deref(), Some(""));
        assert_eq!(result.release_url, None);
        assert_eq!(result.published_at, None);
    }

    #[test]
    fn missing_tag_name_yields_no_update_with_empty_latest() {
        let result = update_result_from_latest_release(
            "1.0.0",
            StatusCode::OK,
            json!({ "html_url": "https://example.invalid/r" }),
        )
        .unwrap();
        assert!(!result.has_update);
        assert_eq!(result.latest_version.as_deref(), Some(""));
        assert_eq!(
            result.release_url.as_deref(),
            Some("https://example.invalid/r")
        );
    }

    #[test]
    fn invalid_current_version_propagates_semver_error() {
        let err = update_result_from_latest_release("not-a-version", StatusCode::OK, release("v1"))
            .unwrap_err();
        assert!(matches!(err, BindingsError::Semver(_)));
    }

    // ── Transport failures, against local sockets only (no real network) ──

    /// Start a one-connection local server that runs `reply` on the socket
    /// and return its base URL.
    async fn local_server<F, Fut>(scheme: &str, reply: F) -> String
    where
        F: FnOnce(tokio::net::TcpStream) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((socket, _)) = listener.accept().await {
                reply(socket).await;
            }
        });
        format!("{scheme}://{addr}/releases/latest")
    }

    async fn check_message(url: &str, timeout: Duration) -> String {
        let err = check_for_updates_at(url, timeout).await.unwrap_err();
        let message = err.to_string();
        assert!(
            !message.contains("127.0.0.1") && !message.contains("error sending request"),
            "raw reqwest text leaked: {message}"
        );
        // Same `{ code, message }` envelope the HTTP-status errors already use.
        assert_eq!(err.code().as_str(), "VALIDATION");
        message
    }

    #[tokio::test]
    async fn refused_connection_says_github_cant_be_reached() {
        // Bind then drop, so nothing listens on the port.
        let addr = TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap()
            .local_addr()
            .unwrap();
        let url = format!("http://{addr}/releases/latest");

        let message = check_message(&url, Duration::from_secs(5)).await;
        assert_eq!(message, RequestFailure::Unreachable.message());
    }

    #[tokio::test]
    async fn silent_server_says_github_didnt_respond_in_time() {
        let url = local_server("http", |mut socket| async move {
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            tokio::time::sleep(Duration::from_secs(5)).await;
        })
        .await;

        let message = check_message(&url, Duration::from_millis(200)).await;
        assert_eq!(message, RequestFailure::TimedOut.message());
    }

    #[tokio::test]
    async fn broken_tls_handshake_says_secure_connection_failed() {
        let url = local_server("https", |mut socket| async move {
            let _ = socket
                .write_all(
                    b"HTTP/1.1 200 OK

not tls",
                )
                .await;
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
        })
        .await;

        let message = check_message(&url, Duration::from_secs(5)).await;
        assert_eq!(message, RequestFailure::Tls.message());
    }

    #[tokio::test]
    async fn unreadable_body_says_response_couldnt_be_read() {
        let url = local_server("http", |mut socket| async move {
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let body = "<html>captive portal</html>";
            let reply = format!(
                "HTTP/1.1 200 OK
content-type: text/html
content-length: {}
connection: close

{body}",
                body.len()
            );
            let _ = socket.write_all(reply.as_bytes()).await;
        })
        .await;

        let message = check_message(&url, Duration::from_secs(5)).await;
        assert_eq!(message, RequestFailure::BadResponse.message());
    }

    #[test]
    fn http_status_errors_read_as_plain_sentences() {
        let rate_limited =
            update_result_from_latest_release("1.0.0", StatusCode::FORBIDDEN, Value::Null)
                .unwrap_err();
        assert_eq!(
            rate_limited.to_string(),
            "GitHub's rate limit was reached. Try again later."
        );
        let upstream =
            update_result_from_latest_release("1.0.0", StatusCode::BAD_GATEWAY, Value::Null)
                .unwrap_err();
        assert_eq!(
            upstream.to_string(),
            "GitHub had a problem (HTTP 502). Try again later."
        );
    }
}
