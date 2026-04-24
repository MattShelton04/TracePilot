//! URL policy for MCP servers.
//!
//! MCP server URLs are user-configured and are reached from the TracePilot
//! process via `reqwest`. Without a policy, a malicious or accidental
//! configuration could point at `http://169.254.169.254/` (cloud metadata)
//! or private RFC1918 addresses — a classic Server-Side Request Forgery
//! (SSRF) shape.
//!
//! This module validates URLs before they're handed to the HTTP client.
//!
//! ## Policy
//!
//! By default we reject:
//!   - non-`http(s)` schemes
//!   - IP-literal hosts that resolve to link-local / private / multicast /
//!     unspecified / CGNAT / ULA addresses
//!   - hostnames whose *first* DNS resolution is to one of the blocked
//!     ranges (best-effort; not a substitute for per-request re-resolution)
//!
//! Accepts:
//!   - public-IP HTTP(S) URLs
//!   - **loopback addresses** (`127.0.0.0/8`, `::1`, `localhost`): MCP
//!     servers are commonly run locally (CLI helpers, containerised tools,
//!     VS Code / Claude-Desktop-style companions). The SSRF risk on a
//!     single-user desktop app pointing at its own loopback is materially
//!     lower than a web service, so loopback is permitted.
//!
//! ## Known limitations
//!
//! * DNS rebind: we validate at configuration time; the OS / reqwest will
//!   re-resolve at request time. [`check_http_server`] additionally disables
//!   automatic redirects and re-validates manually, so a hostile redirect
//!   cannot escape the policy. Address-change-after-resolve (TOCTOU) is not
//!   mitigated here; that requires an HTTP connector that inspects each
//!   resolved address and is out of scope for wave 1.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use url::Host;

/// Reason a URL was rejected by [`validate_mcp_url`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UrlPolicyError {
    #[error("URL is empty")]
    Empty,
    #[error("URL could not be parsed: {0}")]
    Unparseable(String),
    #[error("Only http and https schemes are permitted (got: {scheme})")]
    BadScheme { scheme: String },
    #[error("URL has no host component")]
    MissingHost,
    #[error("Private / link-local / multicast / unspecified addresses are not permitted: {host}")]
    PrivateOrReserved { host: String },
}

/// Validate a URL supplied by the user for an HTTP-transport MCP server.
///
/// Returns `Ok(())` if the URL is safe to reach, or a [`UrlPolicyError`]
/// describing why it was rejected.
///
/// Performs a single-shot DNS resolution for IP-literal safety checks;
/// the actual HTTP request will re-resolve. This is intentional — we are
/// enforcing *configuration* hygiene, not pinning the address.
pub fn validate_mcp_url(url: &str) -> Result<(), UrlPolicyError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(UrlPolicyError::Empty);
    }

    let parsed =
        url::Url::parse(trimmed).map_err(|e| UrlPolicyError::Unparseable(e.to_string()))?;

    match parsed.scheme() {
        "http" | "https" => {}
        other => {
            return Err(UrlPolicyError::BadScheme {
                scheme: other.to_string(),
            });
        }
    }

    let host_str = parsed.host_str().ok_or(UrlPolicyError::MissingHost)?;

    // Fast path: host is an IP literal — use the already-parsed Host enum
    // from the url crate so we never have to round-trip through a string.
    // NOTE: host_str() for IPv6 literals includes the surrounding brackets
    // (e.g. "[::1]"), so `host_str.parse::<IpAddr>()` would fail. Always use
    // `parsed.host()` to obtain the pre-parsed address.
    match parsed.host().ok_or(UrlPolicyError::MissingHost)? {
        Host::Ipv4(addr) => return classify_ip(IpAddr::V4(addr), host_str),
        Host::Ipv6(addr) => return classify_ip(IpAddr::V6(addr), host_str),
        Host::Domain(_) => {} // fall through to DNS resolution below
    }

    // Hostname — resolve and check the *first* address. DNS rebinding
    // could return a different address at request time; that's covered
    // by operating-system + reqwest-level defences, not this pre-check.
    let port = parsed.port_or_known_default().unwrap_or(0);
    let addrs = (host_str, port).to_socket_addrs().map_err(|e| {
        UrlPolicyError::Unparseable(format!("DNS resolution failed for {host_str}: {e}"))
    })?;

    for addr in addrs {
        classify_ip(addr.ip(), host_str)?;
    }
    Ok(())
}

/// Async variant that offloads the blocking DNS resolution in
/// [`validate_mcp_url`] to a blocking thread so it never stalls the
/// caller's tokio runtime. Prefer this from async contexts (e.g. health
/// probes, request redirect callbacks run off-thread).
pub async fn validate_mcp_url_async(url: &str) -> Result<(), UrlPolicyError> {
    let owned = url.to_string();
    match tokio::task::spawn_blocking(move || validate_mcp_url(&owned)).await {
        Ok(res) => res,
        Err(join_err) => Err(UrlPolicyError::Unparseable(format!(
            "DNS task failed: {join_err}"
        ))),
    }
}

fn classify_ip(ip: IpAddr, host: &str) -> Result<(), UrlPolicyError> {
    // Normalise IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible
    // (`::a.b.c.d`) IPv6 addresses down to IPv4 before classification so
    // an attacker can't bypass the V4 checks by wrapping a private address
    // in a V6 literal (e.g. `http://[::ffff:10.0.0.1]/`).
    let ip = normalise_v6_to_v4(ip);

    // Loopback is permitted — MCP servers are commonly run locally on
    // `127.0.0.1` / `::1` / `localhost`.
    if ip.is_loopback() {
        return Ok(());
    }
    if ip.is_unspecified() || ip.is_multicast() {
        return Err(UrlPolicyError::PrivateOrReserved {
            host: host.to_string(),
        });
    }
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_private() || v4.is_link_local() || v4.is_broadcast() || is_cgnat(v4) {
                return Err(UrlPolicyError::PrivateOrReserved {
                    host: host.to_string(),
                });
            }
            // Block cloud metadata specifically (169.254.169.254) — caught
            // by is_link_local but called out for clarity.
        }
        IpAddr::V6(v6) => {
            if is_v6_ula(v6) || is_v6_link_local(v6) {
                return Err(UrlPolicyError::PrivateOrReserved {
                    host: host.to_string(),
                });
            }
        }
    }
    Ok(())
}

