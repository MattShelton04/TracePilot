//! Auto-discovery of running `copilot --ui-server` instances.
//!
//! When the user runs `copilot --ui-server` in a terminal, it starts a background
//! TCP JSON-RPC server on a random port. This module detects those processes and
//! extracts their listening ports so TracePilot can connect automatically.

use serde::Serialize;

/// A detected `copilot --ui-server` process with its listening address.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedUiServer {
    pub pid: u32,
    pub port: u16,
    pub address: String,
}

/// Discover running `copilot --ui-server` instances.
///
/// Uses platform-specific process inspection to find copilot processes with
/// `--ui-server` in their command line, then resolves their listening TCP ports.
pub async fn detect_ui_servers() -> Vec<DetectedUiServer> {
    #[cfg(target_os = "windows")]
    {
        detect_windows().await
    }
    #[cfg(target_os = "macos")]
    {
        detect_unix("lsof").await
    }
    #[cfg(target_os = "linux")]
    {
        detect_linux().await
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        vec![]
    }
}

/// Windows: Use PowerShell Get-CimInstance + Get-NetTCPConnection
#[cfg(target_os = "windows")]
async fn detect_windows() -> Vec<DetectedUiServer> {
    use tokio::process::Command;

    // PowerShell one-liner that finds copilot processes with --ui-server or --server
    // in their command line, then resolves their listening TCP ports.
    let script = r#"
$results = @()
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match 'copilot' -and $_.CommandLine -match '(ui-server|--server)'
} | ForEach-Object {
    $proc = $_
    Get-NetTCPConnection -OwningProcess $proc.ProcessId -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        $results += [PSCustomObject]@{
            pid = $proc.ProcessId
            port = $_.LocalPort
            cmd = $proc.CommandLine
        }
    }
}
$results | ConvertTo-Json -Compress
"#;

    let output = match Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(crate::process::CREATE_NO_WINDOW)
        .output()
        .await
    {
        Ok(o) => o,
        Err(e) => {
            tracing::debug!("Failed to run PowerShell for UI server detection: {}", e);
            return vec![];
        }
    };

    if !output.status.success() {
        tracing::debug!(
            "PowerShell detection exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        return vec![];
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return vec![];
    }

    parse_powershell_output(trimmed)
}

#[cfg(target_os = "windows")]
fn parse_powershell_output(json: &str) -> Vec<DetectedUiServer> {
    // PowerShell ConvertTo-Json returns a single object (not array) when there's only one result.
    // Handle both cases.
    #[derive(serde::Deserialize)]
    struct PsResult {
        pid: u32,
        port: u16,
        #[allow(dead_code)]
        cmd: Option<String>,
    }

    // Try parsing as array first, then as single object
    let entries: Vec<PsResult> = if let Ok(arr) = serde_json::from_str::<Vec<PsResult>>(json) {
        arr
    } else if let Ok(single) = serde_json::from_str::<PsResult>(json) {
        vec![single]
    } else {
        tracing::debug!("Failed to parse PowerShell detection output: {}", json);
        return vec![];
    };

    // Deduplicate by PID (a process may listen on multiple ports; prefer the first)
    let mut seen_pids = std::collections::HashSet::new();
    entries
        .into_iter()
        .filter(|e| seen_pids.insert(e.pid))
        .map(|e| DetectedUiServer {
            pid: e.pid,
            port: e.port,
            address: format!("127.0.0.1:{}", e.port),
        })
        .collect()
}

