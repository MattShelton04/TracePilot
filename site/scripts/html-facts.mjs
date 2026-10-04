// Values substituted into __placeholders__ in index.html and demo/index.html at
// build time, derived from the generated data files. Unknown placeholders fail
// the build (see vite.config.mjs).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const SITE_URL = process.env.SITE_URL || "https://mattshelton04.github.io/TracePilot/";

// Cloudflare Web Analytics site token. It is public (it ships in the page), but only CI sets it,
// so local builds and previews never load the beacon or report visits.
export const BEACON_TOKEN = process.env.CF_BEACON_TOKEN || "";
const BEACON_SCRIPT = "https://static.cloudflareinsights.com";
const BEACON_REPORT = "https://cloudflareinsights.com";

const CSP = {
  build:
    "default-src 'self'; script-src 'self'%s; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
  // the dev server's hot reload needs its websocket
  serve:
    "default-src 'self'; script-src 'self'%s; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'",
};

const fmtK = (n) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
};

export function htmlFacts(showcaseFile, releaseFile, _mode) {
  const d = JSON.parse(readFileSync(showcaseFile, "utf8"));
  const r = JSON.parse(readFileSync(releaseFile, "utf8"));
  const usage = Object.values(d.heroMetrics.modelMetrics).map((m) => m.usage);
  const sum = (k) => usage.reduce((n, u) => n + u[k], 0);
  return {
    siteUrl: SITE_URL,
    version: r.version,
    downloadUrl: r.installer ? r.installer.url : r.page,
    sessionCount: String(d.sessionCount),
    turnCount: String(d.heroContextTimeline.turnCount),
    compactTurn: String(d.compaction.turn),
    compactBefore: fmtK(d.compaction.before),
    compactAfter: fmtK(d.compaction.after),
    heroAic: d.costs.hero.aic.toFixed(1),
    heroUsd: `$${d.costs.hero.usd.toFixed(2)}`,
    heroTokens: `${((sum("inputTokens") + sum("outputTokens")) / 1e6).toFixed(1)} million`,
    heroCacheRate: `${((sum("cacheReadTokens") / sum("inputTokens")) * 100).toFixed(1)}%`,
  };
}

// Inline classic scripts (the page's pre-paint boot script) are allowed by hash, nothing broader.
export const inlineScriptHashes = (html) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .filter((m) => m[1].trim())
    .map((m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);

/** The page CSP; `beacon` (builds only) admits the analytics script and its reporting endpoint. */
export function cspFor(mode, hashes = [], beacon = false) {
  const csp = CSP[mode].replace("%s", hashes.map((h) => ` ${h}`).join(""));
  if (!beacon) return csp;
  if (mode !== "build") throw new Error("the analytics beacon is for builds only");
  return csp
    .replace("script-src 'self'", `script-src 'self' ${BEACON_SCRIPT}`)
    .replace("connect-src 'none'", `connect-src ${BEACON_REPORT}`);
}

/** Cloudflare's Web Analytics snippet as a Vite tag; rejects anything but a 32-hex token. */
export function beaconTag(token) {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new Error("CF_BEACON_TOKEN must be 32 hex characters");
  return {
    tag: "script",
    attrs: {
      type: "module",
      src: `${BEACON_SCRIPT}/beacon.min.js`,
      "data-cf-beacon": JSON.stringify({ token }),
    },
    injectTo: "body",
  };
}

export function fillPlaceholders(html, facts, file) {
  return html.replace(/__([a-zA-Z][a-zA-Z0-9_]*?)__/g, (_, key) => {
    if (!Object.hasOwn(facts, key)) throw new Error(`${file}: unknown placeholder __${key}__`);
    return facts[key];
  });
}
