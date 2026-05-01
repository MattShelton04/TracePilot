## 2025-02-21 - [Critical] Detached Terminal Command Injection
**Vulnerability:** The detached terminal spawn functions (`spawn_terminal_macos` and `spawn_terminal_linux` in `terminal.rs`) passed unescaped `program` and `args` to `osascript -e` and Linux terminal `-e` respectively. Arbitrary command injection was possible if spawned with attacker-controlled arguments.
**Learning:** Even internal helper methods intended to open standard terminals are dangerous vectors if they interpolate strings rather than securely passing raw command arguments.
**Prevention:** Always use proper quoting logic like `shell_quote()` when a shell string context (like `-e`) is unavoidable to wrap command arguments safely before execution.
