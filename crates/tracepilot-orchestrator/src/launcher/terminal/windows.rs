//! Windows-specific terminal spawn (PowerShell + branch-checkout template).

use std::path::Path;

use crate::error::Result;

use super::SessionPlan;

/// PowerShell snippet executed before `copilot` to checkout (or create) the
/// requested branch. Placeholders are substituted by [`format_checkout_script`]:
///
///   - `{{DETECT_DEFAULT}}` — either empty or a PS line that assigns
///     `$defaultBranch` from `origin/HEAD`.
///   - `{{BRANCH}}` — branch name, already single-quote-escaped.
///   - `{{BASE_BRANCH}}` — quoted base branch literal or `$defaultBranch`.
const POWERSHELL_CHECKOUT_TEMPLATE: &str = concat!(
    // 1. Check for uncommitted changes
    "$dirty = (git status --porcelain 2>$null); ",
    "if ($dirty) { ",
    "  Write-Host 'Warning: You have uncommitted changes. Branch checkout may fail or carry changes over.' -ForegroundColor Yellow; ",
    "  Write-Host '' ",
    "}; ",
    // 2. Detect default branch if needed
    "{{DETECT_DEFAULT}}",
    // 3. Try checkout existing branch (suppress stderr red noise from git)
    "Write-Host 'Checking out branch...' -ForegroundColor Yellow; ",
    "$output = $(git checkout '{{BRANCH}}' 2>&1); ",
    "if ($LASTEXITCODE -ne 0) { ",
    // 4. Branch doesn't exist, create from default branch
    "  Write-Host \"Branch not found, creating from {{BASE_BRANCH}}...\" -ForegroundColor Yellow; ",
    "  $output = $(git checkout -b '{{BRANCH}}' {{BASE_BRANCH}} 2>&1); ",
    "  if ($LASTEXITCODE -ne 0) { ",
    "    Write-Host \"Failed to create branch (exit code $LASTEXITCODE). Continuing on current branch.\" -ForegroundColor Red; ",
    "    Write-Host $output -ForegroundColor Red ",
    "  } else { ",
    "    Write-Host 'New branch created and checked out.' -ForegroundColor Green ",
    "  } ",
    "} else { ",
    "  Write-Host 'Branch checked out.' -ForegroundColor Green ",
    "}; Write-Host ''; ",
);

/// Render the PowerShell checkout snippet for `branch` against an optional
/// explicit `base_branch`. When `base_branch` is `None`, the script detects
/// the remote default branch at runtime.
pub(super) fn format_checkout_script(branch: &str, base_branch: Option<&str>) -> String {
    let branch_escaped = branch.replace('\'', "''");
    let (detect_default, base_branch_expr) = match base_branch {
        Some(bb) => (
            "".to_string(),
            format!("'{}'", bb.replace('\'', "''")),
        ),
        None => (
            "$defaultBranch = (git symbolic-ref refs/remotes/origin/HEAD --short 2>$null); if (-not $defaultBranch) { $defaultBranch = 'origin/main' }; ".to_string(),
            "$defaultBranch".to_string(),
        ),
    };
    POWERSHELL_CHECKOUT_TEMPLATE
        .replace("{{DETECT_DEFAULT}}", &detect_default)
        .replace("{{BRANCH}}", &branch_escaped)
        .replace("{{BASE_BRANCH}}", &base_branch_expr)
}

/// Spawn the Copilot session in a detached PowerShell window.
pub(super) fn spawn(plan: &SessionPlan<'_>) -> Result<u32> {
    let SessionPlan {
        config,
        work_dir,
        copilot_cmd,
    } = plan;

    let escaped_dir = work_dir.display().to_string().replace('\'', "''");

    // Optional branch checkout step (only when not creating a worktree —
    // worktrees are created on the target branch already).
    let checkout_step = if !config.create_worktree {
        if let Some(branch) = config.branch.as_deref() {
            format_checkout_script(branch, config.base_branch.as_deref())
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Validate env var names and inject into the PowerShell script so they
    // survive WMI spawning.
    let envs = &config.env_vars;
    for k in envs.keys() {
        crate::process::validate_env_var_name(k)?;
    }
    let env_setup: String = envs
        .iter()
        .map(|(k, v)| format!("$env:{} = '{}'; ", k, v.replace('\'', "''")))
        .collect();

    // `--% ` stops PS argument processing; win32_quote_arg applies MSVCRT rules
    // so CommandLineToArgvW reconstructs the exact original prompt.
    let interactive_suffix = config
        .prompt
        .as_deref()
        .map(|p| format!(" --% --interactive {}", crate::process::win32_quote_arg(p)))
        .unwrap_or_default();
    let ps_cmd = format!(
        "{env_setup}$host.UI.RawUI.WindowTitle = 'Copilot Session'; Set-Location -LiteralPath '{}'; Write-Host 'Starting Copilot session in:' -ForegroundColor Cyan; Write-Host '  {}' -ForegroundColor White; Write-Host ''; {}{}{}",
        escaped_dir, escaped_dir, checkout_step, copilot_cmd, interactive_suffix
    );

    // Use -EncodedCommand (Base64 UTF-16LE) to avoid all escaping issues
    let encoded = crate::process::encode_powershell_command(&ps_cmd);
    spawn_detached(
        "powershell",
        &["-NoExit", "-EncodedCommand", &encoded],
        work_dir,
    )
}

fn spawn_detached(program: &str, args: &[&str], cwd: &Path) -> Result<u32> {
    crate::process::spawn_detached_terminal(program, args, cwd, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkout_script_contains_branch_and_explicit_base() {
        let out = format_checkout_script("feature/x", Some("main"));
        assert!(out.contains("git checkout 'feature/x'"), "rendered:\n{out}");
        assert!(out.contains("git checkout -b 'feature/x' 'main'"));
        // Explicit base branch path should not include the symbolic-ref
        // detection logic.
        assert!(!out.contains("symbolic-ref"));
    }

    #[test]
    fn checkout_script_detects_default_when_base_missing() {
        let out = format_checkout_script("topic", None);
        assert!(out.contains("git checkout 'topic'"));
        assert!(out.contains("symbolic-ref refs/remotes/origin/HEAD"));
        assert!(out.contains("git checkout -b 'topic' $defaultBranch"));
    }

    #[test]
    fn checkout_script_escapes_single_quotes_in_branch() {
        let out = format_checkout_script("weird'name", Some("base'x"));
        // Single quotes are PowerShell-escaped by doubling.
        assert!(out.contains("git checkout 'weird''name'"));
        assert!(out.contains("'base''x'"));
    }
}
