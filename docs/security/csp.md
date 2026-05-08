# Content Security Policy (CSP)

TracePilot is a Tauri desktop app. The CSP is enforced by the Tauri WebView and
applies to the bundled frontend (`apps/desktop/dist/`) loaded under the
`tauri://` (production) or `http://localhost:1420` (dev) origin.

## Source of truth

The active policy is defined in **one place**:

- `apps/desktop/src-tauri/tauri.conf.json` → `app.security.csp`

`apps/desktop/index.html` deliberately contains **no** `<meta http-equiv="Content-Security-Policy">`
tag — Tauri injects the configured CSP as an HTTP response header so we avoid
two competing policies.

## Current directives

```
default-src 'self';
script-src 'self';
script-src-attr 'none';
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
img-src 'self' data:;
connect-src 'self' https://github.com https://api.github.com;
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
frame-src 'none';
worker-src 'self';
form-action 'self'
```

## Rationale per directive

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Deny-by-default for every fetch type not explicitly overridden. |
| `script-src` | `'self'` | Only bundled JS executes. No `'unsafe-inline'`, no `'unsafe-eval'`, no CDN. The Vite build emits hashed `<script>` tags from the same origin. |
| `script-src-attr` | `'none'` | Blocks all inline event handlers (`onclick=...`). |
| `style-src` | `'self' 'unsafe-inline'` | `'unsafe-inline'` is required by Vue's scoped-style hydration and several UI libraries that emit inline `<style>` blocks at runtime. Tracked as accepted risk; revisit if/when the toolchain supports nonces. |
| `font-src` | `'self' data:` | Fonts are bundled; `data:` covers icon-font fallbacks emitted by some Vite plugins. |
| `img-src` | `'self' data:` | Bundled assets plus inline `data:` URIs (avatars, generated previews). No remote image hosts — avoids tracking pixels. |
| `connect-src` | `'self' https://github.com https://api.github.com` | `'self'` covers the Tauri IPC + dev server. The two GitHub origins are the only remote endpoints the renderer talks to (auth status, repo metadata). All other network traffic (Copilot SDK, MCP servers) flows through the Rust backend, not the renderer. |
| `object-src` | `'none'` | No Flash / plugin embedding. |
| `base-uri` | `'self'` | Prevents `<base>` tag injection from rebasing relative URLs. |
| `frame-ancestors` | `'none'` | The TracePilot window cannot be embedded in another frame. |
| `frame-src` | `'none'` | The renderer cannot embed iframes — viewer windows are real Tauri webviews, not iframes. |
| `worker-src` | `'self'` | Web Workers (e.g. virtualization helpers) load from the same origin. |
| `form-action` | `'self'` | Prevents form-submit data exfiltration to a third-party origin. |

## What is intentionally NOT allowed

- No `'unsafe-eval'` — blocks `eval`, `new Function`, and JIT-style template compilers.
- No `'unsafe-inline'` for scripts — every executed script must come from a bundled file.
- No remote script CDNs, no remote stylesheets, no remote images.
- No `wss://` / `ws://` in `connect-src` — there is no renderer-side websocket; SDK transport happens in Rust.

## Adding a new remote origin

1. Identify whether the call belongs in the renderer at all. Most network work
   should live in a Rust IPC command (so it is also subject to the capability
   allowlist — see `docs/security/permissions.md`).
2. If it must run in the renderer, add the exact origin (scheme + host, no
   wildcards) to `connect-src` in `tauri.conf.json`.
3. Document the origin and its purpose in this file.

## Verifying

After changing CSP, run the desktop app in dev mode and check the DevTools
console for `Refused to ...` violation reports. There is no automated CSP test
in CI — the policy is short enough to review by inspection during PR review.
