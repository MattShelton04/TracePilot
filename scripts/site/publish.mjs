// Publishes site/dist into the root of the gh-pages branch (see docs/landing-page.md).
// Run by .github/workflows/site.yml on main. It never checks out PR code and only
// touches the paths listed in .site-manifest.json, so visual/ (the visual-regression
// gallery), dev/ (benchmarks), README.md and .nojekyll are preserved.
//
//   node scripts/site/publish.mjs [--dist site/dist] [--remote origin] [--no-api]
//
// --no-api skips the GitHub Pages API calls (local testing against a scratch remote).
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, MANIFEST, planPublish } from "./ownership.mjs";

const git = (cwd, args, opts = {}) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], ...opts });

/** One attempt: fetch gh-pages, apply the plan in a detached worktree, commit, push. */
function attempt({ cwd, dist, remote, sha, tree }) {
  git(cwd, ["fetch", "--depth=1", remote, "gh-pages"]);
  git(cwd, ["worktree", "add", "--detach", tree, "FETCH_HEAD"]);
  try {
    const manifestPath = join(tree, MANIFEST);
    const owned = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf8")).files
      : [];
    const plan = planPublish({ owned, next: listFiles(dist), existing: listFiles(tree) });
    for (const p of plan.remove) rmSync(join(tree, p), { force: true });
    for (const p of plan.write) {
      mkdirSync(dirname(join(tree, p)), { recursive: true });
      cpSync(join(dist, p), join(tree, p));
    }
    writeFileSync(manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`);
    const paths = [...new Set([...plan.remove, ...plan.write, MANIFEST])];
    git(
      tree,
      ["--literal-pathspecs", "add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"],
      {
        input: `${paths.join("\0")}\0`,
      },
    );
    if (!git(tree, ["diff", "--cached", "--name-only"]).trim()) {
      console.log("Site unchanged on gh-pages; nothing to publish.");
      return { pushed: false, changed: false };
    }
    git(tree, [
      "-c",
      "user.name=github-actions[bot]",
      "-c",
      "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit",
      "-m",
      `Publish site for ${sha}`,
    ]);
    try {
      git(tree, ["push", remote, "HEAD:gh-pages"]);
    } catch {
      return { pushed: false, changed: true };
    }
    console.log(
      `Published ${plan.write.length} file(s), removed ${plan.remove.length} stale file(s).`,
    );
    return { pushed: true, changed: true };
  } finally {
    git(cwd, ["worktree", "remove", "--force", tree]);
  }
}

/**
 * Publishes with up to three retries when the push is rejected (for example a
 * concurrent visual-gallery publish moved gh-pages): re-fetch, re-apply, retry.
 */
export function publish({ cwd, dist, remote = "origin", sha = "local", attempts = 4 }) {
  if (!existsSync(join(dist, "index.html"))) throw new Error(`No site build at ${dist}`);
  const scratch = join(cwd, ".tracepilot");
  mkdirSync(scratch, { recursive: true });
  for (let i = 1; i <= attempts; i++) {
    const tree = mkdtempSync(join(scratch, "site-publish-"));
    if (dirname(resolve(tree)) !== resolve(scratch))
      throw new Error("Unsafe publisher scratch path");
    let result;
    try {
      result = attempt({ cwd, dist, remote, sha, tree });
    } finally {
      // Only the unique directory created above can be removed here.
      rmSync(tree, { recursive: true, force: true });
    }
    if (result.pushed || !result.changed) return result;
    console.warn(
      `Push to gh-pages was rejected (attempt ${i}/${attempts}); retrying on the new tip.`,
    );
  }
  throw new Error("Could not push to gh-pages after retries");
}

async function main() {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const useApi = !process.argv.includes("--no-api");
  const repo = process.env.GITHUB_REPOSITORY;
  const api = async (path, options = {}) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...options,
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return res.status === 204 ? null : res.json();
  };
  if (useApi) {
    const pages = await api("/pages");
    if (
      pages.build_type !== "legacy" ||
      pages.source?.branch !== "gh-pages" ||
      pages.source?.path !== "/"
    ) {
      throw new Error("Pages must use the existing gh-pages branch root source; not changing it.");
    }
  }
  const result = publish({
    cwd: process.cwd(),
    dist: resolve(arg("--dist", "site/dist")),
    remote: arg("--remote", "origin"),
    sha: process.env.GITHUB_SHA || "local",
  });
  if (useApi && result.pushed) await api("/pages/builds", { method: "POST" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
