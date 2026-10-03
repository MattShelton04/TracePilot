// Ownership rules for publishing the landing page into the gh-pages branch root.
// The site shares that root with the visual-regression gallery (visual/), the
// benchmark dashboard (dev/) and the branch's own README.md and .nojekyll, so it
// may only ever add, replace or delete the paths it owns. Ownership is recorded
// in .site-manifest.json at the root.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const MANIFEST = ".site-manifest.json";
const RESERVED_ROOTS = new Set(["visual", "dev", ".git", ".nojekyll", "readme.md", MANIFEST]);

export function isReserved(path) {
  return RESERVED_ROOTS.has(path.split("/")[0].toLowerCase());
}

function validatePaths(paths, label) {
  if (!Array.isArray(paths)) throw new Error(`${label} must be an array of paths`);
  for (const p of paths) {
    if (
      typeof p !== "string" ||
      !p ||
      /[\\:]/.test(p) ||
      [...p].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      p.split("/").some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part))
    )
      throw new Error(`${label} contains an unsafe path: ${JSON.stringify(p)}`);
  }
  if (new Set(paths).size !== paths.length) throw new Error(`${label} contains duplicate paths`);
}

/** Every file below dir, as sorted posix paths relative to dir. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isSymbolicLink()) throw new Error(`Publisher refuses symlinks: ${p}`);
      if (e.isDirectory()) {
        walk(p);
      } else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Decides what a publish changes.
 * @param {{ owned: string[], next: string[], existing: string[] }} input
 *   owned: paths listed in the previous manifest; next: files in the new build;
 *   existing: files currently on the branch.
 * @returns {{ remove: string[], write: string[], manifest: { files: string[] } }}
 */
export function planPublish({ owned, next, existing }) {
  validatePaths(owned, "Manifest");
  validatePaths(next, "Site build");
  validatePaths(existing, "Existing files");
  const badOwned = owned.filter(isReserved);
  if (badOwned.length) throw new Error(`Manifest claims reserved paths: ${badOwned.join(", ")}`);
  const badNext = next.filter(isReserved);
  if (badNext.length)
    throw new Error(`Site build collides with reserved paths: ${badNext.join(", ")}`);
  const ownedSet = new Set(owned);
  const nextSet = new Set(next);
  const foreign = next.filter((p) => existing.includes(p) && !ownedSet.has(p));
  if (foreign.length) {
    throw new Error(`Site build would overwrite files it does not own: ${foreign.join(", ")}`);
  }
  for (const p of next) {
    const conflict = [...existing, ...next].find(
      (q) => q !== p && (q.startsWith(`${p}/`) || p.startsWith(`${q}/`)),
    );
    if (conflict)
      throw new Error(`Site build has a file/directory collision: ${p} and ${conflict}`);
  }
  return {
    remove: owned.filter((p) => !nextSet.has(p) && existing.includes(p)).sort(),
    write: [...next].sort(),
    manifest: { files: [...next].sort() },
  };
}
