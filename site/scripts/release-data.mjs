// Writes site/src/data/release.json: the latest published release, its version
// and the Windows installer link. The page never fetches at runtime; a new
// release rebuilds the site (see .github/workflows/site.yml).
// Uses GITHUB_TOKEN when set (CI). Locally the result is reused for six hours
// unless --refresh is passed. On any failure it falls back to package.json.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../src/data/release.json");
const repo = process.env.GITHUB_REPOSITORY || "MattShelton04/TracePilot";
const releasesPage = `https://github.com/${repo}/releases/latest`;

/** Picks the NSIS installer tauri-action uploads, then the MSI. Never the bare exe. */
export function pickInstaller(assets) {
  const named = (re) => assets.find((a) => re.test(a.name));
  const asset = named(/_x64-setup\.exe$/i) || named(/\.msi$/i);
  return asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null;
}

export function fromRelease(release) {
  const version = release.tag_name.replace(/^v/, "");
  return {
    tag: release.tag_name,
    version,
    publishedAt: release.published_at,
    page: release.html_url,
    installer: pickInstaller(release.assets ?? []),
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
    installer: null,
  };
}

async function main() {
  const fresh = existsSync(out) && Date.now() - statSync(out).mtimeMs < 6 * 3600_000;
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
    if (data.installer == null && res.ok)
      console.warn("site release data: no installer asset; linking the release page");
  } catch (error) {
    data = fallback(error.message);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  console.log(
    `site release data: v${data.version}${data.installer ? ` · ${data.installer.name}` : ""}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
