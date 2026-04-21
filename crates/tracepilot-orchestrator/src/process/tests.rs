use super::*;
use super::timeout::execute_with_timeout;
use std::process::Command;

#[cfg(unix)]
#[test]
fn test_is_alive_self_pid() {
    assert!(is_alive(std::process::id()));
}

#[test]
fn test_run_hidden_captures_stdout() {
    // git --version should always succeed on dev machines
    let output = run_hidden("git", &["--version"], None, None).unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("git version"));
}

#[test]
fn test_run_hidden_with_cwd() {
    // Run in a specific directory
    let temp = std::env::temp_dir();
    let output = run_hidden("git", &["--version"], Some(&temp), None).unwrap();
    assert!(output.status.success());
}

#[test]
fn test_run_hidden_nonexistent_command() {
    let result = run_hidden("this_command_does_not_exist_xyz", &[], None, None);
    assert!(result.is_err());
}

#[test]
fn test_run_hidden_stdout_success() {
    let version = run_hidden_stdout("git", &["--version"], None, None).unwrap();
    assert!(version.contains("git version"));
}

#[test]
fn test_run_hidden_stdout_failure() {
    // git with an invalid subcommand should return non-zero
    let result = run_hidden_stdout("git", &["this-is-not-a-valid-subcommand"], None, None);
    assert!(result.is_err());
}

#[test]
fn test_run_hidden_with_timeout_success() {
    // Fast command should complete within timeout
    let output = run_hidden("git", &["--version"], None, Some(5)).unwrap();
    assert!(output.status.success());
}

#[test]
fn test_run_hidden_timeout_triggers() {
    // Use a command that will definitely timeout (sleep for 10s with 1s timeout)
    #[cfg(not(windows))]
    let result = run_hidden("sleep", &["10"], None, Some(1));

    #[cfg(windows)]
    #[allow(deprecated)] // test-only; exercises the deprecated API's timeout path
    let result = run_hidden_shell("Start-Sleep -Seconds 10", None, Some(1));

    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(err_msg.contains("timed out") || err_msg.contains("Command timed out"));
}

#[test]
fn test_run_hidden_stdout_with_timeout() {
    // Fast command should work with timeout
    let version = run_hidden_stdout("git", &["--version"], None, Some(5)).unwrap();
    assert!(version.contains("git version"));
}

#[test]
fn test_timeout_with_command_failure() {
    // Command that fails quickly (before timeout) - using run_hidden_stdout which checks status
    let result = run_hidden_stdout("git", &["not-a-valid-subcommand"], None, Some(10));
    assert!(result.is_err());

    // Should NOT be a timeout error
    let err_msg = result.unwrap_err().to_string();
    assert!(
        !err_msg.contains("timed out"),
        "Should not report timeout for quick failure"
    );
    assert!(err_msg.contains("failed"), "Should report command failure");
}

#[test]
fn test_timeout_with_spawn_failure() {
    // Command that doesn't exist should fail during spawn, not timeout
    let result = run_hidden("command_that_does_not_exist_xyz123", &[], None, Some(5));
    assert!(result.is_err());

    let err_msg = result.unwrap_err().to_string();
    // Should be spawn error, not timeout
    assert!(err_msg.contains("Failed to spawn"));
    assert!(!err_msg.contains("timed out"));
}

#[test]
fn test_very_short_timeout() {
    // 1 second timeout should be enough for git --version
    let result = run_hidden("git", &["--version"], None, Some(1));
    assert!(
        result.is_ok(),
        "Fast command should complete within 1s timeout"
    );
}

#[test]
fn test_timeout_error_message_format() {
    #[cfg(not(windows))]
    let result = run_hidden("sleep", &["5"], None, Some(1));

    #[cfg(windows)]
    #[allow(deprecated)] // test-only; exercises the deprecated API's timeout path
    let result = run_hidden_shell("Start-Sleep -Seconds 5", None, Some(1));

    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();

    // Verify error message contains key information
    assert!(
        err_msg.contains("timed out"),
        "Error should mention timeout"
    );
    assert!(
        err_msg.contains("1s"),
        "Error should mention timeout duration"
    );
    assert!(
        err_msg.contains("Check system resources"),
        "Error should be actionable"
    );
}

