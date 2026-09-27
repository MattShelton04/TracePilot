use super::config::*;
use crate::json_io::{atomic_json_read, atomic_json_write};
use crate::mcp::error::McpError;
use crate::mcp::types::{McpServerConfig, McpTransport};
use std::collections::HashMap;
use std::path::PathBuf;
use tempfile::TempDir;

fn with_temp_home<F: FnOnce(&std::path::Path)>(f: F) {
    let tmp = TempDir::new().unwrap();
    f(tmp.path());
}

fn setup_test_config(dir: &TempDir) -> PathBuf {
    let path = dir.path().join("mcp-config.json");
    let config = McpConfigFile {
        mcp_servers: HashMap::from([
            (
                "test-server".to_string(),
                McpServerConfig {
                    command: Some("npx".into()),
                    args: vec!["-y".into(), "@mcp/test".into()],
                    env: HashMap::new(),
                    url: None,
                    transport: None,
                    headers: HashMap::new(),
                    tools: vec![],
                    description: Some("Test MCP server".into()),
                    tags: vec!["test".into()],
                    enabled: true,
                },
            ),
            (
                "disabled-server".to_string(),
                McpServerConfig {
                    command: Some("node".into()),
                    args: vec!["server.js".into()],
                    env: HashMap::new(),
                    url: None,
                    transport: None,
                    headers: HashMap::new(),
                    tools: vec![],
                    description: None,
                    tags: vec![],
                    enabled: false,
                },
            ),
        ]),
    };
    atomic_json_write(&path, &config).unwrap();
    path
}

#[test]
fn config_round_trip() {
    let dir = TempDir::new().unwrap();
    let path = setup_test_config(&dir);
    let loaded: McpConfigFile = atomic_json_read(&path).unwrap();
    assert_eq!(loaded.mcp_servers.len(), 2);
    assert!(loaded.mcp_servers.contains_key("test-server"));
}

#[test]
fn empty_config_deserializes_to_default() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("empty.json");
    let config: McpConfigFile = atomic_json_read(&path).unwrap();
    assert!(config.mcp_servers.is_empty());
}

#[test]
fn server_config_preserves_env_vars() {
    let mut env = HashMap::new();
    env.insert("API_KEY".into(), "test-key".into());
    env.insert("DEBUG".into(), "true".into());

    let cfg = McpServerConfig {
        command: Some("cmd".into()),
        args: vec![],
        env,
        url: None,
        transport: None,
        headers: HashMap::new(),
        tools: vec![],
        description: None,
        tags: vec![],
        enabled: true,
    };

    let json = serde_json::to_string(&cfg).unwrap();
    let parsed: McpServerConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.env.get("API_KEY").unwrap(), "test-key");
    assert_eq!(parsed.env.get("DEBUG").unwrap(), "true");
}

#[test]
fn add_server_rejects_invalid_http_headers() {
    with_temp_home(|home| {
        let server = McpServerConfig {
            command: None,
            args: vec![],
            env: HashMap::new(),
            url: Some("https://example.com/mcp".into()),
            transport: Some(McpTransport::StreamableHttp),
            headers: HashMap::from([("Bad Header".into(), "value".into())]),
            tools: vec![],
            description: None,
            tags: vec![],
            enabled: true,
        };

        let err = add_server_in(home, "remote-test", server).unwrap_err();
        let msg = err.to_string();

        assert!(matches!(err, McpError::Config(_)));
        assert!(msg.contains("Invalid HTTP header name"));
        assert!(msg.contains("Bad Header"));
    });
}

#[test]
fn add_server_rejects_reserved_session_header() {
    with_temp_home(|home| {
        let server = McpServerConfig {
            command: None,
            args: vec![],
            env: HashMap::new(),
            url: Some("https://example.com/mcp".into()),
            transport: Some(McpTransport::StreamableHttp),
            headers: HashMap::from([("mcp-session-id".into(), "user-provided".into())]),
            tools: vec![],
            description: None,
            tags: vec![],
            enabled: true,
        };

        let err = add_server_in(home, "remote-test", server).unwrap_err();
        let msg = err.to_string();

        assert!(matches!(err, McpError::Config(_)));
        assert!(msg.contains("reserved"));
        assert!(msg.contains("mcp-session-id"));
    });
}

#[test]
fn update_server_rejects_invalid_http_headers_without_changing_saved_config() {
    with_temp_home(|home| {
        let path = mcp_config_path_in(home).unwrap();
        let initial = McpConfigFile {
            mcp_servers: HashMap::from([(
                "remote-test".into(),
                McpServerConfig {
                    command: None,
                    args: vec![],
                    env: HashMap::new(),
                    url: Some("https://example.com/mcp".into()),
                    transport: Some(McpTransport::StreamableHttp),
                    headers: HashMap::from([("Authorization".into(), "Bearer valid".into())]),
                    tools: vec![],
                    description: None,
                    tags: vec![],
                    enabled: true,
                },
            )]),
        };
        atomic_json_write(&path, &initial).unwrap();

        let updated = McpServerConfig {
            command: None,
            args: vec![],
            env: HashMap::new(),
            url: Some("https://example.com/mcp".into()),
            transport: Some(McpTransport::StreamableHttp),
            headers: HashMap::from([(
                "Authorization".into(),
                "Bearer token\r\nX-Injected: true".into(),
            )]),
            tools: vec![],
            description: None,
            tags: vec![],
            enabled: true,
        };

        let err = update_server_in(home, "remote-test", updated).unwrap_err();
        let msg = err.to_string();
        assert!(matches!(err, McpError::Config(_)));
        assert!(msg.contains("Invalid HTTP header value"));
        assert!(msg.contains("Authorization"));

        let reloaded = load_config_in(home).unwrap();
        let saved = reloaded.mcp_servers.get("remote-test").unwrap();
        assert_eq!(
            saved.headers.get("Authorization").map(String::as_str),
            Some("Bearer valid")
        );
    });
}

#[test]
fn add_server_rejects_case_duplicate_headers() {
    with_temp_home(|home| {
        let server = McpServerConfig {
            command: None,
            args: vec![],
            env: HashMap::new(),
            url: Some("https://example.com/mcp".into()),
            transport: Some(McpTransport::StreamableHttp),
            headers: HashMap::from([
                ("Authorization".into(), "Bearer one".into()),
                ("authorization".into(), "Bearer two".into()),
            ]),
            tools: vec![],
            description: None,
            tags: vec![],
            enabled: true,
        };

        let err = add_server_in(home, "remote-test", server).unwrap_err();
        let msg = err.to_string();

        assert!(matches!(err, McpError::Config(_)));
        assert!(msg.contains("differ only by case"));
    });
}