/// Convert IPv4-mapped / IPv4-compatible IPv6 addresses to their IPv4 form.
///
/// IPv6 maps IPv4 addresses into two overlapping ranges:
///   * `::ffff:0:0/96` — IPv4-mapped (RFC 4291 §2.5.5.2)
///   * `::/96`         — IPv4-compatible (deprecated but still routable)
///
/// Without this normalisation, an IPv6 literal like `[::ffff:127.0.0.1]`
/// would skip the V4 classifier entirely and slip past the SSRF policy.
fn normalise_v6_to_v4(ip: IpAddr) -> IpAddr {
    let IpAddr::V6(v6) = ip else {
        return ip;
    };
    if let Some(v4) = v6.to_ipv4_mapped() {
        return IpAddr::V4(v4);
    }
    // IPv4-compatible: high 96 bits are zero and the address is not `::` /
    // `::1` / a V6 loopback (which have special low-bit handling elsewhere).
    let seg = v6.segments();
    if seg[0..6].iter().all(|s| *s == 0) && (seg[6] != 0 || seg[7] > 1) {
        let [a, b] = seg[6].to_be_bytes();
        let [c, d] = seg[7].to_be_bytes();
        return IpAddr::V4(Ipv4Addr::new(a, b, c, d));
    }
    ip
}

/// RFC 6598 Carrier-grade NAT range `100.64.0.0/10`.
fn is_cgnat(v4: Ipv4Addr) -> bool {
    let o = v4.octets();
    o[0] == 100 && (o[1] & 0b1100_0000) == 64
}

/// RFC 4193 Unique Local Addresses `fc00::/7`.
fn is_v6_ula(v6: Ipv6Addr) -> bool {
    (v6.segments()[0] & 0xfe00) == 0xfc00
}

/// IPv6 link-local `fe80::/10`.
fn is_v6_link_local(v6: Ipv6Addr) -> bool {
    (v6.segments()[0] & 0xffc0) == 0xfe80
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_url() {
        assert_eq!(validate_mcp_url(""), Err(UrlPolicyError::Empty));
        assert_eq!(validate_mcp_url("   "), Err(UrlPolicyError::Empty));
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert!(matches!(
            validate_mcp_url("file:///etc/passwd"),
            Err(UrlPolicyError::BadScheme { .. })
        ));
        assert!(matches!(
            validate_mcp_url("ftp://example.com/"),
            Err(UrlPolicyError::BadScheme { .. })
        ));
        assert!(matches!(
            validate_mcp_url("javascript:alert(1)"),
            Err(UrlPolicyError::BadScheme { .. })
        ));
    }

    #[test]
    fn accepts_loopback() {
        // Loopback is permitted — common MCP deployment shape.
        assert!(validate_mcp_url("http://127.0.0.1:8080/").is_ok());
        assert!(validate_mcp_url("http://[::1]:8080/").is_ok());
        assert!(validate_mcp_url("http://localhost:8080/").is_ok());
    }

    #[test]
    fn rejects_rfc1918() {
        assert!(matches!(
            validate_mcp_url("http://10.0.0.1/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
        assert!(matches!(
            validate_mcp_url("http://192.168.0.1/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
        assert!(matches!(
            validate_mcp_url("http://172.16.5.5/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
    }

    #[test]
    fn rejects_cloud_metadata() {
        // 169.254.0.0/16 is link-local; metadata lives at 169.254.169.254.
        assert!(matches!(
            validate_mcp_url("http://169.254.169.254/latest/meta-data/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
    }

    #[test]
    fn rejects_cgnat() {
        assert!(matches!(
            validate_mcp_url("http://100.64.1.1/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
    }

    #[test]
    fn accepts_public_literal_ip() {
        assert!(validate_mcp_url("https://1.1.1.1/").is_ok());
        assert!(validate_mcp_url("https://8.8.8.8/health").is_ok());
    }

    #[test]
    fn rejects_v6_ula_and_link_local() {
        assert!(matches!(
            validate_mcp_url("http://[fd00::1]/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
        assert!(matches!(
            validate_mcp_url("http://[fe80::1]/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
    }

    #[test]
    fn accepts_ipv4_mapped_ipv6_loopback() {
        // IPv4-mapped loopback normalises to 127.0.0.1, which is allowed.
        assert!(validate_mcp_url("http://[::ffff:127.0.0.1]/").is_ok());
    }

    #[test]
    fn rejects_ipv4_mapped_ipv6_private() {
        assert!(matches!(
            validate_mcp_url("http://[::ffff:10.0.0.1]/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
        assert!(matches!(
            validate_mcp_url("http://[::ffff:192.168.1.1]/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
    }

    #[test]
    fn rejects_ipv4_mapped_ipv6_cloud_metadata() {
        assert!(matches!(
            validate_mcp_url("http://[::ffff:169.254.169.254]/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
    }

    #[test]
    fn rejects_ipv4_compat_ipv6_private() {
        // `::a.b.c.d` IPv4-compatible form (deprecated but parseable)
        assert!(matches!(
            validate_mcp_url("http://[::10.0.0.1]/"),
            Err(UrlPolicyError::PrivateOrReserved { .. })
        ));
    }
}
