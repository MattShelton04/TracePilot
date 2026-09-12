// Trusted workflow_run publisher: no dependency install, PR checkout, artifact
// script execution, or untrusted HTML publication. Only bounded PNG/JSON data.
import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, escapeHtml } from "./report.mjs";

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const run = event.workflow_run;
const repo = process.env.GITHUB_REPOSITORY;
if (
  !run ||
  !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
  !Number.isSafeInteger(run.id) ||
  !/^[a-f0-9]{40}$/.test(run.head_sha)
)
  throw new Error("Invalid workflow event");
if (run.repository.full_name !== repo || run.path !== ".github/workflows/visual-capture.yml")
  throw new Error("Unexpected source workflow");
const apiRoot = `https://api.github.com/repos/${repo}`;
async function api(path, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}`);
  return response.status === 204 ? null : response.json();
}
const workspace = resolve(".tracepilot/visual-publish");
const output = resolve(".tracepilot/visual-report");
await mkdir(workspace, { recursive: true });
const artifacts = (await api(`/actions/runs/${run.id}/artifacts?per_page=100`)).artifacts;
for (const artifact of artifacts) {
  const match = /^visual-(base|head)-([12])$/.exec(artifact.name);
  if (!match || artifact.expired) continue;
  if (artifact.size_in_bytes > 64_000_000) throw new Error("Oversized visual artifact");
  const response = await fetch(`${apiRoot}/actions/artifacts/${artifact.id}/zip`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
  });
  if (!response.ok) throw new Error("Artifact download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 64_000_000) throw new Error("Oversized artifact download");
  const zip = join(workspace, `${artifact.name}.zip`);
  await writeFile(zip, bytes);
  execFileSync(
    "python3",
    [join(dirname(fileURLToPath(import.meta.url)), "extract.py"), zip, join(workspace, match[1])],
    { stdio: "inherit" },
  );
}
let pr;
if (run.event === "pull_request") {
  const associated = await api(`/commits/${run.head_sha}/pulls`);
  pr = associated.find(
    (item) =>
      item.state === "open" &&
      item.head.sha === run.head_sha &&
      item.base.repo.full_name === repo &&
      item.base.ref === event.repository.default_branch &&
      (!run.pull_requests?.length ||
        run.pull_requests.some((source) => source.number === item.number)),
  );
  if (!pr) {
    console.log("PR closed or superseded; skipping stale report.");
    process.exit(0);
  }
} else if (run.event !== "push" || run.head_branch !== event.repository.default_branch) {
  console.log("Only current PRs and default-branch pushes are published.");
  process.exit(0);
}
const title = `${pr ? `PR #${pr.number}` : "Main"} · ${run.head_sha.slice(0, 8)} · fixture visual comparison`;
const { rows, summary } = await buildReport({
  baseDir: join(workspace, "base"),
  headDir: join(workspace, "head"),
  output,
  title,
});
let galleryUrl;
let pagesProblem;
try {
  const pages = await api("/pages");
  if (pages.source?.branch !== "gh-pages" || pages.source?.path !== "/")
    throw new Error("Pages must use the existing gh-pages branch root source");
  // Preserve the workbench and every path outside visual/.
  execFileSync("git", ["fetch", "origin", "gh-pages"], { stdio: "inherit" });
  const tree = join(workspace, "pages");
  execFileSync("git", ["worktree", "add", "--detach", tree, "FETCH_HEAD"], { stdio: "inherit" });
  const visual = join(tree, "visual");
  const runs = join(visual, "runs");
  await mkdir(runs, { recursive: true });
  await cp(output, join(runs, String(run.id)), { recursive: true });
  await writeFile(
    join(runs, String(run.id), "entry.json"),
    JSON.stringify({
      id: run.id,
      sha: run.head_sha,
      pr: pr?.number ?? null,
      title,
      created: run.created_at,
    }),
  );
  const entries = [];
  for (const id of await readdir(runs)) {
    if (!/^\d+$/.test(id)) continue;
    try {
      entries.push(JSON.parse(await readFile(join(runs, id, "entry.json"), "utf8")));
    } catch {
      /* older incomplete run */
    }
  }
  entries.sort((a, b) => b.id - a.id);
  // Bound the current site: latest 20 main runs and 20 PR runs. Git history is
  // intentionally retained, so site owners can independently archive the branch.
  const kept = [];
  let mainCount = 0,
    prCount = 0;
  for (const entry of entries) {
    const keep = entry.pr ? ++prCount <= 20 : ++mainCount <= 20;
    if (keep) kept.push(entry);
    else if (/^\d+$/.test(String(entry.id)))
      await rm(join(runs, String(entry.id)), { recursive: true });
  }
  await writeFile(
    join(visual, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>TracePilot visual history</title><style>body{font:18px system-ui;max-width:1000px;margin:40px auto;padding:20px}li{margin:16px 0}</style><h1>TracePilot visual history</h1><p>Actual frontend views with synthetic backend fixtures. Native app verification remains separate.</p><ul>${kept.map((entry) => `<li><a href="runs/${Number(entry.id)}/index.html">${escapeHtml(entry.title)}</a> · ${escapeHtml(entry.created)}</li>`).join("")}</ul></html>`,
  );
  execFileSync("git", ["-C", tree, "add", "--", "visual"], { stdio: "inherit" });
  const hasChanges = execFileSync("git", ["-C", tree, "diff", "--cached", "--name-only"], {
    encoding: "utf8",
  }).trim();
  if (hasChanges) {
    execFileSync(
      "git",
      [
        "-C",
        tree,
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit",
        "-m",
        `Publish visual report for run ${run.id}`,
      ],
      { stdio: "inherit" },
    );
    execFileSync("git", ["-C", tree, "push", "origin", "HEAD:gh-pages"], { stdio: "inherit" });
  }
  await api("/pages/builds", { method: "POST" });
  galleryUrl = `${pages.html_url.replace(/\/$/, "")}/visual/runs/${run.id}/`;
} catch (error) {
  pagesProblem = error.message;
  console.warn(`Pages unavailable: ${pagesProblem}. Standalone report retained as an artifact.`);
}
const runUrl = `https://github.com/${repo}/actions/runs/${run.id}`;
let body = `<!-- tracepilot-visual-report -->\nActual frontend at **1440×960**, dark, 100% scale, with deterministic **synthetic backend fixtures**. No Rust/native verification.\n\n**${summary.changed} changed**, ${summary.unchanged} unchanged, ${summary.baseUnavailable} base unavailable, ${summary.incomplete} incomplete. Base/head captures run on matching Linux runners; review visual changes for intent.\n\n`;
body += galleryUrl
  ? `[Interactive before/after gallery](${galleryUrl}) · [Capture run](${runUrl})\n\n`
  : `[Capture artifacts](${runUrl}) · [Standalone comparison gallery](https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID})\n\nPages publication is unavailable; download the visual-gallery artifact and open index.html.\n\n`;
if (galleryUrl) {
  for (const row of rows.filter((item) => item.change === "changed").slice(0, 3)) {
    body += `<details><summary>${row.id}</summary>\n\n| Before | After |\n|---|---|\n| ![Before](${galleryUrl}base-${row.id}.png) | ![After](${galleryUrl}head-${row.id}.png) |\n\n</details>\n\n`;
  }
}
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, body);
if (pr) {
  const current = await api(`/pulls/${pr.number}`);
  if (current.state !== "open" || current.head.sha !== run.head_sha) {
    console.log("PR changed during publication; leaving its current comment untouched.");
    process.exit(0);
  }
  let previous;
  for (let page = 1; ; page++) {
    const comments = await api(`/issues/${pr.number}/comments?per_page=100&page=${page}`);
    previous = comments.find(
      (comment) =>
        comment.user.login === "github-actions[bot]" &&
        comment.body.startsWith("<!-- tracepilot-visual-report -->"),
    );
    if (previous || comments.length < 100) break;
  }
  await api(previous ? `/issues/comments/${previous.id}` : `/issues/${pr.number}/comments`, {
    method: previous ? "PATCH" : "POST",
    body: JSON.stringify({ body }),
    headers: { "Content-Type": "application/json" },
  });
}
