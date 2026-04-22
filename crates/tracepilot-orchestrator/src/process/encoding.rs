//! Command-line / prompt encoding helpers consumed by hidden-command
//! call sites: MSVCRT-style Windows argv quoting, PowerShell base64
//! (`-EncodedCommand`) encoding, and POSIX/AppleScript base64 prompt
//! encoding.

// ─── PowerShell encoding (Windows) ──────────────────────────────────

/// Encode a PowerShell command string as Base64 UTF-16LE for use with
/// `-EncodedCommand`. This bypasses all command-line escaping issues.
#[cfg(windows)]
pub fn encode_powershell_command(cmd: &str) -> String {
    use std::io::Write;
    let utf16: Vec<u8> = cmd.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
    let mut buf = Vec::new();
    {
        let mut encoder = Base64Encoder::new(&mut buf);
        encoder
            .write_all(&utf16)
            .expect("base64 write to Vec<u8> is infallible");
        encoder
            .finish()
            .expect("base64 finish to Vec<u8> is infallible");
    }
    // Safety: base64 output is always valid ASCII (subset of UTF-8)
    String::from_utf8(buf).expect("base64 output is always valid ASCII")
}

/// Minimal base64 encoder (no external dependency needed).
#[cfg(windows)]
struct Base64Encoder<W: std::io::Write> {
    writer: W,
    buf: [u8; 3],
    len: usize,
}

#[cfg(windows)]
impl<W: std::io::Write> Base64Encoder<W> {
    fn new(writer: W) -> Self {
        Self {
            writer,
            buf: [0; 3],
            len: 0,
        }
    }

    fn finish(mut self) -> std::io::Result<()> {
        if self.len > 0 {
            self.encode_block()?;
        }
        Ok(())
    }

    fn encode_block(&mut self) -> std::io::Result<()> {
        const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let b = &self.buf;
        let out = match self.len {
            3 => [
                CHARS[(b[0] >> 2) as usize],
                CHARS[((b[0] & 0x03) << 4 | b[1] >> 4) as usize],
                CHARS[((b[1] & 0x0f) << 2 | b[2] >> 6) as usize],
                CHARS[(b[2] & 0x3f) as usize],
            ],
            2 => [
                CHARS[(b[0] >> 2) as usize],
                CHARS[((b[0] & 0x03) << 4 | b[1] >> 4) as usize],
                CHARS[((b[1] & 0x0f) << 2) as usize],
                b'=',
            ],
            1 => [
                CHARS[(b[0] >> 2) as usize],
                CHARS[((b[0] & 0x03) << 4) as usize],
                b'=',
                b'=',
            ],
            _ => return Ok(()),
        };
        self.writer.write_all(&out)?;
        self.len = 0;
        self.buf = [0; 3];
        Ok(())
    }
}

#[cfg(windows)]
impl<W: std::io::Write> std::io::Write for Base64Encoder<W> {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        let mut written = 0;
        for &byte in data {
            self.buf[self.len] = byte;
            self.len += 1;
            if self.len == 3 {
                self.encode_block()?;
            }
            written += 1;
        }
        Ok(written)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.writer.flush()
    }
}

// ─── Windows Win32 argument quoting ─────────────────────────────────

/// Quote a string as a single Win32 command-line argument (MSVCRT rules).
/// Backslashes before `"` or at end-of-string are doubled; `"` is escaped as `\"`;
/// newlines are collapsed to a space. Used with PS's `--% ` stop-parsing token.
#[cfg(windows)]
pub(crate) fn win32_quote_arg(s: &str) -> String {
    let s = s.replace(['\r', '\n'], " ");
    let mut out = String::from('"');
    let mut bs: u32 = 0;
    for c in s.chars() {
        match c {
            '\\' => bs += 1,
            '"' => {
                (0..bs * 2).for_each(|_| out.push('\\'));
                out.push_str("\\\"");
                bs = 0;
            }
            c => {
                (0..bs).for_each(|_| out.push('\\'));
                out.push(c);
                bs = 0;
            }
        }
    }
    (0..bs * 2).for_each(|_| out.push('\\')); // double trailing backslashes
    out.push('"');
    out
}

// ─── Base64 prompt encoding (macOS / Linux) ──────────────────────────

/// Base64-encode a prompt (UTF-8). Output is `[A-Za-z0-9+/=]` — safe inside
/// POSIX single-quoted strings and AppleScript double-quoted strings with no
/// further escaping. Decoded at runtime via `$(echo '...' | base64 -d)`.
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) fn encode_prompt_utf8_base64(s: &str) -> String {
    const C: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = Vec::with_capacity(4 * ((s.len() + 2) / 3));
    for c in s.as_bytes().chunks(3) {
        let (b0, b1, b2) = (
            c[0],
            c.get(1).copied().unwrap_or(0),
            c.get(2).copied().unwrap_or(0),
        );
        o.extend_from_slice(&[
            C[(b0 >> 2) as usize],
            C[((b0 & 3) << 4 | b1 >> 4) as usize],
            if c.len() > 1 {
                C[((b1 & 0xf) << 2 | b2 >> 6) as usize]
            } else {
                b'='
            },
            if c.len() > 2 {
                C[(b2 & 0x3f) as usize]
            } else {
                b'='
            },
        ]);
    }
    String::from_utf8(o).expect("base64 is ASCII")
}
