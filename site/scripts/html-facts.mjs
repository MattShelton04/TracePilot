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

/**
 * Raw counts work against a young project, so the page leaves them out until they pass these
 * thresholds; the next build after that shows them with no other change. Lower a threshold to 0
 * to show a count now, or raise it to Infinity to keep it hidden.
 */
export const SHOW_COUNTS_FROM = { stars: 100, downloads: 1000 };

const MONTHS =
  "January February March April May June July August September October November December".split(
    " ",
  );
const day = (iso) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
};
const month = (iso) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Momentum and credibility facts from the release data; empty strings leave an element out. */
export function socialFacts(r) {
  const s = r.stats;
  const shown = (key) => (s && s[key] >= SHOW_COUNTS_FROM[key] ? fmtK(s[key]) : "");
  const downloads = shown("downloads");
  return {
    // the page turns this into "released 8 days ago" (src/page.js)
    releaseDate: r.publishedAt ?? "",
    releaseWhen: r.publishedAt ? `released ${day(r.publishedAt)}` : "latest release",
    releaseHighlights: (r.highlights ?? [])
      .map((h) => `<li>${esc(h.replaceAll("`", ""))}</li>`)
      .join(""),
    releaseCadence:
      s?.releases > 1 && s.firstReleaseAt
        ? `${s.releases} releases since ${month(s.firstReleaseAt)}`
        : "",
    starCount: shown("stars"),
    downloadCount: downloads && `${downloads} downloads`,
  };
}

export function htmlFacts(showcaseFile, releaseFile, _mode) {
  const d = JSON.parse(readFileSync(showcaseFile, "utf8"));
  const r = JSON.parse(readFileSync(releaseFile, "utf8"));
  const usage = Object.values(d.heroMetrics.modelMetrics).map((m) => m.usage);
  const sum = (k) => usage.reduce((n, u) => n + u[k], 0);
  return {
    siteUrl: SITE_URL,
    version: r.version,
    // download links point here until the head script picks this visitor's installer
    releaseUrl: r.page,
    ...socialFacts(r),
    platforms: r.installers.macos ? "Windows and macOS (Apple Silicon)" : "Windows",
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

export const MAC_NOTE = "Apple Silicon (M1 or later)";

/**
 * Chooses this visitor's download from `links` ({ win, mac, page }); a platform without an
 * installer gets the release page. It runs in the browser (serialised into platformScript), so it
 * must stay self-contained. iPadOS reports a Mac platform, so a touch screen rules a Mac out.
 */
export function pickDownload(nav, links) {
  const platform = nav.userAgentData?.platform || nav.platform || "";
  let os = "other";
  if (/^win/i.test(platform)) os = "win";
  else if (/^mac/i.test(platform) && !(nav.maxTouchPoints > 1)) os = "mac";
  return links[os] ? { os, url: links[os] } : { os: "other", url: links.page };
}

/**
 * The head script on both pages. Before first paint it sets html[data-os] (win, mac or other),
 * which the CSS uses to show the matching download label, and html[data-download] for links the
 * modules render. Static `a[data-download]` links get the URL once parsed. Without JavaScript
 * every link keeps the neutral label and the release page.
 */
export function platformScript(release) {
  const links = {
    win: release.installers.windows?.url ?? null,
    mac: release.installers.macos?.url ?? null,
    page: release.page,
  };
  const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `((d, pick) => {
  const dl = pick(navigator, ${json(links)});
  d.documentElement.dataset.os = dl.os;
  d.documentElement.dataset.download = dl.url;
  d.addEventListener("DOMContentLoaded", () => {
    for (const a of d.querySelectorAll("a[data-download]")) {
      a.href = dl.url;
      if (dl.os === "mac") a.title = ${json(MAC_NOTE)};
    }
  });
})(document, ${pickDownload.toString()});`;
}

export const scriptHash = (source) =>
  `'sha256-${createHash("sha256").update(source).digest("base64")}'`;

// Inline classic scripts (the page's pre-paint boot script) are allowed by hash, nothing broader.
export const inlineScriptHashes = (html) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .filter((m) => m[1].trim())
    .map((m) => scriptHash(m[1]));

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
