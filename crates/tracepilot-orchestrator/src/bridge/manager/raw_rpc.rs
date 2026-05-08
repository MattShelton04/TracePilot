//! Raw JSON-RPC framing over TCP — used to bypass the SDK when it sends the
//! wrong method name (e.g. `session.model.switch_to` should be
//! `session.model.switchTo`). See `docs/copilot-sdk-rpc-method-bug.md`.
//!
//! Uses LSP-style `Content-Length` framing (the same framing the CLI uses
//! for stdio and `--ui-server` transports).
//!
//! The public entry point [`raw_rpc_call`] is a thin orchestrator over four
//! private helpers that each own one phase of the protocol:
//!
//! | helper                          | phase                                 |
//! |---------------------------------|---------------------------------------|
//! | [`parse_cli_addr`]              | URL → `host:port` socket address      |
//! | [`send_framed_request`]         | write Content-Length-framed request   |
//! | [`read_content_length_response`]| read framed response (with caps)      |
//! | [`rpc_error_from_response`]     | parsed JSON-RPC error → typed error   |
//!
//! Splitting these out lets tests target each phase against an in-memory
//! [`tokio::io::DuplexStream`] / `Cursor` rather than spinning up a TCP
//! listener for every edge case (oversized headers, duplicate
//! `Content-Length`, etc.).

use std::time::Duration;

use serde_json::Value;
use thiserror::Error;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tracing::debug;

use crate::bridge::BridgeError;

const RPC_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_BODY_SIZE: usize = 10 * 1024 * 1024; // 10 MB
/// Total bytes allowed across the response header block (status line +
/// headers + terminating CRLF). Keeps a misbehaving peer from forcing
/// unbounded allocation in the line buffer.
const MAX_HEADER_BYTES: usize = 64 * 1024;
/// Maximum number of non-empty header lines before we give up.
const MAX_HEADER_LINES: usize = 64;

/// Internal error type for the JSON-RPC raw transport. Converts to
/// [`BridgeError::Sdk`] at the [`raw_rpc_call`] boundary so callers see the
/// existing error contract while individual helpers can return precise
/// typed failures (and tests can match on them).
#[derive(Debug, Error)]
enum RpcError {
    #[error("Invalid CLI URL: empty input")]
    EmptyAddr,

    #[error("TCP connect to {addr}: timed out after {timeout:?}")]
    ConnectTimeout { addr: String, timeout: Duration },

    #[error("TCP connect to {addr}: {source}")]
    Connect {
        addr: String,
        #[source]
        source: std::io::Error,
    },

