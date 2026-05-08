//! Update service: GitHub-release fetch + semver comparison.
//!
//! Split into a thin production fn (`check_for_updates_with_reqwest`) that
//! does the HTTP + JSON-decode work and a pure parser
//! (`update_result_from_latest_release`) that turns a `(StatusCode, Value)`
//! pair into a `CmdResult<UpdateCheckResult>`. The parser is what's tested.

use reqwest::StatusCode;

use crate::error::{BindingsError, CmdResult};
use crate::types::UpdateCheckResult;

/// Production entry point: fetch the latest release from GitHub and delegate
/// shape-validation to [`update_result_from_latest_release`]. Always returns
/// the running app's `CARGO_PKG_VERSION` as `current_version`.
pub(crate) async fn check_for_updates_with_reqwest() -> CmdResult<UpdateCheckResult> {
    let current_str = env!("CARGO_PKG_VERSION");

    let client = reqwest::Client::builder()
        .user_agent(format!("TracePilot/{current_str}"))
        .timeout(std::time::Duration::from_secs(8))
        .build()?;

    let response = client
        .get("https://api.github.com/repos/MattShelton04/TracePilot/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await?;

    let status = response.status();
    // For non-2xx that the parser handles itself (404), and for 2xx, we still
    // need a body. For 4xx/5xx that the parser maps to a hard error, the body
    // is irrelevant — pass an empty JSON value rather than failing on a
    // possibly non-JSON error page.
    let body = if status == StatusCode::NOT_FOUND || status.is_success() {
        response.json::<serde_json::Value>().await?
    } else {
        serde_json::Value::Null
    };

    update_result_from_latest_release(current_str, status, body)
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
            });
        }
        429 | 403 => {
            return Err(BindingsError::Validation(
                "GitHub API rate limit reached. Try again later.".into(),
            ));
        }
        s if s >= 500 => {
            return Err(BindingsError::Validation(format!(
                "GitHub API error: HTTP {s}"
            )));
        }
        s if !(200..300).contains(&s) => {
            return Err(BindingsError::Validation(format!(
                "GitHub API error: HTTP {s}"
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(tag: &str) -> serde_json::Value {
        json!({
            "tag_name": tag,
            "html_url": "https://example.invalid/release",
            "published_at": "2030-01-01T00:00:00Z",
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
}