#[cfg(windows)]
#[test]
fn test_run_hidden_via_cmd_resolves_aliases() {
    // `where` is a cmd-builtin — direct CreateProcess can't find it, but
    // cmd.exe /c can. This exercises the alias/PATHEXT fallback path.
    let out = run_hidden_via_cmd("where", &["cmd"], None, Some(5));
    assert!(
        out.is_ok(),
        "run_hidden_via_cmd should resolve cmd builtins"
    );
    let out = out.unwrap();
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.to_lowercase().contains("cmd.exe"),
        "expected cmd path in stdout, got: {stdout}"
    );
}

#[cfg(not(windows))]
#[test]
fn test_run_hidden_via_cmd_errors_on_posix() {
    let result = run_hidden_via_cmd("true", &[], None, None);
    assert!(result.is_err());
}

#[test]
fn test_find_executable_missing_returns_none() {
    // A name that almost certainly isn't on PATH on any platform.
    let result = find_executable("tracepilot-definitely-does-not-exist-xyz");
    assert!(result.is_none(), "expected None for missing executable");
}

#[cfg(windows)]
#[test]
fn test_find_executable_locates_cmd() {
    // `cmd.exe` is always on PATH on Windows.
    let result = find_executable("cmd");
    let path = result.expect("expected to locate cmd on PATH");
    let display = path.to_string_lossy().to_lowercase();
    assert!(
        display.ends_with("cmd.exe") || display.ends_with("cmd"),
        "expected cmd path, got {}",
        path.display()
    );
}

#[cfg(not(windows))]
#[test]
fn test_find_executable_locates_sh() {
    // `sh` is universally present on POSIX systems.
    let result = find_executable("sh");
    let path = result.expect("expected to locate sh on PATH");
    assert!(
        path.is_absolute() || path.exists(),
        "expected absolute or existing path for sh, got {}",
        path.display()
    );
}

#[cfg(windows)]
#[test]
fn test_encode_powershell_command() {
    let cmd = "Write-Host 'hi'";
    let encoded = encode_powershell_command(cmd);
    // Verify it's valid base64 and decodes back to correct UTF-16LE
    let bytes = (0..encoded.len())
        .step_by(4)
        .flat_map(|i| {
            let chunk = &encoded[i..std::cmp::min(i + 4, encoded.len())];
            let vals: Vec<u8> = chunk
                .bytes()
                .map(|b| match b {
                    b'A'..=b'Z' => b - b'A',
                    b'a'..=b'z' => b - b'a' + 26,
                    b'0'..=b'9' => b - b'0' + 52,
                    b'+' => 62,
                    b'/' => 63,
                    b'=' => 0,
                    _ => panic!("invalid base64"),
                })
                .collect();
            let mut out = Vec::new();
            if vals.len() >= 2 {
                out.push((vals[0] << 2) | (vals[1] >> 4));
            }
            if vals.len() >= 3 && chunk.as_bytes().get(2) != Some(&b'=') {
                out.push(((vals[1] & 0x0f) << 4) | (vals[2] >> 2));
            }
            if vals.len() >= 4 && chunk.as_bytes().get(3) != Some(&b'=') {
                out.push(((vals[2] & 0x03) << 6) | vals[3]);
            }
            out
        })
        .collect::<Vec<u8>>();
    // Decode UTF-16LE back to string
    let decoded: String = bytes
        .chunks(2)
        .filter_map(|pair| {
            if pair.len() == 2 {
                Some(u16::from_le_bytes([pair[0], pair[1]]))
            } else {
                None
            }
        })
        .map(|c| char::from_u32(c as u32).unwrap_or('?'))
        .collect();
    assert_eq!(decoded, cmd);
}

#[cfg(windows)]
#[test]
fn test_win32_quote_arg_plain() {
    assert_eq!(win32_quote_arg("hello"), "\"hello\"");
}

#[cfg(windows)]
#[test]
fn test_win32_quote_arg_with_spaces() {
    assert_eq!(win32_quote_arg("hello world"), "\"hello world\"");
}