    #[error("JSON serialize: {0}")]
    JsonSerialize(#[source] serde_json::Error),

    #[error("TCP write timed out")]
    WriteTimeout,

    #[error("TCP write: {0}")]
    Write(#[source] std::io::Error),

    #[error("TCP read header: {0}")]
    ReadHeader(#[source] std::io::Error),

    #[error("TCP read header timed out")]
    ReadHeaderTimeout,

    #[error("Invalid Content-Length")]
    InvalidContentLength,

    /// The response header block exceeded [`MAX_HEADER_BYTES`].
    #[error("Response headers too large: {observed} bytes (max {limit})")]
    HeadersTooLarge { observed: usize, limit: usize },

    /// The response had more than [`MAX_HEADER_LINES`] non-empty header lines.
    #[error("Too many response headers: {observed} lines (max {limit})")]
    TooManyHeaders { observed: usize, limit: usize },

    /// More than one `Content-Length` header was sent.
    #[error("Duplicate Content-Length header in response")]
    DuplicateContentLength,

    #[error("No Content-Length in response")]
    MissingContentLength,

    #[error("Response body too large: {observed} bytes (max {limit})")]
    BodyTooLarge { observed: usize, limit: usize },

    #[error("TCP read body timed out")]
    ReadBodyTimeout,

    #[error("TCP read body: {0}")]
    ReadBody(#[source] std::io::Error),

    #[error("JSON parse response: {0}")]
    JsonParse(#[source] serde_json::Error),

    #[error("JSON-RPC error {code}: {message}")]
    JsonRpc { code: i64, message: String },
}

impl From<RpcError> for BridgeError {
    fn from(err: RpcError) -> Self {
        BridgeError::sdk(err)
    }
}

/// Send a raw JSON-RPC request to the CLI server over TCP.
///
/// Bypasses the SDK to work around upstream method name bugs
/// (e.g. `session.model.switch_to` should be `session.model.switchTo`).
/// Uses Content-Length framing (LSP-style protocol).
pub(super) async fn raw_rpc_call(
    cli_url: &str,
    method: &str,
    params: Value,
) -> Result<Value, BridgeError> {
    let addr = parse_cli_addr(cli_url)?;

    debug!("raw_rpc_call: {} → {} params={}", addr, method, params);

    let mut stream = timeout(RPC_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| RpcError::ConnectTimeout {
            addr: addr.clone(),
            timeout: RPC_TIMEOUT,
        })?
        .map_err(|source| RpcError::Connect {
            addr: addr.clone(),
            source,
        })?;

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });
    let body_bytes = serde_json::to_vec(&body).map_err(RpcError::JsonSerialize)?;

    send_framed_request(&mut stream, &body_bytes, RPC_TIMEOUT).await?;

    let mut reader = BufReader::new(stream);
    let body_buf = read_content_length_response(&mut reader, RPC_TIMEOUT).await?;

    let response: Value = serde_json::from_slice(&body_buf).map_err(RpcError::JsonParse)?;

    debug!("raw_rpc_call: {} response={}", method, response);

    if response.get("error").is_some() {
        return Err(rpc_error_from_response(&response).into());
    }

    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

/// Normalise a CLI URL into a `host:port` socket address.
///
/// Accepts `http://host:port`, `ws://host:port`, bare `host:port`, or a bare
/// port number (promoted to `127.0.0.1:<port>`).
fn parse_cli_addr(input: &str) -> Result<String, RpcError> {
    if input.is_empty() {
        return Err(RpcError::EmptyAddr);
    }
    let addr = if let Some(rest) = input.strip_prefix("http://") {
        rest.to_string()
    } else if let Some(rest) = input.strip_prefix("ws://") {
        rest.to_string()
    } else if input.contains(':') {
        input.to_string()
    } else {
        format!("127.0.0.1:{input}")
    };
    Ok(addr)
}

/// Write a Content-Length-framed JSON-RPC request to `stream`.
///
/// The frame matches the LSP wire format used by the CLI:
/// `Content-Length: <n>\r\n\r\n<body>` written as a single buffered write
/// to keep the existing on-the-wire framing identical.
async fn send_framed_request<W>(
    stream: &mut W,
    body: &[u8],
    write_timeout: Duration,
) -> Result<(), RpcError>
where
    W: AsyncWriteExt + Unpin,
{
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut frame = Vec::with_capacity(header.len() + body.len());
    frame.extend_from_slice(header.as_bytes());
    frame.extend_from_slice(body);

    timeout(write_timeout, stream.write_all(&frame))
        .await
        .map_err(|_| RpcError::WriteTimeout)?
        .map_err(RpcError::Write)
}

/// Read a Content-Length-framed response, enforcing header byte/line caps
/// and rejecting duplicate `Content-Length` headers.
///
/// The caps protect [`raw_rpc_call`] from a misbehaving CLI that streams
/// unbounded headers — without them, a single bad response would force the
/// header line buffer to grow without bound.
async fn read_content_length_response<R>(
    reader: &mut R,
    read_timeout: Duration,
) -> Result<Vec<u8>, RpcError>
where
    R: AsyncBufRead + Unpin,
{
    let content_length = timeout(read_timeout, async {
        let mut content_length: Option<usize> = None;
        let mut header_bytes: usize = 0;
        let mut header_lines: usize = 0;

        loop {
            let mut line = String::new();
            let read = reader
                .read_line(&mut line)
                .await
                .map_err(RpcError::ReadHeader)?;
            if read == 0 {
                // EOF before terminating blank line.
                break;
            }
            header_bytes = header_bytes.saturating_add(read);
            if header_bytes > MAX_HEADER_BYTES {
                return Err(RpcError::HeadersTooLarge {
                    observed: header_bytes,
                    limit: MAX_HEADER_BYTES,
                });
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                break;
            }

            header_lines = header_lines.saturating_add(1);
            if header_lines > MAX_HEADER_LINES {
                return Err(RpcError::TooManyHeaders {
                    observed: header_lines,
                    limit: MAX_HEADER_LINES,
                });
            }

            if let Some((name, value)) = trimmed.split_once(':')
                && name.trim().eq_ignore_ascii_case("Content-Length")
            {
                if content_length.is_some() {
                    return Err(RpcError::DuplicateContentLength);
                }
                let parsed: usize = value
                    .trim()
                    .parse()
                    .map_err(|_| RpcError::InvalidContentLength)?;
                content_length = Some(parsed);
            }
        }

        Ok::<Option<usize>, RpcError>(content_length)
    })
    .await
    .map_err(|_| RpcError::ReadHeaderTimeout)??;

    // Match legacy behaviour: missing header *and* `Content-Length: 0` both
    // surface as `MissingContentLength`.
    let content_length = match content_length {
        Some(n) if n > 0 => n,
        _ => return Err(RpcError::MissingContentLength),
    };

    if content_length > MAX_BODY_SIZE {
        return Err(RpcError::BodyTooLarge {
            observed: content_length,
            limit: MAX_BODY_SIZE,
        });
    }

    let mut body_buf = vec![0u8; content_length];
    timeout(read_timeout, reader.read_exact(&mut body_buf))
        .await
        .map_err(|_| RpcError::ReadBodyTimeout)?
        .map_err(RpcError::ReadBody)?;

    Ok(body_buf)
}

/// Convert a JSON-RPC response that has an `error` field into a typed
/// [`RpcError::JsonRpc`]. Missing fields fall back to `code=0` /
/// `message="Unknown"`, matching the legacy formatter.
fn rpc_error_from_response(response: &Value) -> RpcError {
    let error = response.get("error");
    let code = error
        .and_then(|e| e.get("code"))
        .and_then(|c| c.as_i64())
        .unwrap_or(0);
    let message = error
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
        .unwrap_or("Unknown")
        .to_string();
    RpcError::JsonRpc { code, message }
}

#[cfg(test)]
#[path = "raw_rpc_helper_tests.rs"]
mod helper_tests;
