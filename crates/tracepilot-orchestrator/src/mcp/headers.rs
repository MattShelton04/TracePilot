use crate::mcp::error::McpError;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;

/// HTTP header name for MCP session IDs.
pub(crate) const MCP_SESSION_ID_HEADER: HeaderName = HeaderName::from_static("mcp-session-id");

fn parse_configured_headers(
    headers: &HashMap<String, String>,
) -> Result<Vec<(String, HeaderName, HeaderValue)>, McpError> {
    let mut parsed = Vec::with_capacity(headers.len());
    for (name, value) in headers {
        let parsed_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| McpError::Config(format!("Invalid HTTP header name '{name}': {e}")))?;
        let parsed_value = HeaderValue::from_str(value).map_err(|e| {
            McpError::Config(format!("Invalid HTTP header value for '{name}': {e}"))
        })?;
        parsed.push((name.clone(), parsed_name, parsed_value));
    }

    parsed.sort_by(|(original_a, name_a, _), (original_b, name_b, _)| {
        name_a
            .as_str()
            .cmp(name_b.as_str())
            .then(original_a.cmp(original_b))
    });

    for pair in parsed.windows(2) {
        let [(original_a, name_a, _), (original_b, name_b, _)] = &pair else {
            continue;
        };
        if name_a == name_b {
            return Err(McpError::Config(format!(
                "Duplicate HTTP header names '{original_a}' and '{original_b}' differ only by case"
            )));
        }
    }

    Ok(parsed)
}

pub(crate) fn validate_configured_http_headers(
    headers: &HashMap<String, String>,
) -> Result<(), McpError> {
    parse_configured_headers(headers).map(|_| ())
}

pub(crate) fn build_base_http_headers(
    headers: &HashMap<String, String>,
) -> Result<HeaderMap, McpError> {
    let mut base_headers = HeaderMap::new();
    base_headers.insert(
        reqwest::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    base_headers.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static("application/json, text/event-stream"),
    );

    for (_, name, value) in parse_configured_headers(headers)? {
        base_headers.insert(name, value);
    }

    Ok(base_headers)
}

/// Inject an MCP session ID into HTTP headers if present.
///
/// Per the MCP protocol specification, the server may return an `mcp-session-id`
/// header in the initialize response that must be included in subsequent requests
/// to maintain session continuity.
///
/// If the session ID is `None` or contains invalid HTTP header characters,
/// this function does nothing (no error is returned).
pub(crate) fn inject_session_id_header(headers: &mut HeaderMap, session_id: Option<&str>) {
    if let Some(sid) = session_id
        && let Ok(val) = HeaderValue::from_str(sid)
    {
        headers.insert(MCP_SESSION_ID_HEADER.clone(), val);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_headers_accepts_valid_header_pairs() {
        let headers = HashMap::from([
            ("Authorization".to_string(), "Bearer token".to_string()),
            ("X-TracePilot".to_string(), "enabled".to_string()),
        ]);

        assert!(validate_configured_http_headers(&headers).is_ok());
    }

    #[test]
    fn validate_headers_rejects_invalid_name() {
        let headers = HashMap::from([("Bad Header".to_string(), "value".to_string())]);

        let err = validate_configured_http_headers(&headers).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Invalid HTTP header name"));
        assert!(msg.contains("Bad Header"));
    }

    #[test]
    fn validate_headers_rejects_empty_name() {
        let headers = HashMap::from([("".to_string(), "value".to_string())]);

        let err = validate_configured_http_headers(&headers).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Invalid HTTP header name"));
        assert!(msg.contains("''") || msg.contains("name ''"));
    }

    #[test]
    fn validate_headers_rejects_invalid_value() {
        let headers = HashMap::from([(
            "Authorization".to_string(),
            "Bearer token\r\nX-Injected: true".to_string(),
        )]);

        let err = validate_configured_http_headers(&headers).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Invalid HTTP header value"));
        assert!(msg.contains("Authorization"));
    }

    #[test]
    fn validate_headers_rejects_case_insensitive_duplicates() {
        let headers = HashMap::from([
            ("Authorization".to_string(), "Bearer one".to_string()),
            ("authorization".to_string(), "Bearer two".to_string()),
        ]);

        let err = validate_configured_http_headers(&headers).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("differ only by case"));
        assert!(msg.contains("Authorization"));
        assert!(msg.contains("authorization"));
    }

    #[test]
    fn build_base_headers_lets_user_headers_override_defaults() {
        let headers = HashMap::from([
            (
                "Content-Type".to_string(),
                "application/json; charset=utf-8".to_string(),
            ),
            ("Accept".to_string(), "application/json".to_string()),
        ]);

        let built = build_base_http_headers(&headers).unwrap();

        assert_eq!(
            built
                .get(reqwest::header::CONTENT_TYPE)
                .unwrap()
                .to_str()
                .unwrap(),
            "application/json; charset=utf-8"
        );
        assert_eq!(
            built
                .get(reqwest::header::ACCEPT)
                .unwrap()
                .to_str()
                .unwrap(),
            "application/json"
        );
    }

    #[test]
    fn inject_session_id_header_adds_header_when_present() {
        let mut headers = HeaderMap::new();

        inject_session_id_header(&mut headers, Some("test-session-123"));

        assert_eq!(
            headers
                .get(MCP_SESSION_ID_HEADER)
                .unwrap()
                .to_str()
                .unwrap(),
            "test-session-123"
        );
    }

    #[test]
    fn inject_session_id_header_does_nothing_when_none() {
        let mut headers = HeaderMap::new();

        inject_session_id_header(&mut headers, None);

        assert!(!headers.contains_key(MCP_SESSION_ID_HEADER));
    }

    #[test]
    fn inject_session_id_header_ignores_invalid_value() {
        let mut headers = HeaderMap::new();

        inject_session_id_header(&mut headers, Some("test\u{0000}session"));

        assert!(!headers.contains_key(MCP_SESSION_ID_HEADER));
    }

    #[test]
    fn inject_session_id_header_allows_empty_value() {
        let mut headers = HeaderMap::new();

        inject_session_id_header(&mut headers, Some(""));

        assert_eq!(
            headers
                .get(MCP_SESSION_ID_HEADER)
                .unwrap()
                .to_str()
                .unwrap(),
            ""
        );
    }

    #[test]
    fn inject_session_id_header_overrides_user_configured_session_id() {
        let mut headers = build_base_http_headers(&HashMap::from([(
            "mcp-session-id".to_string(),
            "user-provided".to_string(),
        )]))
        .unwrap();

        inject_session_id_header(&mut headers, Some("negotiated-session"));

        assert_eq!(
            headers
                .get(MCP_SESSION_ID_HEADER)
                .unwrap()
                .to_str()
                .unwrap(),
            "negotiated-session"
        );
    }
}
