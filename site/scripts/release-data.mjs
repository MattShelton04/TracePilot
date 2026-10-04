// Writes site/src/data/release.json: the latest published release, its version
// and the Windows and macOS installer links. The page never fetches at runtime;
// a new release rebuilds the site (see .github/workflows/site.yml).
// Uses GITHUB_TOKEN when set (CI). Locally the result is reused for six hours
// unless --refresh is passed. On any failure it falls back to package.json.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../src/data/release.json");
const repo = process.env.GITHUB_REPOSITORY || "MattShelton04/TracePilot";
const releasesPage = `https://github.com/${repo}/releases/latest`;

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

export function fromRelease(release) {
  const version = release.tag_name.replace(/^v/, "");
  return {
    tag: release.tag_name,
    version,
    publishedAt: release.published_at,
    // /releases/latest rather than this tag, so the link stays current even if a rebuild fails
    page: releasesPage,
    installers: pickInstallers(release.assets ?? []),
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
  };
}

async function main() {
  // a cache written before the macOS installer was recorded has no `installers`
  const fresh =
    existsSync(out) &&
    Date.now() - statSync(out).mtimeMs < 6 * 3600_000 &&
    "installers" in JSON.parse(readFileSync(out, "utf8"));
  if (fresh && !process.env.CI && !process.argv.includes("--refresh")) {
    console.log("site release data: reusing src/data/release.json (pass --refresh to refetch)");
    return;
  }
  let data;
  try {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    data = res.ok ? fromRelease(await res.json()) : fallback(`GitHub API returned ${res.status}`);
    for (const [platform, installer] of Object.entries(data.installers)) {
      if (installer == null && res.ok)
        console.warn(`site release data: no ${platform} installer; linking the release page`);
    }
  } catch (error) {
    data = fallback(error.message);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  const names = Object.values(data.installers)
    .filter(Boolean)
    .map((i) => ` · ${i.name}`);
  console.log(`site release data: v${data.version}${names.join("")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