/// macOS: Use `ps` + `lsof` to find processes and their listening ports.
#[cfg(target_os = "macos")]
async fn detect_unix(_tool: &str) -> Vec<DetectedUiServer> {
    use tokio::process::Command;

    // Step 1: Find copilot processes with ui-server or --server in args
    let ps_output = match Command::new("ps")
        .args(["ax", "-o", "pid,command"])
        .output()
        .await
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let ps_text = String::from_utf8_lossy(&ps_output.stdout);
    let pids: Vec<u32> = ps_text
        .lines()
        .filter(|line| {
            (line.contains("copilot") || line.contains("Copilot"))
                && (line.contains("ui-server") || line.contains("--server"))
                && !line.contains("grep")
        })
        .filter_map(|line| line.trim().split_whitespace().next()?.parse().ok())
        .collect();

    if pids.is_empty() {
        return vec![];
    }

    // Step 2: For each PID, use lsof to find listening TCP ports
    let mut results = vec![];
    for pid in pids {
        let lsof_output = match Command::new("lsof")
            .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", &pid.to_string()])
            .output()
            .await
        {
            Ok(o) => o,
            Err(_) => continue,
        };

        let lsof_text = String::from_utf8_lossy(&lsof_output.stdout);
        for line in lsof_text.lines().skip(1) {
            // lsof output: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
            // NAME looks like: *:12345 or 127.0.0.1:12345
            if let Some(name) = line.split_whitespace().last() {
                if let Some(port_str) = name.rsplit(':').next() {
                    if let Ok(port) = port_str.parse::<u16>() {
                        results.push(DetectedUiServer {
                            pid,
                            port,
                            address: format!("127.0.0.1:{}", port),
                        });
                        break; // One port per PID is enough
                    }
                }
            }
        }
    }

    results
}

/// Linux: Use /proc filesystem + `ss` for port discovery.
#[cfg(target_os = "linux")]
async fn detect_linux() -> Vec<DetectedUiServer> {
    use tokio::process::Command;

    // Step 1: Find copilot processes via ps
    let ps_output = match Command::new("ps")
        .args(["ax", "-o", "pid,command"])
        .output()
        .await
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let ps_text = String::from_utf8_lossy(&ps_output.stdout);
    let pids: Vec<u32> = ps_text
        .lines()
        .filter(|line| {
            (line.contains("copilot") || line.contains("Copilot"))
                && (line.contains("ui-server") || line.contains("--server"))
                && !line.contains("grep")
        })
        .filter_map(|line| line.trim().split_whitespace().next()?.parse().ok())
        .collect();

    if pids.is_empty() {
        return vec![];
    }

    // Step 2: Use ss to find listening ports per PID
    let mut results = vec![];
    for pid in pids {
        let ss_output = match Command::new("ss")
            .args(["-tlnp", "--no-header"])
            .output()
            .await
        {
            Ok(o) => o,
            Err(_) => continue,
        };

        let ss_text = String::from_utf8_lossy(&ss_output.stdout);
        let pid_pattern = format!("pid={}", pid);
        for line in ss_text.lines() {
            if line.contains(&pid_pattern) {
                // ss output: State Recv-Q Send-Q Local_Address:Port Peer_Address:Port Process
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    if let Some(port_str) = parts[3].rsplit(':').next() {
                        if let Ok(port) = port_str.parse::<u16>() {
                            results.push(DetectedUiServer {
                                pid,
                                port,
                                address: format!("127.0.0.1:{}", port),
                            });
                            break;
                        }
                    }
                }
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detected_server_serializes() {
        let server = DetectedUiServer {
            pid: 12345,
            port: 60381,
            address: "127.0.0.1:60381".to_string(),
        };
        let json = serde_json::to_string(&server).unwrap();
        assert!(json.contains("12345"));
        assert!(json.contains("60381"));
        assert!(json.contains("127.0.0.1:60381"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parse_single_result() {
        let json = r#"{"pid":15308,"port":60381,"cmd":"copilot.exe --ui-server"}"#;
        let results = parse_powershell_output(json);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].pid, 15308);
        assert_eq!(results[0].port, 60381);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parse_array_result() {
        let json = r#"[{"pid":15308,"port":60381,"cmd":"copilot.exe --ui-server"},{"pid":20000,"port":3333,"cmd":"copilot.exe --server --port 3333"}]"#;
        let results = parse_powershell_output(json);
        assert_eq!(results.len(), 2);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parse_empty() {
        assert!(parse_powershell_output("").is_empty());
        assert!(parse_powershell_output("null").is_empty());
    }
}
