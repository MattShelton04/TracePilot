/// Scrub likely-sensitive substrings from an error message before it
/// crosses the IPC boundary to the frontend (where it may be logged,
/// screenshotted, or sent to telemetry).
///
/// Intentionally non-destructive: the goal is to remove obvious leaks
/// (OS usernames, bearer tokens) without mangling the message shape so
/// that error codes + overall phrasing remain useful for debugging.
///
/// See the info-leak audit table in the `Serialize` impl.
pub(crate) fn scrub_message(raw: &str) -> String {
    // Redact Windows usernames in path segments: `C:\Users\alice\...` →
    // `C:\Users\<user>\...`. Use a simple state machine rather than a
    // regex to avoid pulling in `regex` just for this.
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;

    loop {
        // Windows: look for "\Users\" or "/Users/" (the latter is how
        // some error sources normalise separators).
        let win_hit = rest.find("\\Users\\").map(|i| (i, "\\Users\\"));
        let mac_hit = rest.find("/Users/").map(|i| (i, "/Users/"));
        let nix_hit = rest.find("/home/").map(|i| (i, "/home/"));

        let hit = [win_hit, mac_hit, nix_hit]
            .into_iter()
            .flatten()
            .min_by_key(|(i, _)| *i);

        match hit {
            Some((i, sep)) => {
                out.push_str(&rest[..i]);
                out.push_str(sep);
                out.push_str("<user>");
                // Skip past the username component: jump to the next
                // path separator or end-of-string.
                let after = &rest[i + sep.len()..];
                let skip = after
                    .find(['\\', '/', ' ', '"', '\''])
                    .unwrap_or(after.len());
                rest = &after[skip..];
            }
            None => {
                out.push_str(rest);
                break;
            }
        }
    }

    // Redact bearer tokens in common shapes. These are cheap prefix
    // checks — we don't need to match every possible header form.
    let needles = [
        ("Authorization: Bearer ", "Authorization: Bearer <redacted>"),
        ("authorization: bearer ", "authorization: bearer <redacted>"),
        ("Bearer ", "Bearer <redacted>"),
    ];
    for (needle, replacement) in needles {
        // Advance `cursor` past each replacement so we never re-scan the
        // replacement text. This prevents an infinite loop when `replacement`
        // itself contains `needle` (e.g. "Bearer <redacted>" contains "Bearer ").
        let mut cursor = 0usize;
        loop {
            match out[cursor..].find(needle) {
                None => break,
                Some(rel) => {
                    let start = cursor + rel;
                    let after = &out[start + needle.len()..];
                    let end = after
                        .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                        .unwrap_or(after.len());
                    out.replace_range(start..start + needle.len() + end, replacement);
                    // Advance past the replacement so we never re-match it.
                    cursor = start + replacement.len();
                }
            }
        }
    }

    // Redact GitHub PAT-style tokens by prefix. PATs are 40+ chars of
    // `[A-Za-z0-9_]` following a known prefix.
    //
    // Use cursor-advance pattern (same as the Bearer block above) to correctly
    // handle multiple tokens per prefix: the old `while let` + `break` pattern
    // would silently skip all remaining real tokens after the first short
    // non-token match (e.g. a variable named `ghp_tmp` would cause all real
    // PATs that follow it to go unredacted).
    for prefix in ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"] {
        let replacement = "<redacted-gh-token>";
        let mut cursor = 0usize;
        loop {
            match out[cursor..].find(prefix) {
                None => break,
                Some(rel) => {
                    let start = cursor + rel;
                    let after = &out[start + prefix.len()..];
                    let end = after
                        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                        .unwrap_or(after.len());
                    if end >= 20 {
                        out.replace_range(start..start + prefix.len() + end, replacement);
                        cursor = start + replacement.len();
                    } else {
                        // Short match (not a real token) — skip past it.
                        cursor = start + prefix.len() + end;
                    }
                }
            }
        }
    }

    out
}
