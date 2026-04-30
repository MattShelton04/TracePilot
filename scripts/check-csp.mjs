#!/usr/bin/env node
/**
 * CSP regression guard for TracePilot (FU-02).
 *
 * Parses `apps/desktop/src-tauri/tauri.conf.json`, extracts the
 * `app.security.csp` string and asserts invariants that the w108 CSP
 * hardening landed with. A future edit that weakens the policy (e.g. adds
 * `'unsafe-inline'` to `script-src`) will be caught here before review.
 *
 * Asserts:
 *   - `script-src` does NOT contain `'unsafe-inline'` or `'unsafe-eval'`.
 *   - Required directives present:
 *       object-src 'none'
 *       base-uri 'self'
 *       frame-ancestors 'none'
 *       script-src-attr 'none'
 *
 * Also scans the built `apps/desktop/dist/index.html` (if present from a
 * prior `pnpm build`) for any inline `<script>` bodies — warns but does
 * not fail when absent, since CI builds may not have run yet locally.
 *
 * Usage:
 *   node scripts/check-csp.mjs
 *
 * See: docs/tech-debt-followups-triage-2026-04.md § FU-02
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const CONF_PATH = join(REPO_ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json");
const DIST_HTML = join(REPO_ROOT, "apps", "desktop", "dist", "index.html");

const REQUIRED_DIRECTIVES = [
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["frame-ancestors", "'none'"],
  ["script-src-attr", "'none'"],
];

const FORBIDDEN_SCRIPT_SRC_TOKENS = ["'unsafe-inline'", "'unsafe-eval'"];

function parseCsp(csp) {
  // Parse `directive value1 value2; directive value1 ...` into a map.
  const out = new Map();
  for (const chunk of csp.split(";")) {
    const parts = chunk.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const [name, ...values] = parts;
    out.set(name.toLowerCase(), values);
  }
  return out;
}

function loadCspString() {
  if (!existsSync(CONF_PATH)) {
    console.error(`✗ tauri.conf.json not found at ${CONF_PATH}`);
    process.exit(2);
  }
  let conf;
  try {
    conf = JSON.parse(readFileSync(CONF_PATH, "utf8"));
  } catch (err) {
    console.error(`✗ failed to parse tauri.conf.json: ${err.message}`);
    process.exit(2);
  }
  const csp = conf?.app?.security?.csp;
  if (typeof csp !== "string" || csp.length === 0) {
    console.error("✗ `app.security.csp` missing or not a string in tauri.conf.json");
    process.exit(1);
  }
  return csp;
}

function checkDirectives(csp) {
  const errors = [];
  const directives = parseCsp(csp);

  const scriptSrc = directives.get("script-src") ?? [];
  for (const tok of FORBIDDEN_SCRIPT_SRC_TOKENS) {
    if (scriptSrc.includes(tok)) {
      errors.push(`script-src contains forbidden token ${tok}`);
    }
  }

  for (const [name, value] of REQUIRED_DIRECTIVES) {
    const values = directives.get(name);
    if (!values) {
      errors.push(`missing required directive: ${name} ${value}`);
      continue;
    }
    if (!values.includes(value)) {
      errors.push(`directive \`${name}\` must include ${value} (got: ${values.join(" ")})`);
    }
  }
  return errors;
}

function scanBuiltIndexHtml() {
  // Best-effort inline-script scan. If dist/index.html is missing we say so
  // and move on — first-time contributors may not have built the app yet.
  if (!existsSync(DIST_HTML)) {
    console.log(
      "• skipped dist/index.html scan (run `pnpm --filter @tracepilot/desktop build` to enable)",
    );
    return [];
  }
  const html = readFileSync(DIST_HTML, "utf8");
  // Match <script ...>BODY</script> where BODY is non-empty and non-whitespace.
  const rx = /<script\b([^>]*)>([\s\S]*?)<\/script(?:\s[^>]*)?>/gi;
  const offenders = [];
  for (const m of html.matchAll(rx)) {
    const attrs = m[1];
    const body = m[2];
    const hasSrc = /\bsrc\s*=/.test(attrs);
    if (!hasSrc && body.trim().length > 0) {
      const snippet = body.trim().slice(0, 60).replace(/\s+/g, " ");
      offenders.push(snippet);
    }
  }
  return offenders;
}

const csp = loadCspString();
const errors = checkDirectives(csp);
const inline = scanBuiltIndexHtml();

if (errors.length > 0) {
  console.error("✗ CSP regression guard failed:");
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\nSee apps/desktop/src-tauri/tauri.conf.json § app.security.csp");
  process.exit(1);
}

if (inline.length > 0) {
  console.warn(`⚠ dist/index.html contains ${inline.length} inline <script> block(s):`);
  for (const s of inline) console.warn(`  - ${s}…`);
  console.warn("(warning only — build output is gitignored; fix the source before release)");
}

console.log("✓ CSP static guards passed");
