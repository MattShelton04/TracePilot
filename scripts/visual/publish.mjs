// Trusted workflow_run publisher: no dependency install, PR checkout, artifact
// script execution, or untrusted HTML publication. Only bounded PNG/JSON data.
import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildComment, updateComment } from "./comment.mjs";
import { renderHistory } from "./gallery-template.mjs";
import { historyEntry, retainedHistory } from "./history.mjs";
import { buildReport } from "./report.mjs";

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const run = event.workflow_run;
const repo = process.env.GITHUB_REPOSITORY;
if (
  !run ||
  !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
  !Number.isSafeInteger(run.id) ||
  run.id < 1 ||
  !Number.isSafeInteger(run.run_attempt ?? 1) ||
  (run.run_attempt ?? 1) < 1 ||
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
// A queued workflow_run from an earlier attempt must not overwrite its rerun.
const currentRun = await api(`/actions/runs/${run.id}`);
if ((currentRun.run_attempt ?? 1) !== (run.run_attempt ?? 1)) {
  console.log("A newer capture attempt exists; skipping superseded publication.");
  process.exit(0);
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
  metadata: {
    runUrl: `https://github.com/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt ?? 1}`,
    attempt: run.run_attempt ?? 1,
  },
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
  // run.id is a validated positive integer; this target stays inside visual/runs.
  await rm(join(runs, String(run.id)), { recursive: true, force: true });
  await cp(output, join(runs, String(run.id)), { recursive: true });
  await writeFile(
    join(runs, String(run.id), "entry.json"),
    JSON.stringify({
      id: run.id,
      sha: run.head_sha,
      pr: pr?.number ?? null,
      title,
      created: run.created_at,
      attempt: run.run_attempt ?? 1,
      summary,
      views: rows.filter((row) => row.headHash).map((row) => row.id),
    }),
  );
  const entries = [];
  for (const id of await readdir(runs)) {
    if (!/^\d+$/.test(id)) continue;
    try {
      const bytes = await readFile(join(runs, id, "entry.json"));
      if (bytes.length > 100_000) continue;
      const entry = historyEntry(JSON.parse(bytes.toString("utf8")));
      if (entry && String(entry.id) === id) entries.push(entry);
    } catch {
      /* older incomplete run */
    }
  }
  // Bound the current site to 20 main and 20 PR runs, reserving the current
  // publication when it reruns an older ID. Git history remains available.
  const kept = retainedHistory(entries, run.id);
  const keptIds = new Set(kept.map((entry) => entry.id));
  for (const entry of entries) {
    if (!keptIds.has(entry.id) && /^\d+$/.test(String(entry.id)))
      await rm(join(runs, String(entry.id)), { recursive: true });
  }
  await writeFile(join(visual, "index.html"), await renderHistory(kept));
  await writeFile(join(visual, "history.json"), JSON.stringify(kept, null, 2));
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
const body = buildComment({
  rows,
  summary,
  run,
  repo,
  galleryUrl,
  publisherRunId: process.env.GITHUB_RUN_ID,
});
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, body);
if (pr) {
  const latestRun = await api(`/actions/runs/${run.id}`);
  if ((latestRun.run_attempt ?? 1) !== (run.run_attempt ?? 1)) {
    console.log(
      "A newer capture attempt started during publication; leaving its comment untouched.",
    );
    process.exit(0);
  }
  console.log(`Visual comment: ${await updateComment({ api, pr: pr.number, run, body })}`);
}
