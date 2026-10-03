// Values substituted into __placeholders__ in index.html and demo/index.html at
// build time, derived from the generated data files. Unknown placeholders fail
// the build (see vite.config.mjs).
import { readFileSync } from "node:fs";

export const SITE_URL = process.env.SITE_URL || "https://mattshelton04.github.io/TracePilot/";

const CSP = {
  build:
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
  // the dev server's hot reload needs its websocket
  serve:
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
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

export const cspFor = (mode) => CSP[mode];

export function fillPlaceholders(html, facts, file) {
  return html.replace(/__([a-zA-Z][a-zA-Z0-9_]*?)__/g, (_, key) => {
    if (!Object.hasOwn(facts, key)) throw new Error(`${file}: unknown placeholder __${key}__`);
    return facts[key];
  });
}
