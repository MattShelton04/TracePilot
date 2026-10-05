// Writes site/src/data/release.json: the latest published release, its version,
// release-note highlights and the Windows and macOS installer links, plus
// repository stats (stars, installer downloads, release cadence). The page never
// fetches at runtime; a new release rebuilds the site (see .github/workflows/site.yml).
// Uses GITHUB_TOKEN when set (CI). Locally the result is reused for six hours
// unless --refresh is passed. On any failure it falls back to package.json.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../src/data/release.json");
const repo = process.env.GITHUB_REPOSITORY || "MattShelton04/TracePilot";
const releasesPage = `https://github.com/${repo}/releases/latest`;
const MAX_HIGHLIGHTS = 6;

const download = (asset) =>
  asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null;

/**
 * The installers tauri-action uploads, null where a release has none. Windows: the NSIS
 * setup, then the MSI, never the bare exe. macOS: the Apple Silicon disk image.
 */
export function pickInstallers(assets) {
  const named = (re) => assets.find((a) => re.test(a.name));
  return {
    windows: download(named(/_x64-setup\.exe$/i) || named(/\.msi$/i)),
    macos: download(named(/_aarch64\.dmg$/i)),
  };
}

/**
 * The bold entry titles from a release's notes (its CHANGELOG section): the "Added" entries
 * when there are any, otherwise every entry, so a fixes-only release still has something to say.
 */
export function releaseHighlights(body = "") {
  const entries = [];
  let section = "";
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) section = heading[1].toLowerCase();
    const entry = line.match(/^\s*[-*]\s+\*\*(.+?)\*\*/);
    if (entry) entries.push({ section, title: entry[1].trim() });
  }
  const added = entries.filter((e) => e.section === "added");
  return (added.length ? added : entries).slice(0, MAX_HIGHLIGHTS).map((e) => e.title);
}

export function fromRelease(release) {
  const version = release.tag_name.replace(/^v/, "");
  return {
    tag: release.tag_name,
    version,
    publishedAt: release.published_at,
    // /releases/latest rather than this tag, so the link stays current even if a rebuild fails
    page: releasesPage,
    installers: pickInstallers(release.assets ?? []),
    highlights: releaseHighlights(release.body ?? ""),
  };
}

// every download a visitor makes, including the standalone exe; not updater metadata or signatures
const INSTALLER_ASSET = /\.(exe|msi|dmg)$/i;

/**
 * Repository totals for social proof. Downloads are cumulative across every release, which is
 * the larger and steadier figure. The page shows raw counts only once they pass the thresholds
 * in html-facts.mjs (SHOW_COUNTS_FROM); cadence is shown from the start.
 */
export function repoStats(info, releases) {
  const published = releases.filter((r) => !r.draft && !r.prerelease);
  return {
    stars: info.stargazers_count,
    downloads: releases
      .flatMap((r) => r.assets ?? [])
      .filter((a) => INSTALLER_ASSET.test(a.name))
      .reduce((n, a) => n + a.download_count, 0),
    releases: published.length,
    firstReleaseAt: published.map((r) => r.published_at).sort()[0] ?? null,
  };
}

function fallback(reason) {
  const pkg = JSON.parse(readFileSync(join(here, "../../package.json"), "utf8"));
  console.warn(
    `site release data: ${reason}; using package.json ${pkg.version} and ${releasesPage}`,
  );
  return {
    tag: `v${pkg.version}`,
    version: pkg.version,
    publishedAt: null,
    page: releasesPage,
    installers: { windows: null, macos: null },
    highlights: [],
  };
}

function github() {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return async (path) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${path || "/"}`);
    return res.json();
  };
}

async function allReleases(get) {
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await get(`/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

async function main() {
  // a cache written before stats were recorded lacks `stats`; refetch it
  const fresh =
    existsSync(out) &&
    Date.now() - statSync(out).mtimeMs < 6 * 3600_000 &&
    "stats" in JSON.parse(readFileSync(out, "utf8"));
  if (fresh && !process.env.CI && !process.argv.includes("--refresh")) {
    console.log("site release data: reusing src/data/release.json (pass --refresh to refetch)");
    return;
  }
  const get = github();
  let data;
  try {
    data = fromRelease(await get("/releases/latest"));
    for (const [platform, installer] of Object.entries(data.installers)) {
      if (installer == null)
        console.warn(`site release data: no ${platform} installer; linking the release page`);
    }
  } catch (error) {
    data = fallback(error.message);
  }
  // stats are optional: without them the page simply leaves out cadence and counts
  try {
    const [info, releases] = await Promise.all([get(""), allReleases(get)]);
    data.stats = repoStats(info, releases);
  } catch (error) {
    console.warn(`site release data: no repository stats (${error.message})`);
    data.stats = null;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  const names = Object.values(data.installers)
    .filter(Boolean)
    .map((i) => ` · ${i.name}`);
  const stats = data.stats
    ? ` · ${data.stats.stars} stars, ${data.stats.downloads} downloads, ${data.stats.releases} releases`
    : "";
  console.log(`site release data: v${data.version}${names.join("")}${stats}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