#[cfg(windows)]
#[test]
fn test_win32_quote_arg_double_quotes() {
    // He said "hi" → "He said \"hi\""
    assert_eq!(win32_quote_arg(r#"He said "hi""#), r#""He said \"hi\"""#);
}

#[cfg(windows)]
#[test]
fn test_win32_quote_arg_backslash_before_quote() {
    // a\"b → "a\\\"b"  (backslash before quote: double the backslash, escape the quote)
    assert_eq!(win32_quote_arg(r#"a\"b"#), r#""a\\\"b""#);
}

#[cfg(windows)]
#[test]
fn test_win32_quote_arg_trailing_backslash() {
    // "hello\" → "hello\\"  (trailing backslash doubled before closing quote)
    assert_eq!(win32_quote_arg("hello\\"), "\"hello\\\\\"");
}

#[cfg(windows)]
#[test]
fn test_win32_quote_arg_newlines_collapsed() {
    assert_eq!(win32_quote_arg("line1\nline2"), "\"line1 line2\"");
    assert_eq!(win32_quote_arg("line1\r\nline2"), "\"line1  line2\"");
}

#[cfg(windows)]
#[test]
fn test_win32_quote_arg_single_quotes() {
    // Single quotes need no escaping in Win32 args
    assert_eq!(win32_quote_arg("it's fine"), "\"it's fine\"");
}

#[test]
fn test_shell_quote_plain() {
    let quoted = shell_quote("hello");
    #[cfg(windows)]
    assert_eq!(quoted, "\"hello\"");
    #[cfg(not(windows))]
    assert_eq!(quoted, "'hello'");
}

#[test]
fn test_shell_quote_with_spaces() {
    let quoted = shell_quote("hello world");
    #[cfg(windows)]
    assert_eq!(quoted, "\"hello world\"");
    #[cfg(not(windows))]
    assert_eq!(quoted, "'hello world'");
}

#[test]
fn test_validate_env_var_name_valid() {
    assert!(validate_env_var_name("PATH").is_ok());
    assert!(validate_env_var_name("MY_VAR").is_ok());
    assert!(validate_env_var_name("_private").is_ok());
    assert!(validate_env_var_name("VAR123").is_ok());
}

#[test]
fn test_validate_env_var_name_invalid() {
    assert!(validate_env_var_name("").is_err());
    assert!(validate_env_var_name("FOO;rm -rf").is_err());
    assert!(validate_env_var_name("1BAD").is_err());
    assert!(validate_env_var_name("HAS SPACE").is_err());
    assert!(validate_env_var_name("A=B").is_err());
}

#[test]
fn test_execute_with_timeout_missing_stdout_pipe() {
    // Spawn a process without piping stdout to verify error handling
    let child = Command::new("git")
        .arg("--version")
        .stderr(std::process::Stdio::piped())
        // stdout is NOT piped - should trigger our error
        .spawn()
        .expect("failed to spawn test process");

    let result = execute_with_timeout(child, 5);
    assert!(result.is_err());
    let err = result.unwrap_err();
    let err_msg = err.to_string();
    assert!(
        err_msg.contains("stdout not piped") || err_msg.contains("not configured correctly"),
        "Expected stdout pipe error, got: {}",
        err_msg
    );
}

#[test]
fn test_execute_with_timeout_missing_stderr_pipe() {
    // Spawn a process without piping stderr to verify error handling
    let child = Command::new("git")
        .arg("--version")
        .stdout(std::process::Stdio::piped())
        // stderr is NOT piped - should trigger our error
        .spawn()
        .expect("failed to spawn test process");

    let result = execute_with_timeout(child, 5);
    assert!(result.is_err());
    let err = result.unwrap_err();
    let err_msg = err.to_string();
    assert!(
        err_msg.contains("stderr not piped") || err_msg.contains("not configured correctly"),
        "Expected stderr pipe error, got: {}",
        err_msg
    );
}

#[test]
fn test_execute_with_timeout_missing_both_pipes() {
    // Spawn a process without piping either stdout or stderr
    let child = Command::new("git")
        .arg("--version")
        // Neither stdout nor stderr are piped
        .spawn()
        .expect("failed to spawn test process");

    let result = execute_with_timeout(child, 5);
    assert!(result.is_err());
    // Should error on the first pipe (stdout) that's checked
    let err = result.unwrap_err();
    let err_msg = err.to_string();
    assert!(
        err_msg.contains("stdout not piped") || err_msg.contains("not configured correctly"),
        "Expected stdout pipe error, got: {}",
        err_msg
    );
}
